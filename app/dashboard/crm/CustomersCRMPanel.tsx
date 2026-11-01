"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, CalendarClock, ClipboardList, FileText, Mail, Package, Pencil, Phone, Plus, Search, Users, X } from "lucide-react";
import { isAutomotiveIndustry } from "./IndustryIcon";
import "./customers-crm.css";

type Customer = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  vehicle: string | null;
  created_at: string;
};
type Enquiry = {
  id: string;
  customer_id: string;
  subject: string;
  status: string;
  created_at: string;
};
type Quote = { id: string; customer_id: string; description: string; amount: number; status: string; created_at: string };
type FollowUp = { id: string; customer_id: string; title: string; due_at: string; status: string; priority: string };
type ImportedOrder = { id: string; customer_id: string | null; external_id: string; kind: string; status: string; description: string; amount: number; currency: string; created_at: string };
type ProfileAction = "quote" | "followup" | null;
type TimelineEntry = { id: string; date: string; kind: "enquiry" | "quotation" | "followup" | "order"; title: string; detail: string };
type Draft = { full_name: string; email: string; phone: string; vehicle: string; enquiry: string };
const emptyDraft: Draft = { full_name: "", email: "", phone: "", vehicle: "", enquiry: "" };

function clean(value: string, limit: number) { return value.trim().slice(0, limit); }
function validate(draft: Draft): string | null {
  if (clean(draft.full_name, 151).length < 2 || draft.full_name.trim().length > 150) return "Enter a customer name (2–150 characters).";
  if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) return "Enter a valid email address or leave it blank.";
  if (draft.email.trim().length > 254) return "Email addresses must be under 255 characters.";
  if (draft.phone.trim().length > 40) return "Phone numbers must be under 41 characters.";
  if (draft.phone.trim() && !/^[+0-9().\s-]{5,40}$/.test(draft.phone.trim())) return "Enter a phone number using digits and standard phone symbols.";
  if (draft.vehicle.trim().length > 250 || draft.enquiry.trim().length > 300) return "Vehicle or enquiry information is too long.";
  return null;
}

