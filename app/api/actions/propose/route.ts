import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// V8 deliberately uses deterministic, source-checked action planning.
// The chat model is not trusted to invent prices or perform writes.
const reply = (data: object, status = 200) => NextResponse.json(data, {status, headers: {"Cache-Control": "no-store"}});

type PriceCandidate = {amount: number; source: string};
const SERVICES = [
  {name: "Brake inspection", pattern: /brake\s+inspection/i, sourcePattern: /brake\s+inspection/i},
  {name: "Cabin air filter replacement", pattern: /(?:cabin\s+air\s+filter|air\s+filter\s+replacement)/i, sourcePattern: /cabin\s+air\s+filter/i},
] as const;

function priceFromLine(line: string): number | null {
  const matches = [...line.matchAll(/(?:€\s*|\bEUR\s*)(\d{1,6}(?:[.,]\d{1,2})?)/gi)];
  if (matches.length !== 1) return null;
  const value = Number(matches[0][1].replace(",", "."));
  return Number.isFinite(value) && value > 0 && value < 100000 ? Math.round(value * 100) / 100 : null;
}

function dateInBerlinTomorrow(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(p => p.type === type)?.value || "";
  const berlinToday = `${part("year")}-${part("month")}-${part("day")}`;
  const next = new Date(`${berlinToday}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString(); // Midday UTC avoids the DST boundary at local midnight.
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return reply({error: "Cross-origin request refused."}, 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return reply({error: "Expected JSON."}, 415);
  if (Number(request.headers.get("content-length") || 0) > 3000) return reply({error: "Request too large."}, 413);
  const supabase = await createClient();
  const {data: {user}, error: authError} = await supabase.auth.getUser();
  if (authError || !user) return reply({error: "Sign in first."}, 401);
  let prompt = "";
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "prompt" in body && typeof body.prompt === "string") prompt = body.prompt.trim();
  } catch { return reply({error: "Invalid JSON."}, 400); }
  if (prompt.length < 10 || prompt.length > 1000) return reply({error: "Enter a request between 10 and 1,000 characters."}, 400);

  const wantQuote = /\b(quote|quotation|estimate)\b/i.test(prompt);
  const wantFollow = /follow[ -]?up|remind|reminder/i.test(prompt);
  if (!wantQuote && !wantFollow) return reply({error: "For this demo, request a quotation and/or a follow-up task."}, 422);

  const {data: ws, error: wsError} = await supabase.from("workspaces").select("id,name,owner_id")
    .eq("owner_id", user.id).maybeSingle();
  if (wsError || !ws) return reply({error: "Demo workspace not found."}, 409);

  const {data: customerRows, error: customerError} = await supabase.from("customers")
    .select("id,full_name").eq("workspace_id", ws.id).limit(200);
  if (customerError || !customerRows) return reply({error: "Could not load customers."}, 500);
  const customers = customerRows.filter(c =>
    prompt.toLocaleLowerCase().includes(String(c.full_name).toLocaleLowerCase()));
  if (customers.length !== 1) return reply({error: "Mention exactly one existing customer's full name, for example Alex Fischer."}, 422);
  const customer = customers[0];

  const selectedService = SERVICES.find(s => s.pattern.test(prompt));
  if (!selectedService) return reply({error: "V8 demo supports 'brake inspection' and 'cabin air filter replacement'. State the service in your request."}, 422);

  let quoteDescription: string | null = null;
  let quoteAmount: number | null = null;
  let quoteSource: string | null = null;
  const warnings: string[] = [];

  if (wantQuote) {
    const [kbResult, docsResult, chunksResult] = await Promise.all([
      supabase.from("knowledge_entries").select("title,content").eq("workspace_id", ws.id).limit(100),
      supabase.from("knowledge_documents").select("id,filename").eq("workspace_id", ws.id).limit(100),
      supabase.from("knowledge_document_chunks").select("document_id,page_no,content").eq("workspace_id", ws.id).limit(300),
    ]);
    if (kbResult.error || docsResult.error || chunksResult.error) return reply({error: "Knowledge data unavailable. Verify the V5/V6 setup."}, 503);
    const filenames = new Map((docsResult.data || []).map(d => [d.id, d.filename]));
    const candidates: PriceCandidate[] = [];
    for (const k of kbResult.data || []) {
      const lines = [`${k.title}: ${k.content}`, ...String(k.content).split(/\r?\n/)].slice(0, 80);
      for (const line of lines) {
        if (!selectedService.sourcePattern.test(line)) continue;
        const amount = priceFromLine(line);
        if (amount !== null) candidates.push({amount, source: `Knowledge: ${k.title}`});
      }
    }
    for (const chunk of chunksResult.data || []) {
      for (const line of String(chunk.content).split(/\r?\n/).slice(0, 100)) {
        if (!selectedService.sourcePattern.test(line)) continue;
        const amount = priceFromLine(line);
        if (amount !== null) candidates.push({amount, source: `${filenames.get(chunk.document_id) || "Uploaded document"}, page ${chunk.page_no}`});
      }
    }
    const distinct = [...new Set(candidates.map(c => c.amount))];
    if (distinct.length === 0) return reply({error: `No explicit price for ${selectedService.name} found. Add a price in your Knowledge Base first.`}, 422);
    if (distinct.length > 1) return reply({error: `Conflicting prices (${distinct.join(", ")}) found. Resolve the Knowledge Base conflict before creating a quotation.`}, 422);
    quoteDescription = selectedService.name;
    quoteAmount = distinct[0];
    quoteSource = [...new Set(candidates.filter(c => c.amount === quoteAmount).map(c => c.source))].join("; ").slice(0, 450);
    warnings.push("Draft only. Verify VAT, additional work, and the customer's existing quotations before approving.");
  }

  let followTitle: string | null = null;
  let followDue: string | null = null;
  if (wantFollow) {
    if (/\btomorrow\b/i.test(prompt)) followDue = dateInBerlinTomorrow();
    else {
      const dateMatch = prompt.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (dateMatch && !Number.isNaN(Date.parse(`${dateMatch[1]}T12:00:00Z`))) {
        followDue = `${dateMatch[1]}T12:00:00.000Z`;
      }
    }
    if (!followDue || new Date(followDue).getTime() < Date.now()) {
      return reply({error: "Specify a future due date: 'tomorrow' or YYYY-MM-DD."}, 422);
    }
    followTitle = wantQuote
      ? `Follow up about ${selectedService.name.toLowerCase()} quotation`
      : `Follow up about ${selectedService.name.toLowerCase()}`;
  }

  const [quotesResult, tasksResult] = await Promise.all([
    supabase.from("quotations").select("id,description,amount,status").eq("workspace_id",ws.id).eq("customer_id",customer.id).limit(100),
    supabase.from("follow_ups").select("id,title,due_at,status").eq("workspace_id",ws.id).eq("customer_id",customer.id).limit(100),
  ]);
  if (quotesResult.error || tasksResult.error) return reply({error: "Could not check existing actions."}, 500);
  const quotes = quotesResult.data || [];
  const tasks = tasksResult.data || [];
  if (quoteDescription && quotes.some(q =>
    q.description.trim().toLowerCase() === quoteDescription!.toLowerCase() && Number(q.amount) === quoteAmount)) {
    return reply({error: "An identical quotation already exists for this customer. Review it before creating another."}, 409);
  }
  const relatedTerm = selectedService.name === "Brake inspection" ? /brake/i : /filter/i;
  const related = quotes.filter(q => relatedTerm.test(String(q.description)) && ["draft","awaiting_review","approved"].includes(q.status));
  // V9 is conservative: never create another quote for a customer who already has
  // an active quotation for the same service family, even if its amount differs.
  if (quoteDescription && related.length) return reply({error:
    `A related quotation already exists: ${related.slice(0,3).map(q=>`${q.description} (€${Number(q.amount).toFixed(2)}, ${q.status})`).join("; ")}. Review the existing quote first. If needed, request a follow-up only.`},409);
  const relatedTasks = tasks.filter(t => t.status === "pending" && relatedTerm.test(String(t.title)));
  if (followTitle && relatedTasks.length) return reply({error:
    `This customer already has a related pending follow-up: ${relatedTasks.slice(0,2).map(t => t.title).join("; ")}. Review or complete that task before creating another.`},409);

  const {data: existingProposals, error: proposalsError} = await supabase.from("action_proposals")
    .select("id").eq("workspace_id",ws.id).eq("customer_id",customer.id)
    .eq("status","pending").eq("request_text",prompt).limit(1);
  if (proposalsError) return reply({error: "Action Center unavailable. Run V8 SQL first."}, 503);
  if (existingProposals?.length) return reply({error: "An identical request is already awaiting approval in Action Center."}, 409);

  const {data, error} = await supabase.from("action_proposals").insert({
    workspace_id: ws.id,
    owner_id: user.id,
    customer_id: customer.id,
    request_text: prompt,
    quote_description: quoteDescription,
    quote_amount: quoteAmount,
    quote_source: quoteSource,
    follow_up_title: followTitle,
    follow_up_due_at: followDue,
    warning_text: warnings.join("\n"),
  }).select("id").single();
  if (error || !data) return reply({error: `Could not save proposal. Has the V8 SQL been run? ${error?.message || ""}`}, 503);
  return reply({id:data.id,status:"pending"});
}
