"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileDown, ImagePlus, Loader2, Save, Sparkles } from "lucide-react";
import "./proposal-composer.css";

type ProposalLine = { id: string; item_name: string; quantity: number; unit_price: number; line_total: number };
type ProposalDocument = {
  id: string; updated_at: string;
  heading: string; introduction: string; scope: string; payment_terms: string;
  validity_days: number; vat_mode: "unset" | "inclusive" | "exclusive";
  vat_rate: number; subtotal: number; vat_amount: number; total_amount: number;
  brand_logo_data: string | null;
  source_line_snapshot: Array<{ item_name: string; quantity: number; unit_price: number; line_total: number }>;
};
type Suggestion = { heading: string; introduction: string; scope: string };
const euro = (amount: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);
function figures(subtotal: number, mode: string, rate: number) {
  const vat = mode === "inclusive" ? Math.round(subtotal * rate / (100 + rate) * 100) / 100 :
    mode === "exclusive" ? Math.round(subtotal * rate / 100 * 100) / 100 : 0;
  return { vat, total: mode === "exclusive" ? Math.round((subtotal + vat) * 100) / 100 : subtotal };
}
export default function ProposalComposer({ workspaceId, quoteId, companyName, customerName, customerEmail, status, subtotal, lines, canWrite }: {
  workspaceId: string; quoteId: string; companyName: string; customerName: string;
  customerEmail: string | null; status: string; subtotal: number;
  lines: ProposalLine[]; canWrite: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [doc, setDoc] = useState<ProposalDocument | null>(null);
  const [dirty, setDirty] = useState(false);
  const [heading, setHeading] = useState("Quotation proposal");
  const [introduction, setIntroduction] = useState("");
  const [scope, setScope] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [validityDays, setValidityDays] = useState(14);
  const [vatMode, setVatMode] = useState<"unset" | "inclusive" | "exclusive">("unset");
  const [vatRate, setVatRate] = useState(19);
  const [logo, setLogo] = useState<string | null>(null);
  const [logoReading, setLogoReading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const eligible = status === "draft" && lines.length > 0;
  const vatValid = Number.isFinite(vatRate) && vatRate >= 0 && vatRate <= 25 && Math.abs(Math.round(vatRate * 100) - vatRate * 100) < 1e-7;
  const displayed = figures(Number(subtotal), vatMode, vatValid ? vatRate : 0);
  const stale = !!doc && (
    Math.abs(Number(doc.subtotal) - Number(subtotal)) > 0.009 ||
    !Array.isArray(doc.source_line_snapshot) ||
    doc.source_line_snapshot.length !== lines.length ||
    lines.some((line, i) => {
      const saved = doc.source_line_snapshot[i];
      return !saved || saved.item_name !== line.item_name ||
        Number(saved.quantity) !== Number(line.quantity) ||
        Math.abs(Number(saved.unit_price) - Number(line.unit_price)) > 0.009 ||
        Math.abs(Number(saved.line_total) - Number(line.line_total)) > 0.009;
    })
  );

  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setNotice(""); setSuggestion(null); setDoc(null); setDirty(false);
    setHeading("Quotation proposal"); setIntroduction(""); setScope("");
    setPaymentTerms(""); setValidityDays(14); setVatMode("unset"); setVatRate(19); setLogo(null);
    void (async () => {
      const { data, error: readError } = await supabase.from("intrigue_proposal_documents")
        .select("id,heading,introduction,scope,payment_terms,validity_days,vat_mode,vat_rate,subtotal,vat_amount,total_amount,brand_logo_data,source_line_snapshot,updated_at")
        .eq("workspace_id", workspaceId).eq("quotation_id", quoteId).maybeSingle();
      if (!active) return;
      if (readError) setError(`Unable to load proposal: ${readError.message}. Ensure the V16.5.1 SQL migration is installed.`);
      if (data) {
        const saved = data as ProposalDocument;
        setDoc(saved); setHeading(saved.heading); setIntroduction(saved.introduction);
        setScope(saved.scope); setPaymentTerms(saved.payment_terms);
        setValidityDays(saved.validity_days); setVatMode(saved.vat_mode);
        setVatRate(Number(saved.vat_rate)); setLogo(saved.brand_logo_data);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [supabase, workspaceId, quoteId]);

  const change = (setter: (s: string) => void, value: string) => { setter(value); setDirty(true); setNotice(""); };
  const setTreatment = (next: "unset" | "inclusive" | "exclusive") => { setVatMode(next); setDirty(true); };
  const onLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    // Do not let the file input interact with any surrounding dashboard click/form handler.
    event.stopPropagation();
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 125000) {
      setError("Choose a PNG or JPEG logo smaller than 125 KB. The logo was not changed.");
      return;
    }
    setLogoReading(true);
    setError("");
    setNotice("Reading company logo…");
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unreadable logo"));
        reader.onerror = () => reject(new Error("Logo file could not be read"));
        reader.readAsDataURL(file);
      });
      // The RPC enforces a 180,000-character data URL limit, including the prefix.
      if (data.length > 180000) throw new Error("Logo is too large after encoding. Choose a smaller PNG/JPEG.");
      setLogo(data);
      setDirty(true);
      setError("");
      setNotice(`Logo ready: ${file.name}. Click Save proposal changes to keep it.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Logo upload failed.");
      setNotice("");
    } finally {
      setLogoReading(false);
    }
  };

  const suggest = async () => {
    if (!eligible || !canWrite || generating) return;
    setGenerating(true); setError(""); setNotice(""); setSuggestion(null);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) throw new Error("Sign in again to use AI drafting.");
      const response = await fetch("/api/proposals/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId, quotationId: quoteId }),
      });
      const result: unknown = await response.json();
      const payload = result && typeof result === "object" ? result as Record<string, unknown> : {};
      if (!response.ok) throw new Error(String(payload.error || "AI drafting failed"));
      const draft = payload.suggestion as Suggestion | undefined;
      if (!draft?.heading || !draft?.introduction || !draft?.scope) throw new Error("AI returned an incomplete suggestion.");
      setSuggestion(draft);
      setNotice("AI wording is ready for review. Nothing has been saved or sent.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to prepare AI wording."); }
    finally { setGenerating(false); }
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    setHeading(suggestion.heading); setIntroduction(suggestion.introduction);
    setScope(suggestion.scope); setDirty(true); setSuggestion(null);
    setNotice("AI wording applied locally. Review and save it before printing.");
  };
  const save = async () => {
    if (!canWrite || !eligible || busy) return;
    if (!heading.trim() || heading.length > 140 || introduction.length > 2500 || scope.length > 4000 || paymentTerms.length > 1400) {
      setError("Check the proposal title and text lengths."); return;
    }
    if (!vatValid) { setError("Enter a VAT rate between 0 and 25%, with at most two decimal places."); return; }
    if (logoReading) { setError("Finish loading the logo before saving."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const { data, error: saveError } = await supabase.rpc("intrigue_proposal_save", {
        p_workspace_id: workspaceId, p_quotation_id: quoteId,
        p_heading: heading.trim(), p_introduction: introduction, p_scope: scope,
        p_payment_terms: paymentTerms, p_validity_days: validityDays,
        p_vat_mode: vatMode, p_vat_rate: vatRate, p_brand_logo_data: logo,
      });
      if (saveError) throw new Error(saveError.message);
      const result = data as { document_id?: string; subtotal?: number; vat_amount?: number; total_amount?: number; updated_at?: string; source_line_snapshot?: ProposalDocument["source_line_snapshot"] } | null;
      if (!result?.document_id) throw new Error("The database did not return a saved proposal.");
      setDoc({ id: result.document_id, updated_at: result.updated_at ?? new Date().toISOString(), heading, introduction, scope, payment_terms: paymentTerms,
        validity_days: validityDays, vat_mode: vatMode, vat_rate: vatRate,
        subtotal: Number(result.subtotal), vat_amount: Number(result.vat_amount),
        total_amount: Number(result.total_amount), brand_logo_data: logo,
        source_line_snapshot: result.source_line_snapshot ?? [] });
      setDirty(false);
      setNotice("Proposal draft saved in this workspace. Nothing was approved or sent.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save the proposal."); }
    finally { setBusy(false); }
  };
  const print = async () => {
    if (!doc || dirty || stale || busy || logoReading) return;
    setBusy(true); setError("");
    try {
      // Recheck live records before printing; a different tab/staff member may have changed the quote.
      const [quoteResponse, linesResponse, documentResponse] = await Promise.all([
        supabase.from("quotations").select("status,amount").eq("workspace_id", workspaceId).eq("id", quoteId).single(),
        supabase.from("quotation_line_items").select("item_name,quantity,unit_price,line_total,position")
          .eq("workspace_id", workspaceId).eq("quotation_id", quoteId).order("position"),
        supabase.from("intrigue_proposal_documents").select("id,updated_at,source_line_snapshot")
          .eq("workspace_id", workspaceId).eq("quotation_id", quoteId).single(),
      ]);
      if (quoteResponse.error || linesResponse.error || documentResponse.error) throw new Error("Could not verify the latest draft. Refresh before printing.");
      const latestQuote = quoteResponse.data;
      const latestDocument = documentResponse.data;
      const freshLines = linesResponse.data ?? [];
      if (latestQuote?.status !== "draft" || Math.abs(Number(latestQuote?.amount) - Number(doc.subtotal)) > 0.009 ||
          latestDocument?.id !== doc.id || latestDocument?.updated_at !== doc.updated_at ||
          freshLines.length !== doc.source_line_snapshot.length ||
          freshLines.some((line, i) => {
            const saved = doc.source_line_snapshot[i];
            return !saved || saved.item_name !== line.item_name || Number(saved.quantity) !== Number(line.quantity) ||
              Math.abs(Number(saved.unit_price) - Number(line.unit_price)) > 0.009 ||
              Math.abs(Number(saved.line_total) - Number(line.line_total)) > 0.009;
          })) {
        throw new Error("This proposal or its quotation changed. Refresh and save the latest version before printing.");
      }
      document.documentElement.dataset.intrigueProposalPrint = "true";
      const cleanup = () => { delete document.documentElement.dataset.intrigueProposalPrint; window.removeEventListener("afterprint", cleanup); };
      window.addEventListener("afterprint", cleanup);
      window.print();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to verify the draft for printing."); }
    finally { setBusy(false); }
  };

  return <section className="pc-panel" aria-label="AI-assisted proposal composer">
    <div className="pc-heading"><div><h3>Proposal Composer</h3><p>Draft wording, configure commercial terms, and prepare a branded, unsent document.</p></div>
      <span className="pc-pill">{doc ? "Saved draft" : "Not saved"}</span></div>
    {loading ? <p className="pc-muted"><Loader2 size={14}/> Loading proposal…</p> : <>
      {error && <p role="alert" className="pc-error">{error}</p>}
      {notice && <p role="status" className="pc-notice">{notice}</p>}
      {stale && <p role="alert" className="pc-error">The quotation subtotal has changed since this proposal was saved. Review and save this proposal again before printing.</p>}
      {!eligible && <p className="pc-muted">Only catalog-backed quotation drafts can be edited as proposals.</p>}
      <div className="pc-grid">
        <label>Proposal title<input maxLength={140} disabled={!canWrite || !eligible} value={heading} onChange={e => change(setHeading, e.target.value)}/></label>
        <label>Validity after issue (days)<input type="number" min={1} max={90} disabled={!canWrite || !eligible} value={validityDays} onChange={e => { setValidityDays(Number(e.target.value)); setDirty(true); }}/></label>
      </div>
      <label>Introduction<textarea rows={3} maxLength={2500} disabled={!canWrite || !eligible} value={introduction} onChange={e => change(setIntroduction,e.target.value)} placeholder="Introduce the customer's requested items and your proposed approach."/></label>
      <label>Scope and deliverables<textarea rows={4} maxLength={4000} disabled={!canWrite || !eligible} value={scope} onChange={e => change(setScope,e.target.value)} placeholder="Summarize precisely what's included. Avoid unverified promises."/></label>
      <div className="pc-grid">
        <label>VAT treatment
          <select disabled={!canWrite || !eligible} value={vatMode} onChange={e => setTreatment(e.target.value as "unset"|"inclusive"|"exclusive")}>
            <option value="unset">Not set (internal draft)</option>
            <option value="inclusive">Catalog prices include VAT</option>
            <option value="exclusive">Add VAT to catalog prices</option>
          </select>
        </label>
        <label>VAT rate (%)
          <input type="number" inputMode="decimal" min={0} max={25} step={0.01}
            aria-label="Custom VAT rate percentage" disabled={!canWrite || !eligible || vatMode === "unset"}
            value={Number.isFinite(vatRate) ? vatRate : ""} onChange={e => { setVatRate(e.target.value === "" ? NaN : Number(e.target.value)); setDirty(true); setNotice(""); }}/>
          <span className="pc-muted">Enter your verified rate, including decimals (0–25%).</span>
        </label>
      </div>
      {!vatValid && <p role="alert" className="pc-error">Enter a VAT rate from 0 to 25% using no more than two decimal places.</p>}
      <p className="pc-muted">VAT is selected manually by an authorized user. The AI does not determine the legal tax rate. Verify the customer's jurisdiction and whether catalog prices include VAT.</p>
      <div className="pc-math"><div><span>Catalog subtotal</span><strong>{euro(Number(subtotal))}</strong></div>
        <div><span>{vatMode === "unset" ? "VAT not assessed" : vatMode === "inclusive" ? `VAT included (${vatRate}%)` : `VAT added (${vatRate}%)`}</span><strong>{vatMode === "unset" ? "Pending" : euro(displayed.vat)}</strong></div>
        <div className="pc-grand"><span>Draft total</span><strong>{euro(displayed.total)}</strong></div>
      </div>
      <label>Payment and commercial terms<textarea rows={2} maxLength={1400} disabled={!canWrite || !eligible} value={paymentTerms} onChange={e => change(setPaymentTerms,e.target.value)} placeholder="Enter your approved payment, return and delivery terms."/></label>
      <div className="pc-logo"><div>{logo && <img src={logo} alt="Company logo preview"/>}<div><strong>Company logo</strong><p>Optional PNG/JPEG (max 125 KB). Preview it, then save the proposal to keep it. Company name is always shown.</p></div></div>
        <input ref={logoInputRef} type="file" accept="image/png,image/jpeg" hidden
          aria-label="Choose company logo image" onClick={e => e.stopPropagation()} onChange={onLogo}/>
        {canWrite && eligible && <button type="button" className="pc-upload" disabled={logoReading || busy}
          onClick={e => { e.preventDefault(); e.stopPropagation(); logoInputRef.current?.click(); }}>
          {logoReading ? <Loader2 size={15}/> : <ImagePlus size={15}/>}{logoReading ? "Loading logo…" : logo ? "Change logo" : "Upload logo"}
        </button>}
        {canWrite && eligible && logo && <button type="button" className="pc-secondary" disabled={logoReading || busy}
          onClick={() => {setLogo(null);setDirty(true);setNotice("Logo removed locally. Save the proposal to keep this change.");}}>Remove logo</button>}
      </div>
      {canWrite && eligible && <div className="pc-actions">
        <button type="button" className="pc-secondary" disabled={generating || busy} onClick={suggest}><Sparkles size={15}/>{generating ? "Preparing AI suggestion…" : "Suggest wording with AI"}</button>
        <button type="button" className="pc-primary" disabled={busy || generating || logoReading || !vatValid || !dirty && !!doc} onClick={save}><Save size={15}/>{busy ? "Saving…" : doc ? "Save proposal changes" : "Save proposal draft"}</button>
      </div>}
      {suggestion && <div className="pc-ai-preview"><strong>AI suggestion (not saved)</strong><p><b>{suggestion.heading}</b></p><p>{suggestion.introduction}</p><p>{suggestion.scope}</p>
        <button type="button" className="pc-primary" onClick={applySuggestion}>Apply suggestion to editor</button>
        <button type="button" className="pc-secondary" onClick={() => setSuggestion(null)}>Discard</button></div>}
      {doc && <div className="pc-actions"><button type="button" className="pc-secondary" disabled={dirty || stale || busy || logoReading} onClick={() => { void print(); }}><FileDown size={15}/> Print / Save as PDF</button>
        {(dirty || stale) && <span className="pc-muted">Save changes before printing.</span>}</div>}
      <p className="pc-muted">No email, payment, approval, or signature is triggered. AI sends limited catalog, company-policy and masked enquiry-summary text to your configured provider; use only where your privacy agreements permit.</p>
      {doc && <div className="pc-print" aria-hidden="true">
        <div className="pc-paper-top">{doc.brand_logo_data && <img src={doc.brand_logo_data} alt=""/>}<div><strong>{companyName}</strong><small>COMMERCIAL PROPOSAL · UNSENT DRAFT</small></div></div>
        <h1>{doc.heading}</h1><div className="pc-paper-meta"><span>Quote QT-{quoteId.slice(0,8).toUpperCase()}</span><span>Valid for {doc.validity_days} days after issue</span></div>
        <div className="pc-paper-customer"><strong>Prepared for</strong><p>{customerName}</p><p>{customerEmail || "Contact not provided"}</p></div>
        {doc.introduction && <section><h2>Introduction</h2><p>{doc.introduction}</p></section>}
        {doc.scope && <section><h2>Proposed scope</h2><p>{doc.scope}</p></section>}
        <section><h2>Products and services</h2><table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead><tbody>
          {lines.map(line => <tr key={line.id}><td>{line.item_name}</td><td>{line.quantity}</td><td>{euro(Number(line.unit_price))}</td><td>{euro(Number(line.line_total))}</td></tr>)}
        </tbody></table>
          <div className="pc-paper-totals"><div><span>Catalog subtotal</span><strong>{euro(Number(doc.subtotal))}</strong></div>
          <div><span>{doc.vat_mode === "unset" ? "VAT not set" : doc.vat_mode === "inclusive" ? `Included VAT (${doc.vat_rate}%)` : `Added VAT (${doc.vat_rate}%)`}</span><strong>{doc.vat_mode === "unset" ? "Pending" : euro(Number(doc.vat_amount))}</strong></div>
          <div><span>Draft total</span><strong>{euro(Number(doc.total_amount))}</strong></div></div>
        </section>
        {doc.payment_terms && <section><h2>Commercial terms</h2><p>{doc.payment_terms}</p></section>}
        <footer>UNSENT DRAFT · NOT A TAX INVOICE · Subject to company review and approval before issue. Made by INTRIGUE Studios.</footer>
      </div>}
    </>}
  </section>;
}