export default function CustomersCRMPanel({ workspaceId, companyName, industry, customers, enquiries, canWrite, refresh }: {
  workspaceId: string;
  companyName: string;
  industry: string;
  customers: Customer[];
  enquiries: Enquiry[];
  canWrite: boolean;
  refresh: () => Promise<unknown> | void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const automotive = isAutomotiveIndustry(industry);
  const [activeTab, setActiveTab] = useState<"customers" | "enquiries">("customers");
  const [search, setSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [returnTab, setReturnTab] = useState<"customers" | "enquiries">("customers");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileErrors, setProfileErrors] = useState<string[]>([]);
  const [profileQuotes, setProfileQuotes] = useState<Quote[]>([]);
  const [profileFollowUps, setProfileFollowUps] = useState<FollowUp[]>([]);
  const [profileOrders, setProfileOrders] = useState<ImportedOrder[]>([]);
  const [profileAction, setProfileAction] = useState<ProfileAction>(null);
  const [profileDescription, setProfileDescription] = useState("");
  const [profileAmount, setProfileAmount] = useState("");
  const [profileDate, setProfileDate] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const requestSerial = useRef(0);
  const [showEnquiryForm, setShowEnquiryForm] = useState(false);
  const [enquiryCustomerId, setEnquiryCustomerId] = useState("");
  const [enquirySubject, setEnquirySubject] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const byId = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);
  const visibleCustomers = useMemo(() => customers.filter(c =>
    [c.full_name, c.email, c.phone, automotive ? c.vehicle : ""].some(value => (value ?? "").toLowerCase().includes(search.toLowerCase().trim()))
  ), [automotive, customers, search]);
  const visibleEnquiries = useMemo(() => enquiries.filter(e => {
    const c = byId.get(e.customer_id);
    return [e.subject, c?.full_name, c?.email, c?.phone].some(value => (value ?? "").toLowerCase().includes(search.toLowerCase().trim()));
  }), [byId, enquiries, search]);

  const selectedCustomer = selectedCustomerId ? byId.get(selectedCustomerId) : null;
  const customerEnquiries = useMemo(() => selectedCustomerId
    ? enquiries.filter(e => e.customer_id === selectedCustomerId) : [], [enquiries, selectedCustomerId]);

  // Server and RLS remain the final authority. The workspace/customer filters
  // are applied to every query, even when the user opened a profile locally.
  const loadProfile = useCallback(async (customerId: string) => {
    if (!workspaceId || !customers.some(c => c.id === customerId)) return;
    const serial = ++requestSerial.current;
    setProfileLoading(true);
    setProfileErrors([]);
    const [quotes, followups, orders] = await Promise.all([
      supabase.from("quotations")
        .select("id,customer_id,description,amount,status,created_at")
        .eq("workspace_id", workspaceId).eq("customer_id", customerId)
        .order("created_at", { ascending: false }),
      supabase.from("follow_ups")
        .select("id,customer_id,title,due_at,status,priority")
        .eq("workspace_id", workspaceId).eq("customer_id", customerId)
        .order("due_at", { ascending: false }),
      supabase.from("intrigue_imported_orders")
        .select("id,customer_id,external_id,kind,status,description,amount,currency,created_at")
        .eq("workspace_id", workspaceId).eq("customer_id", customerId)
        .order("created_at", { ascending: false }),
    ]);
    if (serial !== requestSerial.current) return;
    setProfileQuotes((quotes.data ?? []) as Quote[]);
    setProfileFollowUps((followups.data ?? []) as FollowUp[]);
    setProfileOrders((orders.data ?? []) as ImportedOrder[]);
    const failures = [
      quotes.error ? `Quotations: ${quotes.error.message}` : null,
      followups.error ? `Follow-ups: ${followups.error.message}` : null,
      orders.error ? `Imported orders: ${orders.error.message}` : null,
    ].filter((x): x is string => Boolean(x));
    setProfileErrors(failures);
    setProfileLoading(false);
  }, [workspaceId, supabase, customers]);

  useEffect(() => {
    // Prevent exposing stale profile records after a workspace switch.
    requestSerial.current += 1;
    setSelectedCustomerId(null);
    setProfileQuotes([]); setProfileFollowUps([]); setProfileOrders([]);
    setProfileErrors([]); setProfileAction(null);
  }, [workspaceId]);

  useEffect(() => {
    if (selectedCustomerId && byId.has(selectedCustomerId)) {
      void loadProfile(selectedCustomerId);
    }
  }, [selectedCustomerId, byId, loadProfile]);

  const openProfile = (customerId: string, from: "customers" | "enquiries") => {
    if (!byId.has(customerId)) return;
    setReturnTab(from); setActiveTab(from);
    setSelectedCustomerId(customerId); setShowCreate(false); setShowEnquiryForm(false);
    setProfileAction(null); setProfileMessage(""); setError(""); setSuccess("");
  };
  const closeProfile = () => {
    requestSerial.current += 1;
    setSelectedCustomerId(null); setActiveTab(returnTab);
    setProfileAction(null); setProfileMessage(""); setProfileErrors([]);
  };
  const startProfileAction = (action: Exclude<ProfileAction, null>) => {
    setProfileAction(action); setProfileDescription(""); setProfileAmount("");
    setProfileDate(""); setProfileMessage("");
  };
  const openProfileEnquiry = () => {
    if (!selectedCustomerId) return;
    const id = selectedCustomerId;
    closeProfile(); setActiveTab("enquiries"); setShowEnquiryForm(true);
    setEnquiryCustomerId(id); setEnquirySubject("");
  };
  const openProfileEdit = () => {
    if (!selectedCustomer) return;
    const customer = selectedCustomer;
    closeProfile(); setActiveTab("customers"); openEdit(customer);
  };
  async function saveProfileAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCustomerId || !byId.has(selectedCustomerId) || !workspaceId || !canWrite || profileSaving || !profileAction) return;
    const description = profileDescription.trim();
    if (description.length < 3 || description.length > 500) {
      setProfileMessage("Enter a description between 3 and 500 characters."); return;
    }
    if (profileAction === "quote" && (!Number.isFinite(Number(profileAmount)) || Number(profileAmount) <= 0 || Number(profileAmount) > 99999999)) {
      setProfileMessage("Enter a valid positive quotation amount."); return;
    }
    if (profileAction === "followup" && (!/^\d{4}-\d{2}-\d{2}$/.test(profileDate) || Number.isNaN(new Date(`${profileDate}T12:00:00`).getTime()))) {
      setProfileMessage("Select a valid follow-up date."); return;
    }
    setProfileSaving(true); setProfileMessage("");
    try {
      const result = profileAction === "quote"
        ? await supabase.from("quotations").insert({
            workspace_id: workspaceId, customer_id: selectedCustomerId,
            description, amount: Number(profileAmount), status: "draft",
          })
        : await supabase.from("follow_ups").insert({
            workspace_id: workspaceId, customer_id: selectedCustomerId,
            title: description, due_at: new Date(`${profileDate}T12:00:00`).toISOString(),
            status: "pending", priority: "normal",
          });
      if (result.error) throw new Error(result.error.message);
      setProfileAction(null);
      setProfileMessage(profileAction === "quote" ? "Draft quotation saved. Nothing was sent." : "Follow-up saved.");
      await refresh();
      await loadProfile(selectedCustomerId);
    } catch (err) {
      setProfileMessage(err instanceof Error ? err.message : "Unable to save this action.");
    } finally { setProfileSaving(false); }
  }
  const timeline = useMemo<TimelineEntry[]>(() => {
    if (!selectedCustomerId) return [];
    return [
      ...customerEnquiries.map(e => ({ id: `enquiry-${e.id}`, date: e.created_at, kind: "enquiry" as const, title: e.subject, detail: `Enquiry · ${e.status.replace(/_/g," ")}` })),
      ...profileQuotes.map(q => ({ id: `quotation-${q.id}`, date: q.created_at, kind: "quotation" as const, title: q.description, detail: `Quotation · ${q.status} · €${Number(q.amount).toFixed(2)}` })),
      ...profileFollowUps.map(f => ({ id: `followup-${f.id}`, date: f.due_at, kind: "followup" as const, title: f.title, detail: `Follow-up · ${f.status.replace(/_/g," ")} · ${f.priority} priority` })),
      ...profileOrders.map(o => ({ id: `order-${o.id}`, date: o.created_at, kind: "order" as const, title: o.description || o.external_id, detail: `${o.kind.replace(/_/g," ")} · ${o.status} · ${Number(o.amount).toFixed(2)} ${o.currency}` })),
    ].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [customerEnquiries, profileQuotes, profileFollowUps, profileOrders, selectedCustomerId]);

  const updateField = (key: keyof Draft, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const openCreate = () => {
    setActiveTab("customers"); setShowEnquiryForm(false);
    setEditingId(null); setDraft(emptyDraft); setError(""); setSuccess(""); setShowCreate(true);
  };
  const openNewEnquiry = () => {
    setActiveTab("enquiries"); setShowCreate(false); setError(""); setSuccess("");
    setEnquiryCustomerId(""); setEnquirySubject(""); setShowEnquiryForm(true);
  };
  const switchTab = (tab: "customers" | "enquiries") => {
    setActiveTab(tab); setShowCreate(false); setShowEnquiryForm(false); setError(""); setSuccess("");
  };
  const openEdit = (c: Customer) => {
    setActiveTab("customers"); setSelectedCustomerId(null);
    setEditingId(c.id);
    setDraft({ full_name: c.full_name, email: c.email || "", phone: c.phone || "", vehicle: c.vehicle || "", enquiry: "" });
    setError(""); setSuccess(""); setShowCreate(true);
  };
  async function saveEnquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !canWrite || saving) return;
    if (!customers.some(c => c.id === enquiryCustomerId)) {
      setError("Select a customer from this company."); return;
    }
    const subject = enquirySubject.trim();
    if (subject.length < 3 || subject.length > 300) {
      setError("Enter an enquiry of 3–300 characters."); return;
    }
    setSaving(true); setError(""); setSuccess("");
    try {
      const { error: dbError } = await supabase.from("enquiries").insert({
        workspace_id: workspaceId, customer_id: enquiryCustomerId,
        subject, status: "new",
      });
      if (dbError) throw new Error(dbError.message);
      await refresh();
      setShowEnquiryForm(false); setEnquiryCustomerId(""); setEnquirySubject("");
      setSuccess("New enquiry saved to this company workspace.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save enquiry.");
    } finally { setSaving(false); }
  }
  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !canWrite || saving) return;
    const problem = validate(draft);
    if (problem) { setError(problem); return; }
    setSaving(true); setError(""); setSuccess("");
    const customerData = {
      full_name: clean(draft.full_name, 150),
      email: clean(draft.email, 254).toLowerCase() || null,
      phone: clean(draft.phone, 40) || null,
      vehicle: automotive ? (clean(draft.vehicle, 250) || null) : (editingId ? undefined : null),
    };
    try {
      if (editingId) {
        const { error: dbError } = await supabase.from("customers")
          .update(customerData).eq("workspace_id", workspaceId).eq("id", editingId);
        if (dbError) throw new Error(dbError.message);
        setSuccess("Customer contact updated.");
      } else {
        const { data: saved, error: dbError } = await supabase.from("customers")
          .insert({ ...customerData, workspace_id: workspaceId }).select("id").single();
        if (dbError || !saved) throw new Error(dbError?.message || "Customer could not be created.");
        if (draft.enquiry.trim()) {
          const { error: enquiryError } = await supabase.from("enquiries").insert({
            workspace_id: workspaceId, customer_id: saved.id,
            subject: clean(draft.enquiry, 300), status: "new",
          });
          if (enquiryError) setError(`Customer was saved, but the enquiry was not: ${enquiryError.message}`);
          else setSuccess("Customer and enquiry saved.");
        } else {
          setSuccess("Customer saved to CRM.");
        }
      }
      setShowCreate(false); setEditingId(null); setDraft(emptyDraft);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save customer.");
    } finally { setSaving(false); }
  }

  return <section className="intrigue-crm" aria-label="Customers and CRM">
    <div className="crm-toolbar">
      <div>
        <h2><Users size={19} /> Customers & CRM</h2>
        <p>Customers and enquiries belonging to <strong>{companyName || "this workspace"}</strong>.</p>
      </div>
      {canWrite && <div className="crm-toolbar-actions">
        <button className="crm-secondary" type="button" onClick={openNewEnquiry}><Plus size={16} /> New enquiry</button>
        <button className="crm-primary" type="button" onClick={openCreate}><Plus size={16} /> Add customer</button>
      </div>}
    </div>
    <div className="crm-stats">
      <div><strong>{customers.length}</strong><span>Customers</span></div>
      <button type="button" onClick={() => switchTab("enquiries")} aria-label={`View ${enquiries.length} enquiries`}><strong>{enquiries.length}</strong><span>Enquiries <span aria-hidden="true">↗</span></span></button>
      <div><strong>{customers.filter(c => !!c.email).length}</strong><span>With email</span></div>
      <div><strong>{customers.filter(c => !!c.phone).length}</strong><span>With phone</span></div>
    </div>
    {selectedCustomer && <div className="crm-profile" aria-label={`Customer profile: ${selectedCustomer.full_name}`}>
      <div className="crm-profile-top">
        <button type="button" className="crm-secondary" onClick={closeProfile}><ArrowLeft size={15}/> Back to {returnTab}</button>
        <span className="crm-profile-eyebrow">CUSTOMER 360° · {companyName}</span>
      </div>
      <div className="crm-profile-title">
        <div><h3>{selectedCustomer.full_name}</h3><p>Customer since {new Date(selectedCustomer.created_at).toLocaleDateString()}</p></div>
        {canWrite && <button type="button" className="crm-secondary" onClick={openProfileEdit}><Pencil size={14}/> Edit contact</button>}
      </div>
      <div className="crm-profile-contacts">
        <div><strong>Email</strong>{selectedCustomer.email ? <a href={`mailto:${selectedCustomer.email}`}><Mail size={15}/>{selectedCustomer.email}</a> : <span>Not provided</span>}</div>
        <div><strong>Phone</strong>{selectedCustomer.phone ? <a href={`tel:${selectedCustomer.phone.replace(/[^+\d]/g,"")}`}><Phone size={15}/>{selectedCustomer.phone}</a> : <span>Not provided</span>}</div>
        {automotive && <div><strong>Vehicle</strong><span>{selectedCustomer.vehicle || "Not provided"}</span></div>}
      </div>
      <div className="crm-profile-stats">
        <div><strong>{customerEnquiries.length}</strong><span>Enquiries</span></div>
        <div><strong>{profileLoading ? "…" : profileQuotes.length}</strong><span>Quotations</span></div>
        <div><strong>{profileLoading ? "…" : profileOrders.length}</strong><span>{automotive ? "Work orders" : "Orders"}</span></div>
        <div><strong>{profileLoading ? "…" : profileFollowUps.length}</strong><span>Follow-ups</span></div>
      </div>
      {profileErrors.length > 0 && <div className="crm-alert" role="alert">Some customer activity could not be loaded: {profileErrors.join(" | ")}</div>}
      {canWrite && <div className="crm-profile-actions">
        <button type="button" className="crm-primary" onClick={openProfileEnquiry}><Plus size={15}/> New enquiry</button>
        <button type="button" className="crm-secondary" onClick={() => startProfileAction("quote")}><FileText size={15}/> Draft quotation</button>
        <button type="button" className="crm-secondary" onClick={() => startProfileAction("followup")}><CalendarClock size={15}/> New follow-up</button>
      </div>}
      {profileMessage && <div className="crm-profile-notice" role="status">{profileMessage}</div>}
      {canWrite && profileAction && <form className="crm-form crm-profile-form" onSubmit={saveProfileAction}>
        <div className="crm-form-heading"><strong>{profileAction === "quote" ? "Draft quotation" : "Schedule follow-up"}</strong><button type="button" aria-label="Close action" onClick={() => setProfileAction(null)}><X size={18}/></button></div>
        <div className="crm-form-grid">
          <label className="crm-wide">{profileAction === "quote" ? "Quotation description *" : "Follow-up task *"}<textarea required minLength={3} maxLength={500} rows={3} value={profileDescription} onChange={e => setProfileDescription(e.target.value)} /></label>
          {profileAction === "quote" ? <label>Amount (EUR) *<input type="number" required min="0.01" max="99999999" step="0.01" value={profileAmount} onChange={e => setProfileAmount(e.target.value)}/></label> : <label>Due date *<input type="date" required value={profileDate} onChange={e => setProfileDate(e.target.value)}/></label>}
        </div>
        {profileAction === "quote" && <p className="crm-form-help">Saved as an unsent draft. The current quotations schema stores amounts in EUR.</p>}
        <div className="crm-form-actions"><button className="crm-primary" type="submit" disabled={profileSaving}>{profileSaving ? "Saving…" : profileAction === "quote" ? "Save draft" : "Save follow-up"}</button><button className="crm-secondary" type="button" onClick={() => setProfileAction(null)}>Cancel</button></div>
      </form>}
      <div className="crm-profile-history">
        <div className="crm-profile-history-head"><h4>Customer activity</h4><span>{profileLoading ? "Loading linked records…" : `${timeline.length} activities`}</span></div>
        {profileLoading ? <p className="crm-profile-empty">Loading quotations, orders and follow-ups…</p> : timeline.length ?
          <ol className="crm-profile-timeline">{timeline.map(event => <li key={event.id}>
            <span className="crm-profile-timeline-icon" aria-hidden="true">{event.kind === "order" ? <Package size={16}/> : event.kind === "quotation" ? <FileText size={16}/> : event.kind === "followup" ? <CalendarClock size={16}/> : <ClipboardList size={16}/>}</span>
            <div><strong>{event.title}</strong><span>{event.detail}</span></div>
            <time dateTime={event.date}>{new Date(event.date).toLocaleDateString()}</time>
          </li>)}</ol> : <p className="crm-profile-empty">No linked activities yet. Use the actions above to create the first one.</p>}
        <p className="crm-profile-note">Shows records explicitly linked to this customer in the current workspace. Imported orders without a customer link are not included.</p>
      </div>
    </div>}
    {!selectedCustomer && <>
    <div className="crm-tabs" role="tablist" aria-label="CRM views">
      <button type="button" role="tab" id="crm-customers-tab" aria-selected={activeTab === "customers"} aria-controls="crm-customers-panel" className={activeTab === "customers" ? "crm-tab-active" : ""} onClick={() => switchTab("customers")}><Users size={16} /> Customers <span>({customers.length})</span></button>
      <button type="button" role="tab" id="crm-enquiries-tab" aria-selected={activeTab === "enquiries"} aria-controls="crm-enquiries-panel" className={activeTab === "enquiries" ? "crm-tab-active" : ""} onClick={() => switchTab("enquiries")}><ClipboardList size={16} /> Enquiries <span>({enquiries.length})</span></button>
    </div>
    <label className="crm-search"><Search size={16} /><span className="sr-only">Search {activeTab}</span><input type="search" placeholder={activeTab === "customers" ? "Search customer names, email addresses or phone numbers" : "Search enquiries and customer names"} value={search} onChange={e => setSearch(e.target.value)} /></label>
    {error && <div className="crm-alert" role="alert">{error}</div>}
    {success && <div className="crm-success" role="status">{success}</div>}
    {canWrite && activeTab === "enquiries" && showEnquiryForm && <form className="crm-form" onSubmit={saveEnquiry}>
      <div className="crm-form-heading"><strong>New enquiry</strong><button type="button" aria-label="Close enquiry form" onClick={() => {setShowEnquiryForm(false);setError("");}}><X size={18}/></button></div>
      <p className="crm-form-help">Link a new request to an existing customer. To record a request from somebody new, select Add customer first.</p>
      <div className="crm-form-grid">
        <label>Customer *
          <select required value={enquiryCustomerId} onChange={e => setEnquiryCustomerId(e.target.value)}>
            <option value="">Select an existing customer</option>
            {[...customers].sort((a,b) => a.full_name.localeCompare(b.full_name)).map(c => <option key={c.id} value={c.id}>{c.full_name}{c.email ? ` (${c.email})` : ""}</option>)}
          </select>
        </label>
        <label className="crm-wide">Enquiry / customer request *
          <textarea required minLength={3} maxLength={300} rows={3} value={enquirySubject} onChange={e => setEnquirySubject(e.target.value)} placeholder={automotive ? "e.g. Request for carbon-fiber body kit quotation" : "e.g. Question about order delivery or product availability"} />
        </label>
      </div>
      <div className="crm-form-actions"><button className="crm-primary" type="submit" disabled={saving || !customers.length}>{saving ? "Saving…" : "Save enquiry"}</button><button className="crm-secondary" type="button" onClick={() => setShowEnquiryForm(false)}>Cancel</button></div>
    </form>}
    {canWrite && activeTab === "customers" && showCreate && <form className="crm-form" onSubmit={saveCustomer}>
      <div className="crm-form-heading"><strong>{editingId ? "Edit customer contact" : "Add customer"}</strong><button type="button" aria-label="Close form" onClick={() => {setShowCreate(false);setError("");}}><X size={18}/></button></div>
      <div className="crm-form-grid">
        <label>Customer name *<input required maxLength={150} value={draft.full_name} onChange={e => updateField("full_name", e.target.value)} /></label>
        <label>Email address<input type="email" maxLength={254} value={draft.email} onChange={e => updateField("email", e.target.value)} placeholder="customer@example.com" /></label>
        <label>Phone number<input type="tel" maxLength={40} value={draft.phone} onChange={e => updateField("phone", e.target.value)} placeholder="+49 …" /></label>
        {automotive && <label>Vehicle (optional)<input maxLength={250} value={draft.vehicle} onChange={e => updateField("vehicle", e.target.value)} placeholder="e.g. Porsche 911" /></label>}
        {!editingId && <label className="crm-wide">New enquiry (optional)<input maxLength={300} value={draft.enquiry} onChange={e => updateField("enquiry", e.target.value)} placeholder={automotive ? "e.g. Carbon-fiber aero consultation" : "e.g. Product availability question"} /></label>}
      </div>
      <div className="crm-form-actions"><button className="crm-primary" type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save contact changes" : "Save customer"}</button><button className="crm-secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</button></div>
    </form>}
    {activeTab === "customers" && <div id="crm-customers-panel" role="tabpanel" aria-labelledby="crm-customers-tab" className="crm-panel">
      <div className="crm-heading"><h3>Customer directory <span>({visibleCustomers.length})</span></h3><p>Contact information stays inside this company workspace.</p></div>
      <div className="crm-table-scroll"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th>{automotive && <th>Vehicle</th>}{canWrite && <th>Actions</th>}</tr></thead>
        <tbody>{visibleCustomers.map(c => <tr key={c.id}>
          <td className="crm-name"><button type="button" className="crm-profile-link" onClick={() => openProfile(c.id, "customers")} aria-label={`View profile for ${c.full_name}`}>{c.full_name}</button></td>
          <td>{c.email ? <a href={`mailto:${c.email}`}><Mail size={14}/>{c.email}</a> : <span className="crm-empty">Not provided</span>}</td>
          <td>{c.phone ? <a href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}><Phone size={14}/>{c.phone}</a> : <span className="crm-empty">Not provided</span>}</td>
          {automotive && <td>{c.vehicle || <span className="crm-empty">Not provided</span>}</td>}
          {canWrite && <td><button className="crm-small" type="button" onClick={() => openEdit(c)}><Pencil size={13}/> Edit</button></td>}
        </tr>)}</tbody>
      </table></div>
      {!visibleCustomers.length && <div className="crm-empty-state">{customers.length ? "No customers match your search." : "No customers yet. Add one or import company records."}</div>}
    </div>}
    {activeTab === "enquiries" && <div id="crm-enquiries-panel" role="tabpanel" aria-labelledby="crm-enquiries-tab" className="crm-panel">
      <div className="crm-heading crm-enquiries-heading"><div><h3>Enquiries <span>({visibleEnquiries.length})</span></h3><p>{automotive ? "Repair and upgrade requests" : "Customer questions and business requests"}</p></div>{canWrite && <button type="button" className="crm-primary" onClick={openNewEnquiry}><Plus size={15}/> New enquiry</button>}</div>
      <div className="crm-table-scroll"><table>
        <thead><tr><th>Customer</th><th>{automotive ? "Service request" : "Enquiry / request"}</th><th>Status</th><th>Received</th></tr></thead>
        <tbody>{visibleEnquiries.map(row => {
          const customer = byId.get(row.customer_id);
          return <tr key={row.id}><td>{customer ? <button type="button" className="crm-profile-link" onClick={() => openProfile(customer.id, "enquiries")}>{customer.full_name}</button> : <strong>Unknown customer</strong>}<span className="crm-subtext">{customer?.email || customer?.phone || "Contact not provided"}</span></td><td>{row.subject}</td><td><span className="crm-status">{row.status.replace(/_/g, " ")}</span></td><td>{new Date(row.created_at).toLocaleDateString()}</td></tr>;
        })}</tbody>
      </table></div>
      {!visibleEnquiries.length && <div className="crm-empty-state">{enquiries.length ? "No enquiries match your search." : "No enquiries yet. Use New enquiry to record the first request."}</div>}
    </div>}
    </>}
  </section>;
}
