"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, FileText, Pencil, Plus, Printer, Search, Trash2, X } from "lucide-react";
import { euro, quoteSubtotal, type DraftItem, type CatalogPrice } from "./quote-math";
import "./quotations-studio.css";
import ProposalComposer from "./ProposalComposer";

type Customer = { id: string; full_name: string; email: string | null };
type Quote = { id: string; customer_id: string; description: string; amount: number; status: string; created_at: string; quote_note?: string | null; currency?: string | null };
type Line = { id: string; catalog_id: string | null; item_name: string; quantity: number; unit_price: number; line_total: number; currency: string; position: number };
const randomItem = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
type RowDraft = DraftItem & { localId: string };
const emptyRows = (): RowDraft[] => [{ localId: randomItem(), catalogId: "", quantity: 1 }];
// Persist only an opaque quotation ID, never customer details or draft contents.
const selectionKey = (workspace: string) => `intrigue:quotation:selection:${workspace}`;
function storedSelection(workspace: string): string | null {
  if (typeof window === "undefined" || !workspace) return null;
  try {
    const value = window.sessionStorage.getItem(selectionKey(workspace));
    return value && /^[0-9a-fA-F-]{36}$/.test(value) ? value : null;
  } catch { return null; }
}
function writeSelection(workspace: string, id: string | null) {
  if (typeof window === "undefined" || !workspace) return;
  try {
    if (id) window.sessionStorage.setItem(selectionKey(workspace), id);
    else window.sessionStorage.removeItem(selectionKey(workspace));
  } catch { /* Browser storage might be unavailable; live state still works. */ }
}

