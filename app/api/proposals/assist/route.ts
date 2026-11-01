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
  // This endpoint uses its own drafting model. Do not inherit a general-purpose
  // OPENROUTER_MODEL that might return reasoning/tool calls but no final text.
  const defaultModel = 'openai/gpt-4o-mini';
  const preferredModel = process.env.OPENROUTER_PROPOSAL_MODEL?.trim() || defaultModel;
  const models = preferredModel === defaultModel ? [defaultModel] : [preferredModel, defaultModel];
  let diagnostic = 'Provider did not supply a completed text response.';
  try {
    for (let attempt = 0; attempt < models.length; attempt++) {
      const model = models[attempt];
      let response: Response;
      try {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          signal: AbortSignal.timeout(23000),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://intriguestudios.de',
            'X-Title': 'INTRIGUE Operations AI',
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 1800,
            ...(model === defaultModel ? { response_format: { type: 'json_object' } } : {}),
            messages: [
              { role: 'system', content: 'You write concise commercial proposal wording. Return a JSON object with exactly these keys: heading, introduction, scope. Each value MUST be a nonempty string. Only refer to the supplied business, item names and factual business guidance. Do not invent prices, VAT, delivery promises, discounts, guarantees or personal details. This is an unsent draft subject to company review. Heading max 100 chars; introduction max 900; scope max 1800. Output JSON only.' },
              { role: 'user', content: JSON.stringify(payload) },
            ],
          }),
        });
      } catch (requestError) {
        if (requestError instanceof Error && (requestError.name === 'TimeoutError' || requestError.name === 'AbortError')) {
          diagnostic = `OpenRouter model ${model} timed out while preparing the wording.`;
          if (attempt < models.length - 1) continue;
          return failure(`${diagnostic} Try a faster proposal model or write the wording manually.`, 504, 'timeout');
        }
        return failure('The proposal AI provider could not be reached. Check deployment logs and network settings.', 502, 'provider');
      }
      if (!response.ok) {
        // Do not expose the provider's raw body or API credentials to clients.
        const guidance = response.status === 401 || response.status === 403
          ? 'OpenRouter rejected the API key. Check OPENROUTER_API_KEY in Vercel.'
          : response.status === 402 ? 'OpenRouter credits are insufficient.'
          : response.status === 404 ? `OpenRouter cannot find the proposal model ${model}.`
          : response.status === 429 ? 'OpenRouter rate limit reached.'
          : `OpenRouter returned HTTP ${response.status} for ${model}.`;
        return failure(`${guidance} No content was saved or sent.`, response.status === 429 ? 429 : 502, 'provider');
      }
      const reply: unknown = await response.json().catch(() => null);
      const provider = reply && typeof reply === 'object' ? reply as {
        error?: { message?: string };
        choices?: Array<{ finish_reason?: string; text?: string; message?: { content?: string | Array<{ text?: string; type?: string }>; parsed?: unknown; refusal?: string } }>;
        output_text?: string;
        usage?: { completion_tokens?: number };
      } : null;
      if (provider?.error) {
        return failure(`OpenRouter returned a provider error for ${model}. Check its model availability and your OpenRouter account.`, 502, 'provider');
      }
      const choice = provider?.choices?.[0];
      const rawContent = choice?.message?.content;
      const content = typeof rawContent === 'string' ? rawContent
        : Array.isArray(rawContent) ? rawContent.map(part => part?.text || '').join('\n')
        : choice?.text || provider?.output_text || '';
      const parsedProvider = choice?.message?.parsed;
      let parsed: Record<string, unknown> | null = null;
      if (parsedProvider && typeof parsedProvider === 'object' && !Array.isArray(parsedProvider)) {
        parsed = parsedProvider as Record<string, unknown>;
      } else if (content.trim()) {
        try { parsed = jsonObject(content); } catch { /* A different model may return valid structured output. */ }
      }
      if (parsed) {
        const result: DraftOutput = {
          heading: limit(parsed.heading, 100),
          introduction: limit(parsed.introduction, 900),
          scope: limit(parsed.scope, 1800),
        };
        if (result.heading && result.introduction && result.scope) {
          return NextResponse.json({ suggestion: result, saved: false, sent: false, model_used: model }, { headers: noStore });
        }
      }
      const finishReason = choice?.finish_reason || 'missing';
      const tokens = provider?.usage?.completion_tokens;
      diagnostic = `${model} returned no valid wording (finish_reason=${finishReason}${typeof tokens === 'number' ? `, completion_tokens=${tokens}` : ''}).`;
      console.warn('INTRIGUE proposal AI: no valid text', { model, finishReason, completionTokens: tokens ?? null });
      // A reasoning/tool-only model can produce a successful HTTP 200 with no
      // final content. Retry ONCE using a dedicated non-reasoning JSON model.
    }
    return failure(`${diagnostic} Set OPENROUTER_PROPOSAL_MODEL to a compatible chat model, or use manual wording.`, 502, 'response');
  } catch {
    return failure('Unexpected provider response. Try the proposal AI again or enter the wording manually.', 502, 'response');
  }
}
