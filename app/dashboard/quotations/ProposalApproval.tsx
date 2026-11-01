"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle2, ClipboardCopy, ExternalLink, Loader2, Mail, ShieldCheck, XCircle } from "lucide-react";
import "./proposal-approval.css";

type ApprovalState = "requested" | "approved" | "rejected";
type Approval = {
  id: string; state: ApprovalState; requested_at: string; reviewed_at: string | null;
  review_note: string | null;
};
type Event = { id: string; action: string; created_at: string; detail: string | null };
type EmailPreview = { recipient: string; subject: string; body: string; manual_only: boolean };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unexpected error");
}
function displayDate(value: string | null) {
  if (!value) return "";
  try { return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
  catch { return value; }
}

export default function ProposalApproval({ workspaceId, quotationId, proposalId, canWrite, pendingChanges }: {
  workspaceId: string;
  quotationId: string;
  proposalId: string;
  canWrite: boolean;
  pendingChanges: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [role, setRole] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const canReview = role === "owner" || role === "admin";

  const reload = useCallback(async () => {
    const [userRes, approvalRes, eventsRes] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("intrigue_proposal_approvals")
        .select("id,state,requested_at,reviewed_at,review_note")
        .eq("workspace_id", workspaceId).eq("quotation_id", quotationId).maybeSingle(),
      supabase.from("intrigue_proposal_approval_events")
        .select("id,action,created_at,detail")
        .eq("workspace_id", workspaceId).eq("quotation_id", quotationId)
        .order("created_at", { ascending: false }).limit(8),
    ]);
    if (userRes.error || !userRes.data.user?.id) throw new Error("Please sign in again to review proposals.");
    const memberRes = await supabase.from("workspace_memberships")
      .select("role").eq("workspace_id", workspaceId)
      .eq("user_id", userRes.data.user.id).maybeSingle();
    if (memberRes.error) throw new Error(memberRes.error.message);
    if (approvalRes.error) throw new Error(approvalRes.error.message);
    if (eventsRes.error) throw new Error(eventsRes.error.message);
    setRole(String(memberRes.data?.role || ""));
    setApproval(approvalRes.data as Approval | null);
    setEvents((eventsRes.data || []) as Event[]);
  }, [supabase, workspaceId, quotationId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    reload().catch(e => { if (active) setError(message(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  async function act(action: "request" | "approve" | "reject") {
    if (saving || pendingChanges || !canWrite) return;
    if (action !== "request" && !canReview) return;
    setSaving(true); setError(""); setNotice(""); setPreview(null);
    try {
      const fn = action === "request" ? "intrigue_proposal_request_approval" : "intrigue_proposal_review_approval";
      const args = action === "request"
        ? { p_workspace_id: workspaceId, p_quotation_id: quotationId, p_note: note.trim() }
        : { p_workspace_id: workspaceId, p_quotation_id: quotationId, p_decision: action, p_note: note.trim() };
      const { data, error: rpcError } = await supabase.rpc(fn, args);
      if (rpcError) throw new Error(rpcError.message);
      if (!data || typeof data !== "object") throw new Error("No approval confirmation was returned.");
      const result = data as {status?: string; already_current?: boolean};
      await reload();
      setNote("");
      setNotice(action === "request"
        ? result.already_current ? `Current approval state is ${result.status}. Nothing was sent.` : "Approval requested. The proposal has NOT been sent."
        : action === "approve"
          ? "Proposal approved for manual email preparation. Nothing has been sent."
          : "Proposal rejected for revision. Nothing has been sent.");
    } catch (e) { setError(message(e)); }
    finally { setSaving(false); }
  }

  async function prepareEmail() {
    if (saving || pendingChanges || approval?.state !== "approved" || !canReview) return;
    setSaving(true); setError(""); setNotice(""); setPreview(null);
    try {
      // The RPC recalculates the approval fingerprint against the live proposal,
      // quotation lines and recipient email before releasing the manual draft.
      const { data, error: rpcError } = await supabase.rpc("intrigue_proposal_email_preview", {
        p_workspace_id: workspaceId, p_quotation_id: quotationId,
      });
      if (rpcError) throw new Error(rpcError.message);
      const candidate = data as EmailPreview | null;
      if (!candidate?.recipient || !candidate?.subject || !candidate?.body || candidate.manual_only !== true) {
        throw new Error("The server did not return a valid, approved manual email draft.");
      }
      setPreview(candidate);
      setNotice("Approved email draft prepared. It has NOT been sent or marked as delivered.");
    } catch (e) { setError(message(e)); }
    finally { setSaving(false); }
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${label} copied. Sending still requires your action in your email application.`);
    } catch { setError("Clipboard access was denied. Select and copy the text manually."); }
  }

  // A short mailto payload is only a convenience. The full text remains visible
  // and copyable, so clients are not misled by email-client URL size limits.
  const recipientIsDemo = !!preview && /\.example$/i.test(preview.recipient.trim());
  const manualMailto = preview
    ? `mailto:${encodeURIComponent(preview.recipient)}?subject=${encodeURIComponent(preview.subject)}&body=${encodeURIComponent(preview.body.slice(0, 1700))}`
    : "";

  return <section className="pa-panel" aria-label="Proposal approval and delivery preparation">
    <div className="pa-head"><div><h3><ShieldCheck size={18}/> Proposal approval</h3>
      <p>Request approval, review the final draft, then prepare an email. Email sending is not connected yet.</p></div>
      <span className={`pa-status pa-status-${approval?.state || "draft"}`}>
        {approval?.state ? approval.state.charAt(0).toUpperCase() + approval.state.slice(1) : "Not requested"}
      </span>
    </div>
    {loading ? <p className="pa-muted"><Loader2 size={14}/> Loading approval history…</p> : <>
      {error && <p className="pa-error" role="alert">{error}</p>}
      {notice && <p className="pa-notice" role="status">{notice}</p>}
      {pendingChanges && <p className="pa-warning">Save your proposal changes and ensure the catalog is up to date before requesting, reviewing, or preparing delivery.</p>}
      {approval && <p className="pa-muted">Requested {displayDate(approval.requested_at)}{approval.reviewed_at ? ` · Reviewed ${displayDate(approval.reviewed_at)}` : ""}</p>}
      {approval?.review_note && <p className="pa-muted">Latest reviewer note: {approval.review_note}</p>}
      {canWrite && <label className="pa-note">Review note (optional, max 500 characters)
        <textarea maxLength={500} rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Explain changes requested or approval context"/>
      </label>}
      <div className="pa-actions">
        {canWrite && <button type="button" className="pa-button" disabled={saving || pendingChanges} onClick={() => void act("request")}>Request approval</button>}
        {canReview && approval?.state === "requested" && <>
          <button type="button" className="pa-button pa-approve" disabled={saving || pendingChanges} onClick={() => void act("approve")}><CheckCircle2 size={15}/> Approve</button>
          <button type="button" className="pa-button pa-reject" disabled={saving || pendingChanges} onClick={() => void act("reject")}><XCircle size={15}/> Reject</button>
        </>}
        {canReview && approval?.state === "approved" && <button type="button" className="pa-button pa-approve" disabled={saving || pendingChanges} onClick={() => void prepareEmail()}><Mail size={15}/> Prepare approved email</button>}
      </div>
      {approval?.state === "approved" && !preview && <p className="pa-muted">Approval is checked again against saved pricing, terms, logo and recipient before a manual email draft is made available.</p>}
      {preview && <div className="pa-email"><h4>Approved email draft</h4>
        <p className="pa-warning">Not sent. Outlook/Gmail OAuth is not connected in this release. Opening an email app does not confirm delivery.{recipientIsDemo ? " This is a fictional .example recipient; do not try to send it." : ""}</p>
        <div><strong>To</strong><span>{preview.recipient}</span></div>
        <div><strong>Subject</strong><span>{preview.subject}</span></div>
        <label>Body<textarea value={preview.body} readOnly rows={9}/></label>
        <div className="pa-actions">
          <button type="button" className="pa-button" onClick={() => void copyText(preview.body, "Email body")}><ClipboardCopy size={15}/> Copy full email</button>
          {!recipientIsDemo && <a className="pa-button pa-link" href={manualMailto} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/> Open email app (manual)</a>}
        </div>
        <p className="pa-muted">Attach the approved PDF exported from this quotation yourself. The email client may truncate long text, so use Copy full email if needed.</p>
      </div>}
      {events.length > 0 && <details className="pa-history"><summary>Review activity ({events.length} recent)</summary><ul>
        {events.map(e => <li key={e.id}><strong>{e.action.replaceAll("_", " ")}</strong> · {displayDate(e.created_at)}{e.detail ? ` · ${e.detail}` : ""}</li>)}
      </ul></details>}
      <p className="pa-muted">Approved drafts remain internal until a separate authorized delivery action. No emails, payments, or signatures are sent by INTRIGUE in this version.</p>
    </>}
  </section>;
}