export default function QuotationsStudio({ workspaceId, companyName, customers, services, quotes, canWrite, refresh }: {
  workspaceId: string;
  companyName: string;
  customers: Customer[];
  services: CatalogPrice[];
  quotes: Quote[];
  canWrite: boolean;
  refresh: () => Promise<unknown> | void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const requestSerial = useRef(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "draft">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<RowDraft[]>(emptyRows);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const byCustomer = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);
  const byService = useMemo(() => new Map(services.map(s => [s.id, s])), [services]);
  const activeServices = useMemo(() => services.filter(s => s.is_active && s.currency === "EUR" && Number(s.price) > 0), [services]);
  const selected = quotes.find(q => q.id === selectedId) ?? null;
  const matches = quotes.filter(q => {
    if (filter === "draft" && q.status !== "draft") return false;
    const c = byCustomer.get(q.customer_id);
    return `${c?.full_name ?? ""} ${c?.email ?? ""} ${q.description} ${q.id}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  let estimate: number | null = null;
  try { estimate = quoteSubtotal(rows.filter(r => r.catalogId), services); } catch { estimate = null; }
  const customer = selected ? byCustomer.get(selected.customer_id) : null;

  // On mount or workspace switch, restore the last *selected quotation for this workspace*.
  // Explicitly leaving the quotation through "All quotations" clears it. We do not
  // store customer details or unsaved proposal content in sessionStorage.
  useEffect(() => {
    requestSerial.current += 1;
    setSelectedId(storedSelection(workspaceId));
    setLines([]); setDetailError(""); setFormOpen(false);
    setEditingId(null); setCustomerId(""); setRows(emptyRows()); setNote(""); setError(""); setNotice("");
  }, [workspaceId]);

  const selectQuote = (id: string | null) => {
    writeSelection(workspaceId, id);
    setSelectedId(id);
  };

  const loadLines = useCallback(async (id: string) => {
    if (!workspaceId) return;
    const serial = ++requestSerial.current;
    setDetailLoading(true); setDetailError(""); setLines([]);
    const res = await supabase.from("quotation_line_items")
      .select("id,catalog_id,item_name,quantity,unit_price,line_total,currency,position")
      .eq("workspace_id", workspaceId).eq("quotation_id", id).order("position");
    if (serial !== requestSerial.current) return;
    setLines((res.data ?? []) as Line[]);
    if (res.error) setDetailError(res.error.message);
    setDetailLoading(false);
  }, [supabase, workspaceId]);

  useEffect(() => {
    if (selectedId && quotes.some(q => q.id === selectedId)) void loadLines(selectedId);
  }, [selectedId, quotes, loadLines]);

  const startNew = () => {
    selectQuote(null); setEditingId(null); setCustomerId(""); setRows(emptyRows());
    setNote(""); setError(""); setNotice(""); setFormOpen(true);
  };
  const openQuote = (id: string) => { setFormOpen(false); selectQuote(id); setNotice(""); setError(""); };
  const editQuote = () => {
    if (!selected || selected.status !== "draft" || !lines.length || !canWrite) return;
    if (lines.some(l => !l.catalog_id || !byService.has(l.catalog_id) || !byService.get(l.catalog_id)?.is_active)) {
      setDetailError("A catalog item is no longer available. This draft is read-only until the catalog is reviewed."); return;
    }
    setEditingId(selected.id);
    setCustomerId(selected.customer_id);
    setNote(selected.quote_note || "");
    setRows(lines.map(l => ({ localId: randomItem(), catalogId: l.catalog_id || "", quantity: Number(l.quantity) })));
    selectQuote(null); setError(""); setNotice(""); setFormOpen(true);
  };
  const updateRow = (localId: string, field: "catalogId" | "quantity", value: string) => {
    setRows(old => old.map(r => r.localId !== localId ? r : ({ ...r, [field]: field === "quantity" ? Number(value) : value })));
  };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !canWrite || saving) return;
    if (!byCustomer.has(customerId)) { setError("Choose a customer in this workspace."); return; }
    if (rows.length < 1 || rows.length > 30 || rows.some(r => !r.catalogId)) { setError("Choose between 1 and 30 catalog items."); return; }
    if (new Set(rows.map(r => r.catalogId)).size !== rows.length) { setError("Each product or service should appear once; increase its quantity instead."); return; }
    if (rows.some(r => !Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > 100)) { setError("Quantity must be a whole number between 1 and 100."); return; }
    try {
      const amount = quoteSubtotal(rows, services);
      if (amount <= 0) throw new Error("The quote total must be positive.");
    } catch (e) { setError(e instanceof Error ? e.message : "Invalid catalog prices."); return; }
    if (note.trim().length > 1500) { setError("Notes must be 1,500 characters or less."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const { data, error: saveError } = await supabase.rpc("intrigue_quote_save_draft", {
        p_workspace_id: workspaceId,
        p_customer_id: customerId,
        p_items: rows.map(r => ({ catalog_id: r.catalogId, quantity: r.quantity })),
        p_note: note.trim(),
        p_quote_id: editingId,
      });
      if (saveError) throw new Error(saveError.message);
      const created = data as { quotation_id?: string; amount?: number } | null;
      if (!created?.quotation_id) throw new Error("The database did not return the saved draft ID.");
      setFormOpen(false); setEditingId(null);
      setNotice(`Draft saved: ${euro(Number(created.amount ?? 0))}. Nothing was sent to the customer.`);
      await refresh();
      selectQuote(created.quotation_id);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save this quotation."); }
    finally { setSaving(false); }
  }

  return <section className="intrigue-quote-studio" aria-label="Quotations and proposals">
    <header className="qs-panel qs-main-head">
      <div>
        <span className="qs-eyebrow">{companyName} · Quotation workspace</span>
        <h2>Quotation Studio</h2>
        <p>Build verified catalog-priced drafts, review customer details, and prepare a printable proposal. Sending is disabled.</p>
      </div>
      {canWrite && <button type="button" className="qs-primary" onClick={startNew}><Plus size={16}/> New draft</button>}
    </header>

    <div className="qs-stats">
      <div><strong>{quotes.length}</strong><span>Total quotations</span></div>
      <div><strong>{quotes.filter(q => q.status === "draft").length}</strong><span>Unsent drafts</span></div>
      <div><strong>{activeServices.length}</strong><span>Active EUR catalog items</span></div>
    </div>
    {notice && <p role="status" className="qs-notice">{notice}</p>}
    {error && !formOpen && <p role="alert" className="qs-error">{error}</p>}

    {formOpen ? <form className="qs-panel qs-form" onSubmit={save}>
      <div className="qs-topline"><div><h3>{editingId ? "Edit catalog-backed draft" : "Create catalog-backed draft"}</h3><p>Prices are resolved again by Supabase when you save. No AI-invented prices.</p></div><button type="button" className="qs-icon" aria-label="Close form" onClick={() => { setFormOpen(false); setError(""); }}><X size={18}/></button></div>
      <label className="qs-label">Customer
        <select required value={customerId} disabled={Boolean(editingId)} onChange={e => setCustomerId(e.target.value)}>
          <option value="">Select an existing customer</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.full_name}{c.email ? ` (${c.email})` : ""}</option>)}
        </select>
      </label>
      <div className="qs-topline"><h4>Products / services</h4><button className="qs-secondary" type="button" disabled={rows.length >= 30} onClick={() => setRows(old => [...old, ...emptyRows()])}><Plus size={14}/> Add line</button></div>
      {!activeServices.length && <p className="qs-error">No active EUR-priced catalog items. Add items in Product / Service Catalog first.</p>}
      <div className="qs-items">
        {rows.map((r, index) => <div className="qs-item" key={r.localId}>
          <label className="qs-label">Item {index + 1}
            <select required value={r.catalogId} onChange={e => updateRow(r.localId, "catalogId", e.target.value)}>
              <option value="">Choose catalog item</option>
              {activeServices.map(s => <option key={s.id} value={s.id}>{s.name} · {euro(Number(s.price))}</option>)}
            </select>
          </label>
          <label className="qs-label">Qty<input type="number" min={1} max={100} step={1} required value={r.quantity || ""} onChange={e => updateRow(r.localId, "quantity", e.target.value)}/></label>
          <div className="qs-unit">{r.catalogId && byService.has(r.catalogId) ? euro(Number(byService.get(r.catalogId)?.price ?? 0) * (r.quantity || 0)) : "Select an item"}</div>
          <button type="button" aria-label={`Remove item ${index + 1}`} className="qs-icon" disabled={rows.length === 1} onClick={() => setRows(old => old.filter(x => x.localId !== r.localId))}><Trash2 size={16}/></button>
        </div>)}
      </div>
      <label className="qs-label">Internal notes (optional)
        <textarea maxLength={1500} value={note} onChange={e => setNote(e.target.value)} placeholder="Scope, delivery assumptions, or questions to clarify before sending" rows={3}/>
      </label>
      <div className="qs-total"><div><span>Catalog subtotal</span><strong>{estimate === null ? "Check prices" : euro(estimate)}</strong></div><small>VAT, shipping, discounts and payment terms are not configured. This is an internal draft, not a tax invoice or a client-ready offer.</small></div>
      {error && <p role="alert" className="qs-error">{error}</p>}
      <div className="qs-actions"><button className="qs-primary" type="submit" disabled={saving || !activeServices.length || !customers.length}>{saving ? "Saving draft…" : editingId ? "Save draft changes" : "Save unsent draft"}</button><button type="button" className="qs-secondary" onClick={() => { setFormOpen(false); setError(""); }}>Cancel</button></div>
    </form> : selected ? <article className="qs-panel qs-detail">
      <div className="qs-topline"><button type="button" className="qs-secondary" onClick={() => selectQuote(null)}><ArrowLeft size={15}/> All quotations</button><span className="qs-pill">{selected.status}</span></div>
      <div className="qs-topline"><div><span className="qs-eyebrow">QT-{selected.id.slice(0, 8).toUpperCase()}</span><h3>{customer?.full_name ?? "Customer unavailable"}</h3><p>{customer?.email ?? "No email provided"}</p></div><strong className="qs-amount">{euro(Number(selected.amount))}</strong></div>
      {detailLoading ? <p className="qs-muted">Loading draft lines…</p> : detailError ? <p role="alert" className="qs-error">{detailError}</p> : lines.length ? <div className="qs-table-wrap"><table><thead><tr><th>Catalog item</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>{lines.map(l => <tr key={l.id}><td>{l.item_name}</td><td>{l.quantity}</td><td>{euro(Number(l.unit_price))}</td><td>{euro(Number(l.line_total))}</td></tr>)}</tbody></table></div> : <div className="qs-legacy"><strong>Imported or legacy quotation</strong><p>This quote was saved before structured line items existed. It remains readable but its catalog-price sources cannot be reconstructed.</p></div>}
      {lines.length > 0 && !detailLoading && !detailError && <ProposalComposer
        key={workspaceId + ":" + selected.id}
        workspaceId={workspaceId}
        quoteId={selected.id}
        companyName={companyName}
        customerName={customer?.full_name ?? "Unspecified customer"}
        customerEmail={customer?.email ?? null}
        status={selected.status}
        subtotal={Number(selected.amount)}
        lines={lines}
        canWrite={canWrite}
      />}
      <p className="qs-description">{selected.description}</p>
      {selected.quote_note && <p className="qs-muted">Internal note: {selected.quote_note}</p>}
      <div className="qs-actions">
        {canWrite && selected.status === "draft" && lines.length > 0 && <button className="qs-primary" type="button" onClick={editQuote}><Pencil size={15}/> Edit draft</button>}
        {lines.length === 0 && <button type="button" className="qs-secondary" onClick={() => window.print()}><Printer size={15}/> Print / Save as PDF</button>}
      </div>
      <p className="qs-muted">Internal preview only. Printing does not approve, send, charge or sign this quotation.</p>
      <div className="qs-print">
        <div className="qs-print-brand">{companyName}</div>
        <h1>{selected.status === "draft" ? "DRAFT QUOTATION" : "QUOTATION RECORD"}</h1><p>Reference QT-{selected.id.slice(0, 8).toUpperCase()}</p>
        <div><strong>Customer:</strong> {customer?.full_name ?? "Unspecified"}</div><div><strong>Contact:</strong> {customer?.email ?? "Not provided"}</div>
        <hr/>
        <table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>
          {(lines.length ? lines : [{id:"legacy",item_name:selected.description,quantity:1,unit_price:Number(selected.amount),line_total:Number(selected.amount)}]).map(l => <tr key={l.id}><td>{l.item_name}</td><td>{l.quantity}</td><td>{euro(Number(l.unit_price))}</td><td>{euro(Number(l.line_total))}</td></tr>)}
        </tbody></table>
        <div className="qs-print-total">Draft subtotal: {euro(Number(selected.amount))}</div>
        <p className="qs-print-footer">Internal record preview. VAT treatment, commercial terms and validity have not been verified. Not a tax invoice.</p>
      </div>
    </article> : <div className="qs-panel qs-list">
      <div className="qs-topline"><div><h3>Saved quotations</h3><p>Includes imported quotes and drafts created in Customer 360°.</p></div><div className="qs-switch"><button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button><button type="button" className={filter === "draft" ? "active" : ""} onClick={() => setFilter("draft")}>Drafts</button></div></div>
      <label className="qs-search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search customer, reference or description" aria-label="Search quotations"/></label>
      <div className="qs-table-wrap"><table><thead><tr><th>Reference</th><th>Customer</th><th>Description</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
        {matches.map(q => <tr key={q.id}><td className="qs-reference">QT-{q.id.slice(0, 8).toUpperCase()}</td><td>{byCustomer.get(q.customer_id)?.full_name ?? "Unknown"}</td><td className="qs-summary">{q.description}</td><td>{euro(Number(q.amount))}</td><td><span className="qs-pill">{q.status}</span></td><td><button type="button" className="qs-secondary" onClick={() => openQuote(q.id)}><FileText size={14}/> View</button></td></tr>)}
      </tbody></table>{matches.length === 0 && <p className="qs-muted qs-empty">No quotations match this view.</p>}</div>
    </div>}
  </section>;
}
