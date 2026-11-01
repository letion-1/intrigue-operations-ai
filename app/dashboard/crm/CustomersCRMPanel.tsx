"use client";

import { useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { ClipboardList, Mail, Pencil, Phone, Plus, Search, Users, X } from "lucide-react";
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
          <td className="crm-name">{c.full_name}</td>
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
          return <tr key={row.id}><td><strong>{customer?.full_name || "Unknown customer"}</strong><span className="crm-subtext">{customer?.email || customer?.phone || "Contact not provided"}</span></td><td>{row.subject}</td><td><span className="crm-status">{row.status.replace(/_/g, " ")}</span></td><td>{new Date(row.created_at).toLocaleDateString()}</td></tr>;
        })}</tbody>
      </table></div>
      {!visibleEnquiries.length && <div className="crm-empty-state">{enquiries.length ? "No enquiries match your search." : "No enquiries yet. Use New enquiry to record the first request."}</div>}
    </div>}
  </section>;
}
