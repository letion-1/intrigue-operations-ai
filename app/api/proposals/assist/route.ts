import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type DraftOutput = { heading: string; introduction: string; scope: string };
const noStore = { 'Cache-Control': 'no-store' };
type Stage = 'configuration'|'authentication'|'authorization'|'quotation'|'quota'|'provider'|'response'|'timeout'|'validation';
function failure(message: string, status = 400, stage: Stage = 'validation') {
  return NextResponse.json({ error: message, stage, saved: false, sent: false }, { status, headers: noStore });
}
function limit(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function maskContacts(value: unknown, max = 200): string {
  return limit(value, max)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email withheld]')
    .replace(/\+?\d[\d() .-]{7,}\d/g, '[number withheld]');
}
function jsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The AI provider did not return structured proposal wording.');
  const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Unexpected AI response.');
  return parsed as Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const publishable = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY || ''
  ).trim();
  if (!url || !publishable) return failure('Supabase public configuration is missing on the server. Check the Vercel environment variables and redeploy.', 503, 'configuration');
  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!accessToken) return failure('Please sign in again.', 401, 'authentication');
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return failure('Invalid request.');
  const input = body as Record<string, unknown>;
  const workspaceId = input.workspaceId;
  const quoteId = input.quotationId;
  const uuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (typeof workspaceId !== 'string' || !uuid.test(workspaceId) || typeof quoteId !== 'string' || !uuid.test(quoteId)) {
    return failure('Select a valid company quotation.');
  }
  const client = createClient(url, publishable, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: { user }, error: authError } = await client.auth.getUser(accessToken);
  if (authError || !user?.id) return failure('Your login session has expired.', 401, 'authentication');

  // All business data is fetched by this authenticated user's RLS identity.
  const { data: member, error: memberError } = await client.from('workspace_memberships')
    .select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
  if (memberError || !member || !['owner', 'admin', 'staff'].includes(String(member.role))) {
    return failure('Workspace Staff or higher permission is required.', 403, 'authorization');
  }
  const { data: quote, error: quoteError } = await client.from('quotations')
    .select('id,workspace_id,customer_id,status,description,amount,currency')
    .eq('workspace_id', workspaceId).eq('id', quoteId).maybeSingle();
  if (quoteError || !quote || quote.status !== 'draft') return failure('Only drafts belonging to this company can be analyzed.', 404, 'quotation');
  const [{ data: company }, { data: services, error: linesError }, { data: knowledge }, { data: enquiries }] = await Promise.all([
    client.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
    client.from('quotation_line_items').select('item_name,quantity,unit_price,line_total')
      .eq('workspace_id', workspaceId).eq('quotation_id', quoteId).order('position'),
    client.from('knowledge_entries').select('title,content').eq('workspace_id', workspaceId).limit(6),
    client.from('enquiries').select('subject').eq('workspace_id', workspaceId)
      .eq('customer_id', quote.customer_id).order('created_at', { ascending: false }).limit(3),
  ]);
  if (linesError || !services?.length || !company?.name) return failure('Quotation line items are unavailable. Open a catalog-backed draft.', 409, 'quotation');

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return failure('AI suggestions are not configured: add OPENROUTER_API_KEY in Vercel server environment variables and redeploy. Manual writing still works.', 503, 'configuration');

  // DB-authorized, atomic per-user rate limit. Never call the paid model if this fails.
  const { error: quotaError } = await client.rpc('intrigue_proposal_ai_gate', {
    p_workspace_id: workspaceId, p_quotation_id: quoteId,
  });
  if (quotaError) return failure(`AI request could not be authorized: ${quotaError.message}. Confirm the V16.5.1 Supabase migration and staff role.`, 429, 'quota');
  // Data minimization: contact details excluded; enquiry subjects masked, never raw customer profiles.
  const payload = {
    business: limit(company.name, 120),
    catalog_lines: services.slice(0, 30).map((line) => ({
      item: limit(line.item_name, 150), quantity: Number(line.quantity),
      // Prices are deliberately excluded; model must not invent or manipulate financial terms.
    })),
    recent_customer_requests: (enquiries ?? []).map((entry) => maskContacts(entry.subject)),
    business_guidance: (knowledge ?? []).map((entry) => ({
      topic: limit(entry.title, 120), note: maskContacts(entry.content, 550),
    })),
  };
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(29000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENROUTER_PROPOSAL_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
        temperature: 0.2, max_tokens: 700,
        messages: [
          { role: 'system', content: 'You draft short, factual commercial proposal language for a business. Return ONLY JSON {"heading":"...","introduction":"...","scope":"..."}. Use ONLY supplied business data and products. No price, VAT, discounts, shipping promises, deadlines, guarantees, legal claims, personal details, or invented features. Clearly keep language nonbinding and subject to client review. English. Heading <= 100 characters, introduction <= 900, scope <= 1800. Do not include Markdown.' },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!response.ok) {
      // Avoid logging or exposing keys, prompt text or untrusted provider output.
      const guidance = response.status === 401 || response.status === 403
        ? 'OpenRouter rejected the API key. Verify OPENROUTER_API_KEY in Vercel and redeploy.'
        : response.status === 402 ? 'OpenRouter credits are insufficient. Check your provider balance.'
        : response.status === 404 ? 'The configured OpenRouter model is unavailable. Check OPENROUTER_MODEL.'
        : response.status === 429 ? 'OpenRouter rate limit reached. Retry later.'
        : `OpenRouter is unavailable (HTTP ${response.status}). Retry later or write manually.`;
      return failure(`${guidance} Nothing was saved.`, response.status === 429 ? 429 : 502, 'provider');
    }
    const reply: unknown = await response.json().catch(() => null);
    const message = reply && typeof reply === 'object'
      ? (reply as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> })?.choices?.[0]?.message
      : undefined;
    const content = typeof message?.content === 'string' ? message.content
      : Array.isArray(message?.content) ? message.content.map(part => part.text || '').join('\n') : '';
    if (!content.trim()) return failure('OpenRouter returned no draft text. Check the configured model, then retry.', 502, 'response');
    let parsed: Record<string, unknown>;
    try { parsed = jsonObject(content); }
    catch { return failure('OpenRouter returned an invalid JSON draft. Retry or switch OPENROUTER_PROPOSAL_MODEL to a model that supports JSON responses.', 502, 'response'); }
    const result: DraftOutput = {
      heading: limit(parsed.heading, 100),
      introduction: limit(parsed.introduction, 900),
      scope: limit(parsed.scope, 1800),
    };
    if (!result.heading || !result.introduction || !result.scope) return failure('The AI response was missing required sections. No proposal was saved.', 502, 'response');
    return NextResponse.json({ suggestion: result, saved: false, sent: false }, { headers: noStore });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return failure('OpenRouter took too long to respond (29 seconds). No draft was saved. Check model speed or set OPENROUTER_PROPOSAL_MODEL to a faster model.', 504, 'timeout');
    }
    return failure('Unable to contact OpenRouter. Check the provider status and deployment logs; manual proposal editing still works.', 502, 'provider');
  }
}
