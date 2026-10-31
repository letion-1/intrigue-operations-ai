"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import "./brand.css";
import "./intrigue-themes.css";
import IntegrationsPanel from "./integrations-panel";
import CalendarConnections from "./calendar-connections";
import ReceptionistPanel from "./ai-receptionist/ReceptionistPanel";
import DataManagementPanel from "./data-management/DataManagementPanel";
import {
  Activity,
  ArrowRight,
  ClipboardCheck,
  ArrowUpRight,
  Bell,
  Sun,
  Moon,
  BookOpen,
  Bot,
  CalendarDays,
  CarFront,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  FileUp,
  Trash2,
  Pencil,
  LayoutDashboard,
  ListTodo,
  Menu,
  Plus,
  Plug,
  PhoneCall,
  Send,
  Settings,
  UserPlus,
  ShieldCheck,
  CreditCard,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";

type Section =
  | "Overview"
  | "AI Assistant"
  | "AI Receptionist"
  | "Action Center"
  | "Automation Center"
  | "Customers"
  | "Quotations"
  | "Follow-ups"
  | "Knowledge Base"
  | "Integrations"
  | "Calendar"
  | "Settings"
  | "Data Management"
  | "Team"
  | "Service Catalog"
  | "Get Started"
  | "Security & Usage"
  | "Plans & Billing"
  | "Pilot Application";

type Message = { role: "assistant" | "user"; text: string; proposalId?: string; toolsUsed?: string[] };

const NAV = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Get Started", icon: ClipboardCheck },
  { label: "AI Assistant", icon: Bot },
  { label: "AI Receptionist", icon: PhoneCall },
  { label: "Action Center", icon: ClipboardCheck },
  { label: "Automation Center", icon: Zap },
  { label: "Customers", icon: Users },
  { label: "Quotations", icon: FileText },
  { label: "Follow-ups", icon: ListTodo },
  { label: "Knowledge Base", icon: BookOpen },
  { label: "Service Catalog", icon: FileText },
  { label: "Calendar", icon: CalendarDays },
  { label: "Integrations", icon: Plug },
  { label: "Team", icon: UserPlus },
  { label: "Settings", icon: Settings },
  { label: "Data Management", icon: ShieldCheck },
  { label: "Security & Usage", icon: ShieldCheck },
  { label: "Plans & Billing", icon: CreditCard },
  { label: "Pilot Application", icon: ClipboardCheck },
] as const;

const QUICK_PROMPTS = [
  "Which leads need a follow-up?",
  "Show pending quotations",
  "Summarize today's workload",
];

type Workspace = { id: string; name: string; owner_id: string };
type MemberRole = "owner" | "admin" | "staff" | "viewer" | "member";
type FormerAccessNotice = { revoked: true; company_name: string; contact_email: string };
type ServiceRow = {id:string; name:string; description:string; price:number; currency:string; is_active:boolean; created_at:string};
type CompanySettings = {
  workspace_id: string; industry: string; description: string; contact_email: string;
  phone: string; website: string; business_hours: string; timezone: string;
  currency: string; ai_name: string; ai_tone: string; ai_role: string; ai_guidance: string;
};
const EMPTY_SETTINGS: Omit<CompanySettings, "workspace_id"> = {
  industry: "Other", description: "", contact_email: "", phone: "", website: "",
  business_hours: "", timezone: "Europe/Berlin", currency: "EUR",
  ai_name: "INTRIGUE Assistant", ai_tone: "Professional",
  ai_role: "Operations assistant", ai_guidance: "",
};
type TeamMember = { member_user_id: string; email: string; role: MemberRole; joined_at: string };
type TeamInvite = { id: string; invited_email: string; role: string; status: string; expires_at: string; created_at: string };
type TeamAuditEvent = { event_at: string; event_type: string; member_email: string; actor_email: string; old_role: string | null; new_role: string | null };
type PlanTier = "pilot" | "growth" | "scale";
type PlanInterest = { requested_tier: PlanTier; requested_at: string; request_notes: string };
type PilotReviewStatus = "submitted" | "contacted" | "closed";
type PilotForm = {
  contact_name: string; contact_email: string; intended_use: string;
  success_criteria: string; estimated_seats: number; preferred_start: string; request_notes: string;
};
type PilotRequest = PilotForm & { status: PilotReviewStatus; submitted_at: string; updated_at: string; review_message: string; reviewed_at: string | null };
const EMPTY_PILOT_FORM: PilotForm = {
  contact_name: "", contact_email: "", intended_use: "", success_criteria: "",
  estimated_seats: 1, preferred_start: "", request_notes: "",
};
const PLAN_PREVIEWS: {tier:PlanTier; name:string; audience:string; details:string}[] = [
  {tier:"pilot",name:"Pilot",audience:"For early testers",details:"Guided evaluation with fictional business records."},
  {tier:"growth",name:"Growth",audience:"For operating teams",details:"Potential fit for multi-user company operations."},
  {tier:"scale",name:"Scale",audience:"For larger workflows",details:"Discuss tailored rollout, governance and integration needs."},
];

type AiUsage = {
  chat_today:number; chat_this_minute:number; index_today:number; index_this_minute:number;
  chat_day_limit:number; chat_minute_limit:number; index_day_limit:number; index_minute_limit:number;
  reset_utc:string;
};
const OWNER_ONLY_SECTIONS: Section[] = ["AI Assistant","AI Receptionist","Action Center","Automation Center","Integrations","Calendar","Data Management","Security & Usage","Plans & Billing","Pilot Application"];

type Customer = { id: string; full_name: string; email: string | null; vehicle: string | null; created_at: string };
type Enquiry = { id: string; customer_id: string; subject: string; status: string; created_at: string };
type Quote = { id: string; customer_id: string; description: string; amount: number; status: string; created_at: string };
type FollowUp = { id: string; customer_id: string; title: string; due_at: string; status: string; priority: string };
type KnowledgeEntry = { id: string; title: string; category: string; content: string; created_at: string };
type KnowledgeDocument = { id: string; filename: string; file_type: string; page_count: number; characters: number; created_at: string };
type ActionProposal = {
  id: string; customer_id: string; request_text: string; quote_description: string | null;
  quote_amount: number | null; quote_source: string | null; follow_up_title: string | null;
  follow_up_due_at: string | null; warning_text: string | null; status: string;
  created_at: string; quotation_id: string | null; follow_up_id: string | null;
};
type ActionAudit = {id:string; proposal_id:string; decision:string; created_at:string};
type AutomationJob = {
  id:string; proposal_id:string; quotation_id:string; kind:string; status:string;
  attempts:number; max_attempts:number; last_error:string|null; result:{message?:string}|null;
  created_at:string; updated_at:string; completed_at:string|null;
};


function ProposalReviewCard({proposal: p, customer, busy, onDecide, onEdit}: {
  proposal: ActionProposal; customer: string; busy: boolean;
  onDecide: (id:string, decision:"approve"|"reject") => void;
  onEdit: (id:string, title:string, date:string) => Promise<boolean>;
}) {
  const [editing,setEditing]=useState(false);
  const [title,setTitle]=useState(p.follow_up_title || "");
  const [date,setDate]=useState((p.follow_up_due_at || "").slice(0,10));
  return <article className="rounded-2xl border border-[#796440]/65 bg-[#142539] p-4 md:p-5 text-[#f5f0e8]">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <strong className="text-sm">{customer}</strong>
      <Tag variant={p.status==="approved"?"emerald":p.status==="rejected"?"slate":"amber"}>{p.status==="pending"?"Awaiting approval":p.status}</Tag>
    </div>
    <p className="mb-3 text-xs leading-5 text-[#b8c7d4]">{p.request_text}</p>
    {p.quote_description && <div className="mb-3 rounded-xl border border-[#394b5f] bg-[#0d1e30] p-4">
      <div className="mb-1 text-xs font-semibold text-[#d9bd7d]">Draft quotation Â· Price locked to source</div>
      <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{p.quote_description}</span><strong>{money(Number(p.quote_amount))}</strong></div>
      <p className="mt-2 text-[11px] text-[#aebdcb]">Source: {p.quote_source}</p>
    </div>}
    {p.follow_up_title && <div className="mb-3 rounded-xl border border-[#394b5f] bg-[#0d1e30] p-4">
      <div className="flex items-center justify-between gap-2"><div className="text-xs font-semibold text-[#d9bd7d]">Follow-up task</div>
      {p.status==="pending" && <button type="button" disabled={busy} onClick={()=>setEditing(!editing)} className="inline-flex items-center gap-1 text-xs text-[#e9c577] hover:underline"><Pencil size={13}/>{editing?"Cancel edit":"Edit task"}</button>}</div>
      {!editing ? <><div className="mt-2 text-sm">{p.follow_up_title}</div><p className="mt-2 text-[11px] text-[#aebdcb]">Due {niceDate(p.follow_up_due_at || "")} Â· Normal priority</p></>:
      <form onSubmit={async event => {event.preventDefault(); if(await onEdit(p.id,title,date)) setEditing(false);}} className="mt-3 grid gap-2">
        <label className="text-xs text-[#b8c7d4]">Task title<input className="mt-1 w-full rounded-lg border border-[#526076] bg-[#182c41] px-3 py-2 text-sm" value={title} minLength={3} maxLength={300} required onChange={e=>setTitle(e.target.value)}/></label>
        <label className="text-xs text-[#b8c7d4]">Due date<input className="mt-1 w-full rounded-lg border border-[#526076] bg-[#182c41] px-3 py-2 text-sm" value={date} type="date" required onChange={e=>setDate(e.target.value)}/></label>
        <button type="submit" disabled={busy || title.trim().length<3 || !date} className="w-fit rounded-lg bg-[#c9a552] px-3 py-2 text-xs font-bold text-[#111b29] disabled:opacity-50">Save task changes</button>
      </form>}
    </div>}
    {p.warning_text && <div className="mb-3 whitespace-pre-line rounded-lg border border-[#92723e]/50 bg-[#564024]/20 p-3 text-xs leading-5 text-[#edd5a6]">{p.warning_text}</div>}
    {p.status==="pending" && !editing && <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={()=>onDecide(p.id,"approve")} className="rounded-lg bg-[#c9a552] px-4 py-2.5 text-xs font-bold text-[#111b29] disabled:opacity-50">Approve & save drafts</button>
      <button type="button" disabled={busy} onClick={()=>onDecide(p.id,"reject")} className="rounded-lg border border-[#795557] px-4 py-2.5 text-xs text-[#f3c2b9] disabled:opacity-50">Reject</button>
    </div>}
    {p.status==="approved" && <p className="text-xs text-[#b3ead0]">Approved and saved. Nothing sent. {p.quotation_id?`Quote ${p.quotation_id.slice(0,8)}. `:""}{p.follow_up_id?`Task ${p.follow_up_id.slice(0,8)}.`:""}</p>}
  </article>;
}

function money(value: number) { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(value); }
function niceDate(value: string) { return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
function statusText(status: string) { return ({new:"New inquiry", quoted:"Quote pending", follow_up:"Follow-up due", scheduled:"Appointment set", closed:"Closed", awaiting_review:"Awaiting review", draft:"Draft", approved:"Approved"} as Record<string,string>)[status] || status; }
function Tag({ children, variant = "slate" }: { children: ReactNode; variant?: "slate" | "amber" | "emerald" | "blue" }) {
  const colors = {
    slate: "bg-[#26384d] text-[#d5dbe0]",
    amber: "bg-[#554126]/40 text-[#f1cc7f]",
    emerald: "bg-[#23463d] text-[#b1ead0]",
    blue: "bg-[#263751] text-[#b4c1e6]",
  };
  return <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold ${colors[variant]}`}>{children}</span>;
}

export default function DashboardPage() {
  const [section, setSection] = useState<Section>("Overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [appearance, setAppearance] = useState<"dark" | "light">("dark");
  const [activityOpen, setActivityOpen] = useState(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("intrigue-appearance-v1");
      if (stored === "dark" || stored === "light") setAppearance(stored);
    } catch { /* Storage can be disabled in private browsing. */ }
  }, []);
  const toggleAppearance = () => setAppearance(current => {
    const next = current === "dark" ? "light" : "dark";
    try { window.localStorage.setItem("intrigue-appearance-v1", next); } catch { /* Non-persistent fallback. */ }
    return next;
  });

  const [draft, setDraft] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiConnected, setAiConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Welcome to INTRIGUE Operations AI. I can answer questions using records from your signed-in demo workspace. I can prepare draft actions for your approval. Nothing is saved to quotations or tasks without your approval, and I never contact customers." },
  ]);

  // Authenticated Supabase browser client. Authorization is also enforced in Postgres RLS.
  const supabase = useMemo(() => createClient(), []);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [role, setRole] = useState<MemberRole>("owner");
  const isOwner = role === "owner";
  const canManageCatalog = role === "owner" || role === "admin";
  const canWriteOps = canManageCatalog || role === "staff";
  const [settings, setSettings] = useState<Omit<CompanySettings,"workspace_id">>(EMPTY_SETTINGS);
  const [services,setServices]=useState<ServiceRow[]>([]);
  const [serviceBusy,setServiceBusy]=useState(false);
  const [serviceError,setServiceError]=useState("");
  const [showServiceForm,setShowServiceForm]=useState(false);
  const [serviceForm,setServiceForm]=useState({id:"",name:"",description:"",price:"",currency:"EUR",is_active:true});
  const [selectedInviteRole,setSelectedInviteRole]=useState<"admin"|"staff"|"viewer">("viewer");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [companyEditName, setCompanyEditName] = useState("");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamInvites, setTeamInvites] = useState<TeamInvite[]>([]);
  const [teamAudit,setTeamAudit] = useState<TeamAuditEvent[]>([]);
  const [teamAuditError,setTeamAuditError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [teamBusy, setTeamBusy] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [teamMessage, setTeamMessage] = useState("");
  const [aiUsage,setAiUsage] = useState<AiUsage|null>(null);
  const [usageBusy,setUsageBusy] = useState(false);
  const [usageError,setUsageError] = useState("");
  const [planInterest,setPlanInterest] = useState<PlanInterest|null>(null);
  const [planLoading,setPlanLoading] = useState(false);
  const [planSaving,setPlanSaving] = useState(false);
  const [planError,setPlanError] = useState("");
  const [planSuccess,setPlanSuccess] = useState("");
  const [pilotForm,setPilotForm] = useState<PilotForm>(EMPTY_PILOT_FORM);
  const [pilotRequest,setPilotRequest] = useState<PilotRequest|null>(null);
  const [pilotLoading,setPilotLoading] = useState(false);
  const [pilotSaving,setPilotSaving] = useState(false);
  const [pilotError,setPilotError] = useState("");
  const [pilotSuccess,setPilotSuccess] = useState("");
  const [joinToken, setJoinToken] = useState("");
  const [accessNotice, setAccessNotice] = useState<FormerAccessNotice | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [tasks, setTasks] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [dbError, setDbError] = useState("");
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [showFollowForm, setShowFollowForm] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: "", vehicle: "", service: "" });
  const [quoteForm, setQuoteForm] = useState({ customerId: "", description: "", amount: "" });
  const [followForm, setFollowForm] = useState({ customerId: "", title: "", date: "" });
  // Knowledge entries are stored separately, so missing V5 SQL never blocks V4 features.
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState("");
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [showKnowledgeForm, setShowKnowledgeForm] = useState(false);
  const [knowledgeForm, setKnowledgeForm] = useState({ title: "", category: "Policy", content: "" });
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [documentSuccess, setDocumentSuccess] = useState("");
  const [semanticBusy, setSemanticBusy] = useState(false);
  const [semanticStatus, setSemanticStatus] = useState("");
  const [actionPrompt, setActionPrompt] = useState("Prepare a quotation for Alex Fischer's brake inspection using our service prices, and create a follow-up task for tomorrow.");
  const [actionProposals, setActionProposals] = useState<ActionProposal[]>([]);
  const [actionAudit, setActionAudit] = useState<ActionAudit[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [chatActionBusy, setChatActionBusy] = useState(false);
  const [automationJobs, setAutomationJobs] = useState<AutomationJob[]>([]);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [automationError, setAutomationError] = useState("");
  const [automationMessage, setAutomationMessage] = useState("");


  useEffect(() => {
    // The invitation code is never transmitted to the AI or analytics.
    const params = new URLSearchParams(window.location.search);
    if (params.has("integration")) setSection("Integrations");
    else if (params.get("section") === "ai-receptionist") setSection("AI Receptionist");
    const token = params.get("join");
    if (token && /^[0-9a-f]{64}$/.test(token)) setJoinToken(token);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setDbError("");
    setAccessNotice(null);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      setDbError("Your session has expired. Sign in again, then refresh this page.");
      setLoading(false);
      return;
    }
    const result = await supabase.from("workspaces").select("id,name,owner_id").order("created_at", { ascending: true }).limit(1);
    if (result.error) {
      setDbError(`Database connection failed: ${result.error.message}. Run the setup SQL in Supabase first.`);
      setLoading(false);
      return;
    }
    const found = (result.data?.[0] as Workspace | undefined) ?? null;
    setWorkspace(found);
    if (found) {
      const member = await supabase.from("workspace_memberships").select("role")
        .eq("workspace_id",found.id).eq("user_id",authData.user.id).maybeSingle();
      if (member.error || !member.data || !["owner","admin","staff","viewer","member"].includes(member.data.role)) {
        setDbError("This account has no verified membership for its workspace.");
        setLoading(false); return;
      }
      setRole(member.data.role as MemberRole);
      setCompanyEditName(found.name);
    }
    if (!found) {
      // An accepted historical invitation distinguishes a removed member from a new signup.
      // The RPC returns only the current authenticated user's former company, if any.
      const { data: previousAccess, error: accessError } = await supabase.rpc("get_intrigue_access_notice");
      if (accessError) {
        setDbError(`Unable to verify workspace access: ${accessError.message}. Apply the V14.3.1 SQL migration.`);
      } else if (previousAccess && typeof previousAccess === "object" && previousAccess.revoked === true) {
        setAccessNotice({
          revoked: true,
          company_name: typeof previousAccess.company_name === "string" ? previousAccess.company_name : "your former company",
          contact_email: typeof previousAccess.contact_email === "string" ? previousAccess.contact_email : "",
        });
      }
      setCustomers([]); setEnquiries([]); setQuotes([]); setTasks([]);
      setLoading(false);
      return;
    }
    const [c, e, q, t] = await Promise.all([
      supabase.from("customers").select("id,full_name,email,vehicle,created_at").eq("workspace_id", found.id).order("created_at", { ascending: false }),
      supabase.from("enquiries").select("id,customer_id,subject,status,created_at").eq("workspace_id", found.id).order("created_at", { ascending: false }),
      supabase.from("quotations").select("id,customer_id,description,amount,status,created_at").eq("workspace_id", found.id).order("created_at", { ascending: false }),
      supabase.from("follow_ups").select("id,customer_id,title,due_at,status,priority").eq("workspace_id", found.id).order("due_at", { ascending: true }),
    ]);
    const error = c.error || e.error || q.error || t.error;
    if (error) setDbError(`Unable to load records: ${error.message}`);
    else {
      setCustomers((c.data ?? []) as Customer[]);
      setEnquiries((e.data ?? []) as Enquiry[]);
      setQuotes((q.data ?? []) as Quote[]);
      setTasks((t.data ?? []) as FollowUp[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Re-validate when the tab becomes active again. A removed or demoted member
  // should not continue looking at a stale cached dashboard after role changes.
  // Server-side RLS remains the actual authorization boundary.
  useEffect(() => {
    let lastCheck = Date.now();
    const recheck = () => {
      if (document.visibilityState !== "visible" || Date.now()-lastCheck < 10000) return;
      lastCheck = Date.now();
      void refresh();
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [refresh]);

  const loadSettings = useCallback(async () => {
    if (!workspace) return;
    const {data,error} = await supabase.from("workspace_settings").select("*")
      .eq("workspace_id",workspace.id).maybeSingle();
    if (error) { setSettingsError(error.message); return; }
    setSettings(data ? {
      industry:data.industry,description:data.description,contact_email:data.contact_email,
      phone:data.phone,website:data.website,business_hours:data.business_hours,
      timezone:data.timezone,currency:data.currency,ai_name:data.ai_name,
      ai_tone:data.ai_tone,ai_role:data.ai_role,ai_guidance:data.ai_guidance,
    } : EMPTY_SETTINGS);
  },[supabase,workspace]);
  useEffect(()=>{if(workspace) void loadSettings();},[workspace,loadSettings]);

  // Read-only, owner-scoped quota summary from a security-definer database RPC.
  const loadAiUsage = useCallback(async () => {
    if (!workspace || !isOwner) {setAiUsage(null); return;}
    setUsageBusy(true); setUsageError("");
    const {data,error}=await supabase.rpc("get_intrigue_ai_usage");
    if (error) { setUsageError("Usage reporting is unavailable. Apply V14.3 SQL: " + error.message);setAiUsage(null); }
    else setAiUsage(data as AiUsage);
    setUsageBusy(false);
  },[supabase,workspace,isOwner]);
  useEffect(()=>{if(section==="Security & Usage" || section==="Plans & Billing") void loadAiUsage();},[section,loadAiUsage]);

  const loadPlanInterest = useCallback(async () => {
    if (!workspace || !isOwner) { setPlanInterest(null); return; }
    setPlanLoading(true); setPlanError("");
    const { data, error } = await supabase.from("workspace_plan_interest")
      .select("requested_tier,requested_at,request_notes")
      .eq("workspace_id", workspace.id).maybeSingle();
    if (error) { setPlanError("Plan preview unavailable: " + error.message); setPlanInterest(null); }
    else setPlanInterest((data || null) as PlanInterest|null);
    setPlanLoading(false);
  }, [supabase,workspace,isOwner]);
  useEffect(() => { if (section === "Plans & Billing") void loadPlanInterest(); }, [section,loadPlanInterest]);

  async function savePlanInterest(tier:PlanTier) {
    if (!workspace || !isOwner || planSaving) return;
    setPlanSaving(true); setPlanError(""); setPlanSuccess("");
    const { data,error } = await supabase.from("workspace_plan_interest")
      .upsert({workspace_id:workspace.id,requested_tier:tier,request_notes:"",requested_at:new Date().toISOString()}, {onConflict:"workspace_id"})
      .select("requested_tier,requested_at,request_notes").single();
    if (error) setPlanError(error.message);
    else { setPlanInterest(data as PlanInterest); setPlanSuccess("Interest saved for your company. No payment, subscription, or entitlement has been created."); }
    setPlanSaving(false);
  }

  // Pilot applications are saved per workspace. Review is manual; no trial access
  // or paid entitlement is created by this interface.
  const loadPilotRequest = useCallback(async () => {
    if (!workspace || !isOwner) { setPilotRequest(null); return; }
    setPilotLoading(true); setPilotError("");
    const { data, error } = await supabase.from("workspace_pilot_requests")
      .select("contact_name,contact_email,intended_use,success_criteria,estimated_seats,preferred_start,request_notes,status,submitted_at,updated_at,review_message,reviewed_at")
      .eq("workspace_id", workspace.id).maybeSingle();
    if (error) { setPilotError("Pilot request unavailable: " + error.message); setPilotRequest(null); }
    else if (data) {
      const item = data as PilotRequest;
      setPilotRequest(item);
      setPilotForm({ contact_name: item.contact_name, contact_email: item.contact_email,
        intended_use: item.intended_use, success_criteria: item.success_criteria,
        estimated_seats: item.estimated_seats, preferred_start: item.preferred_start || "",
        request_notes: item.request_notes });
    } else {
      setPilotRequest(null);
    }
    setPilotLoading(false);
  }, [supabase,workspace,isOwner]);
  useEffect(()=>{if(section==="Pilot Application") void loadPilotRequest();},[section,loadPilotRequest]);

  async function submitPilotRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !isOwner || pilotSaving || (pilotRequest && pilotRequest.status !== "submitted")) return;
    const form = {
      ...pilotForm, contact_name: pilotForm.contact_name.trim(),
      contact_email: pilotForm.contact_email.trim(), intended_use: pilotForm.intended_use.trim(),
      success_criteria: pilotForm.success_criteria.trim(), request_notes: pilotForm.request_notes.trim(),
      preferred_start: pilotForm.preferred_start || null,
      estimated_seats: Number(pilotForm.estimated_seats),
    };
    if (form.contact_name.length < 2 || form.intended_use.length < 20 ||
      form.success_criteria.length < 10 || !/^\S+@\S+\.\S+$/.test(form.contact_email) ||
      !Number.isInteger(form.estimated_seats) || form.estimated_seats < 1 || form.estimated_seats > 1000) {
      setPilotError("Enter a valid contact, email, use case, success criteria and team size."); return;
    }
    setPilotSaving(true); setPilotError(""); setPilotSuccess("");
    const payload = { ...form, updated_at:new Date().toISOString() };
    const {error} = pilotRequest
      ? await supabase.from("workspace_pilot_requests").update(payload).eq("workspace_id",workspace.id)
      : await supabase.from("workspace_pilot_requests").insert({workspace_id:workspace.id,...payload});
    if (error) setPilotError(error.message);
    else { setPilotSuccess("Application saved. Our team must review it manually. No trial, payment or feature access has been activated."); await loadPilotRequest(); }
    setPilotSaving(false);
  }

  const loadTeam = useCallback(async () => {
    if (!workspace || !isOwner) return;
    const [members,invites] = await Promise.all([
      supabase.rpc("list_intrigue_team",{p_workspace_id:workspace.id}),
      supabase.from("workspace_invitations")
        .select("id,invited_email,role,status,expires_at,created_at")
        .eq("workspace_id",workspace.id).eq("status","pending")
        .order("created_at",{ascending:false}),
    ]);
    if(members.error || invites.error) setTeamError(members.error?.message||invites.error?.message||"Team unavailable");
    else {setTeamError("");setTeamMembers((members.data||[]) as TeamMember[]);setTeamInvites((invites.data||[]) as TeamInvite[]);}
  },[supabase,workspace,isOwner]);
  useEffect(()=>{if(section==="Team" || section==="Settings") void loadTeam();},[section,loadTeam]);

  const loadTeamAudit = useCallback(async () => {
    if (!workspace || !isOwner) {setTeamAudit([]);return;}
    const {data,error} = await supabase.rpc("get_intrigue_membership_history",{
      p_workspace_id:workspace.id,p_limit:30,
    });
    if (error) {setTeamAuditError(error.message);setTeamAudit([]);}
    else {setTeamAuditError("");setTeamAudit((data||[]) as TeamAuditEvent[]);}
  },[supabase,workspace,isOwner]);
  useEffect(()=>{if(section==="Team") void loadTeamAudit();},[section,loadTeamAudit]);
  useEffect(()=>{if(section==="Team") void loadTeamAudit();},[teamMembers,section,loadTeamAudit]);

  async function saveSettings(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!workspace||!isOwner||settingsBusy)return;
    setSettingsBusy(true);setSettingsError("");setSettingsMessage("");
    const name=companyEditName.trim();
    if(name.length<2||name.length>100){setSettingsError("Company name must have 2â€“100 characters.");setSettingsBusy(false);return;}
    const nameResult = await supabase.from("workspaces").update({name})
      .eq("id",workspace.id).eq("owner_id",workspace.owner_id);
    if(nameResult.error){setSettingsError(nameResult.error.message);setSettingsBusy(false);return;}
    const saveResult=await supabase.from("workspace_settings").upsert({workspace_id:workspace.id,...settings},{onConflict:"workspace_id"});
    if(saveResult.error)setSettingsError(saveResult.error.message);
    else {setSettingsMessage("Company and AI settings saved.");await refresh();}
    setSettingsBusy(false);
  }

  async function createInvite(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!workspace||!isOwner||teamBusy)return;
    setTeamBusy(true);setTeamError("");setTeamMessage("");setInviteLink("");
    const {data,error}=await supabase.rpc("create_intrigue_team_invite_v142",{
      p_workspace_id:workspace.id,p_email:inviteEmail.trim().toLowerCase(),p_role:selectedInviteRole,
    });
    if(error)setTeamError(error.message);
    else if(typeof data==="string"){
      setInviteLink(`${window.location.origin}/dashboard?join=${data}`);
      setInviteEmail("");setTeamMessage("Invitation created. Copy the link now and send it privately to the invited email owner. Expires in 7 days.");
      await loadTeam();
    }
    setTeamBusy(false);
  }
  async function acceptInvite() {
    if(!joinToken||teamBusy)return;
    setTeamBusy(true);setTeamError("");
    const {error}=await supabase.rpc("accept_intrigue_team_invite",{p_token:joinToken});
    if(error){setTeamError(error.message);setTeamBusy(false);return;}
    window.history.replaceState(null,"",window.location.pathname);
    setJoinToken("");setTeamMessage("You joined your company workspace. Your access is controlled by your assigned role.");
    await refresh();setTeamBusy(false);
  }
  async function revokeInvite(id:string) {
    if(!isOwner||teamBusy||!window.confirm("Revoke this invitation?"))return;
    setTeamBusy(true);setTeamError("");
    const {error}=await supabase.rpc("revoke_intrigue_team_invite",{p_invitation_id:id});
    if(error)setTeamError(error.message);else await loadTeam();
    setTeamBusy(false);
  }
  async function removeMember(id:string) {
    if(!workspace||!isOwner||teamBusy||!window.confirm("Remove this staff member's workspace access?"))return;
    setTeamBusy(true);setTeamError("");
    const {error}=await supabase.rpc("remove_intrigue_team_member",{p_workspace_id:workspace.id,p_member_id:id});
    if(error)setTeamError(error.message);else await loadTeam();
    setTeamBusy(false);
  }

  const loadServices=useCallback(async()=>{
    if (!workspace) {setServices([]);return;}
    const {data,error}=await supabase.from("workspace_services")
      .select("id,name,description,price,currency,is_active,created_at")
      .eq("workspace_id",workspace.id).order("name",{ascending:true}).limit(200);
    if(error) setServiceError(error.message);
    else {setServices((data||[]) as ServiceRow[]);setServiceError("");}
  },[supabase,workspace]);
  useEffect(()=>{void loadServices();},[loadServices]);

  async function saveService(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); if(!workspace||!canManageCatalog||serviceBusy)return;
    const price=Number(serviceForm.price);
    if(!serviceForm.name.trim()||!Number.isFinite(price)||price<0||price>999999999) {
      setServiceError("Enter a name and a valid non-negative price.");return;
    }
    setServiceBusy(true);setServiceError("");
    const payload={workspace_id:workspace.id,name:serviceForm.name.trim(),
      description:serviceForm.description.trim(),price,currency:serviceForm.currency,is_active:serviceForm.is_active};
    const {error}=serviceForm.id
      ? await supabase.from("workspace_services").update(payload).eq("id",serviceForm.id).eq("workspace_id",workspace.id)
      : await supabase.from("workspace_services").insert(payload);
    if(error)setServiceError(error.message);
    else {setServiceForm({id:"",name:"",description:"",price:"",currency:settings.currency,is_active:true});setShowServiceForm(false);await loadServices();}
    setServiceBusy(false);
  }
  async function removeService(id:string){
    if(!workspace||!canManageCatalog||serviceBusy||!window.confirm("Delete this service?"))return;
    setServiceBusy(true);
    const {error}=await supabase.from("workspace_services").delete().eq("id",id).eq("workspace_id",workspace.id);
    if(error)setServiceError(error.message);else await loadServices();
    setServiceBusy(false);
  }
  async function updateTeamRole(id:string,newRole:"admin"|"staff"|"viewer"){
    if(!workspace||!isOwner||teamBusy||!window.confirm(`Set this member's role to ${newRole}?`))return;
    setTeamBusy(true);setTeamError("");
    const {error}=await supabase.rpc("change_intrigue_team_role",{
      p_workspace_id:workspace.id,p_member_id:id,p_role:newRole,
    });
    if(error)setTeamError(error.message);else await loadTeam();
    setTeamBusy(false);
  }

  useEffect(() => {
    let alive = true;
    fetch("/api/assistant", {cache: "no-store"})
      .then(async (response) => {
        const data = await response.json();
        if (alive) setAiConnected(response.ok && data.connected === true);
      })
      .catch(() => { if (alive) setAiConnected(false); });
    return () => { alive = false; };
  }, []);

  async function createCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = companyName.trim();
    if (name.length < 2 || name.length > 100 || busy) return;
    setBusy(true); setDbError("");
    const { error } = await supabase.rpc("create_intrigue_company", { p_name: name });
    if (error) setDbError(`Could not create company: ${error.message}`);
    else { setCompanyName(""); await refresh(); }
    setBusy(false);
  }

  async function addCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !canWriteOps || !customerForm.name.trim() || !customerForm.service.trim()) return;
    setBusy(true); setDbError("");
    const {data, error} = await supabase.from("customers").insert({
      workspace_id:workspace.id, full_name:customerForm.name.trim(), vehicle:customerForm.vehicle.trim() || null,
    }).select("id").single();
    if (error || !data) setDbError(error?.message || "Customer could not be saved");
    else {
      const inquiry = await supabase.from("enquiries").insert({ workspace_id:workspace.id, customer_id:data.id, subject:customerForm.service.trim(), status:"new" });
      if (inquiry.error) setDbError(`Customer saved, but inquiry failed: ${inquiry.error.message}`);
      else { setCustomerForm({name:"",vehicle:"",service:""}); setShowCustomerForm(false); }
      await refresh();
    }
    setBusy(false);
  }

  async function addQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(quoteForm.amount);
    if (!workspace || !quoteForm.customerId || !quoteForm.description.trim() || !Number.isFinite(amount) || amount <= 0) return;
    setBusy(true); setDbError("");
    const {error} = await supabase.from("quotations").insert({workspace_id:workspace.id, customer_id:quoteForm.customerId, description:quoteForm.description.trim(), amount, status:"draft"});
    if (error) setDbError(error.message);
    else { setQuoteForm({customerId:"",description:"",amount:""}); setShowQuoteForm(false); await refresh(); }
    setBusy(false);
  }

  async function addFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !canWriteOps || !followForm.customerId || !followForm.title.trim() || !followForm.date) return;
    setBusy(true); setDbError("");
    const {error} = await supabase.from("follow_ups").insert({workspace_id:workspace.id, customer_id:followForm.customerId, title:followForm.title.trim(), due_at:new Date(`${followForm.date}T12:00:00`).toISOString(), status:"pending", priority:"normal"});
    if (error) setDbError(error.message);
    else { setFollowForm({customerId:"",title:"",date:""}); setShowFollowForm(false); await refresh(); }
    setBusy(false);
  }

  async function completeFollowUp(id: string) {
    if (!canWriteOps) return;
    setBusy(true); setDbError("");
    const {error} = await supabase.from("follow_ups").update({status:"done"}).eq("id", id).eq("workspace_id", workspace?.id ?? "");
    if (error) setDbError(error.message);
    else await refresh();
    setBusy(false);
  }


  const loadKnowledge = useCallback(async () => {
    if (!workspace) { setKnowledgeEntries([]); return; }
    setKnowledgeLoading(true);
    setKnowledgeError("");
    const result = await supabase.from("knowledge_entries")
      .select("id,title,category,content,created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false }).limit(100);
    if (result.error) {
      setKnowledgeError(`Knowledge Base isn't ready yet: ${result.error.message}. Run the V5 SQL in Supabase.`);
    } else setKnowledgeEntries((result.data || []) as KnowledgeEntry[]);
    setKnowledgeLoading(false);
  }, [supabase, workspace]);

  useEffect(() => {
    if (section === "Knowledge Base" || section === "Settings") void loadKnowledge();
  }, [section, loadKnowledge]);

  const loadDocuments = useCallback(async () => {
    if (!workspace) {setDocuments([]);return;}
    setDocumentError("");
    const {data,error}=await supabase.from("knowledge_documents")
      .select("id,filename,file_type,page_count,characters,created_at")
      .eq("workspace_id",workspace.id).order("created_at",{ascending:false}).limit(100);
    if (error) setDocumentError("Document tables aren't ready yet. Run the V6 SQL in Supabase.");
    else setDocuments((data||[]) as KnowledgeDocument[]);
  },[supabase,workspace]);

  useEffect(() => {
    if (section==="Knowledge Base" || section === "Settings") void loadDocuments();
  },[section,loadDocuments]);

  async function buildSemanticIndex() {
    if (semanticBusy || !workspace) return;
    setSemanticBusy(true);
    setSemanticStatus("");
    try {
      const response = await fetch("/api/knowledge/index", {method:"POST",cache:"no-store"});
      const data:{error?:string;message?:string} = await response.json();
      if (!response.ok) throw new Error(data.error || "Indexing failed.");
      setSemanticStatus(data.message || "Semantic index updated.");
    } catch(err) {
      setSemanticStatus(err instanceof Error ? err.message : "Semantic index unavailable.");
    } finally { setSemanticBusy(false); }
  }

  async function uploadDocument(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!documentFile || !workspace || documentBusy) return;
    setDocumentError("");setDocumentSuccess("");setDocumentBusy(true);
    try {
      const formData=new FormData();formData.set("file",documentFile);
      const response=await fetch("/api/documents",{method:"POST",body:formData,cache:"no-store"});
      const result=await response.json();
      if (!response.ok) throw new Error(result.error || "Upload failed.");
      setDocumentSuccess(`Saved ${result.document.filename} with ${result.chunks} searchable text sections.`);
      setDocumentFile(null);
      const input=document.getElementById("intrigue-document-file") as HTMLInputElement|null;
      if(input) input.value="";
      await loadDocuments();
    } catch(err) {setDocumentError(err instanceof Error ? err.message : "Upload failed.");}
    finally {setDocumentBusy(false);}
  }

  async function deleteDocument(id:string) {
    if (documentBusy || !window.confirm("Delete this document and its extracted text?")) return;
    setDocumentBusy(true);setDocumentError("");setDocumentSuccess("");
    try {
      const res=await fetch("/api/documents",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});
      const result=await res.json();
      if (!res.ok) throw new Error(result.error || "Could not delete document.");
      await loadDocuments();setDocumentSuccess("Document removed.");
    } catch(err) {setDocumentError(err instanceof Error ? err.message : "Could not delete document.");}
    finally {setDocumentBusy(false);}
  }

  async function addKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || knowledgeBusy) return;
    const title=knowledgeForm.title.trim();
    const content=knowledgeForm.content.trim();
    if (title.length < 3 || title.length > 120 || content.length < 10 || content.length > 4000) {
      setKnowledgeError("Title must have 3â€“120 characters and content 10â€“4,000 characters.");
      return;
    }
    setKnowledgeBusy(true); setKnowledgeError("");
    const { error } = await supabase.from("knowledge_entries").insert({
      workspace_id: workspace.id, title, content, category: knowledgeForm.category,
    });
    if (error) setKnowledgeError(`Could not save knowledge: ${error.message}`);
    else {
      setKnowledgeForm({ title: "", category: "Policy", content: "" });
      setShowKnowledgeForm(false);
      await loadKnowledge();
    }
    setKnowledgeBusy(false);
  }

  async function deleteKnowledge(id: string) {
    if (!workspace || knowledgeBusy) return;
    if (!window.confirm("Delete this knowledge entry? This cannot be undone.")) return;
    setKnowledgeBusy(true); setKnowledgeError("");
    const { error } = await supabase.from("knowledge_entries")
      .delete().eq("id", id).eq("workspace_id", workspace.id);
    if (error) setKnowledgeError(`Could not delete knowledge: ${error.message}`);
    else await loadKnowledge();
    setKnowledgeBusy(false);
  }


  const loadActions = useCallback(async () => {
    if (!workspace) {setActionProposals([]);setActionAudit([]);return;}
    const [a,b] = await Promise.all([
      supabase.from("action_proposals").select("id,customer_id,request_text,quote_description,quote_amount,quote_source,follow_up_title,follow_up_due_at,warning_text,status,created_at,quotation_id,follow_up_id")
        .eq("workspace_id",workspace.id).order("created_at",{ascending:false}).limit(50),
      supabase.from("action_audit_logs").select("id,proposal_id,decision,created_at")
        .eq("workspace_id",workspace.id).order("created_at",{ascending:false}).limit(20),
    ]);
    if (a.error || b.error) setActionError("Action Center not ready. Run the V8 SQL in Supabase first.");
    else {setActionError("");setActionProposals((a.data||[]) as ActionProposal[]);setActionAudit((b.data||[]) as ActionAudit[]);}
  },[supabase,workspace]);

  useEffect(() => { if (section==="Action Center") void loadActions(); },[section,loadActions]);

  const loadAutomationJobs = useCallback(async () => {
    if (!workspace) { setAutomationJobs([]); return; }
    const result=await supabase.from("automation_jobs")
      .select("id,proposal_id,quotation_id,kind,status,attempts,max_attempts,last_error,result,created_at,updated_at,completed_at")
      .eq("workspace_id",workspace.id).order("created_at",{ascending:false}).limit(75);
    if (result.error) setAutomationError("Unable to load automation jobs. Install the V11 SQL first: " + result.error.message);
    else { setAutomationJobs((result.data??[]) as AutomationJob[]); setAutomationError(""); }
  },[workspace,supabase]);

  useEffect(() => {
    if (section === "Automation Center") {
      void loadAutomationJobs();
      void loadActions();
    }
  },[section,loadAutomationJobs,loadActions]);

  async function queueDemoJob(proposalId:string) {
    if (automationBusy) return;
    if (!window.confirm("Queue a harmless internal receipt for this approved quotation? No customer messages or external changes will be made.")) return;
    setAutomationBusy(true);setAutomationError("");setAutomationMessage("");
    try {
      const {data,error}=await supabase.rpc("enqueue_intrigue_demo_quotation",{p_proposal_id:proposalId});
      if(error) throw new Error(error.message);
      setAutomationMessage(data?.already_exists ? "This quotation is already queued or processed. No duplicate created." : "Job saved to the durable queue. Run the worker to process it.");
      await loadAutomationJobs();
    } catch (e) {setAutomationError(e instanceof Error?e.message:"Could not enqueue quotation.");}
    finally {setAutomationBusy(false);}
  }

  async function prepareAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionBusy || actionPrompt.trim().length<10) return;
    setActionBusy(true);setActionError("");setActionMessage("");
    try {
      const response=await fetch("/api/actions/propose",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({prompt:actionPrompt}),cache:"no-store",
      });
      const data:{id?:string;error?:string}=await response.json();
      if(!response.ok) throw new Error(data.error||"Could not prepare proposal.");
      setActionMessage("Action prepared. Review the details and warnings below before approving.");
      await loadActions();
    } catch(error) {setActionError(error instanceof Error?error.message:"Could not prepare proposal.");}
    finally {setActionBusy(false);}
  }

  async function decideAction(id:string,decision:"approve"|"reject") {
    if(actionBusy) return;
    if(decision==="approve" && !window.confirm("Approve these draft actions? This writes records to Supabase but sends nothing externally.")) return;
    setActionBusy(true);setActionError("");setActionMessage("");
    try {
      const response=await fetch("/api/actions/decide",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id,decision}),cache:"no-store",
      });
      const data:{error?:string;result?:{status:string;already_decided?:boolean}}=await response.json();
      if(!response.ok) throw new Error(data.error||"Approval failed.");
      setActionMessage(data.result?.already_decided?"This proposal has already been decided.":decision==="approve"?"Approved. Draft quotation and/or follow-up saved to Supabase. Nothing sent to customers.":"Proposal rejected. No business record created.");
      await Promise.all([refresh(),loadActions()]);
    } catch(error) {setActionError(error instanceof Error?error.message:"Could not approve proposal.");}
    finally {setActionBusy(false);}
  }

  async function editAction(id:string,title:string,date:string): Promise<boolean> {
    if(actionBusy) return false;
    setActionBusy(true);setActionError("");setActionMessage("");
    try {
      const res=await fetch("/api/actions/edit",{
        method:"POST",headers:{"Content-Type":"application/json"},
        cache:"no-store",body:JSON.stringify({id,title,date}),
      });
      const body:{error?:string}=await res.json();
      if(!res.ok) throw new Error(body.error||"Could not edit follow-up.");
      await loadActions();
      setActionMessage("Follow-up updated. The quotation amount and price source remain unchanged.");
      return true;
    } catch(error){
      const message=error instanceof Error?error.message:"Could not edit follow-up.";
      setActionError(message);
      return false;
    } finally {setActionBusy(false);}
  }

  const customerName = (id:string) => customers.find((c) => c.id === id)?.full_name || "Unknown customer";
  const customerVehicle = (id:string) => customers.find((c) => c.id === id)?.vehicle || "Not specified";
  const activeEnquiries = enquiries.filter((e) => e.status !== "closed");
  const pendingTasks = tasks.filter((t) => t.status === "pending");
  const pendingQuotes = quotes.filter((q) => q.status !== "approved");
  const quotePipeline = pendingQuotes.reduce((sum, q) => sum + Number(q.amount), 0);
  const inputClass = "w-full rounded-xl border border-[#35485d] bg-[#182c41] px-3 py-2.5 text-sm text-[#f5f0e8] outline-none focus:border-[#caa961]";
  const newButtonClass = "rounded-xl bg-[#c9a552] px-4 py-2.5 text-xs font-semibold text-[#111b29] hover:bg-[#e4c47b] disabled:opacity-50";

  function navigate(next: Section) {
    if (!isOwner && OWNER_ONLY_SECTIONS.includes(next)) return;
    setSection(next);
    setMobileOpen(false);
  }

  function takeToActionCenter() {
    const lastRequest=[...messages].reverse().find(m=>m.role==="user")?.text;
    setActionPrompt(draft.trim() || lastRequest || "Prepare a quotation for Alex Fischer's brake inspection using our service prices, and create a follow-up task for tomorrow.");
    setSection("Action Center");
  }

  async function askQuestion(value = draft) {
    const question = value.trim();
    if (!question || aiLoading || !isOwner) return;
    setDraft("");
    setSection("AI Assistant");
    setMessages(previous => [...previous, {role:"user",text:question}]);
    setAiLoading(true);
    setChatActionBusy(false);
    try {
      const response = await fetch("/api/agent", {
        method:"POST", headers:{"Content-Type":"application/json"}, cache:"no-store",
        body: JSON.stringify({question}),
      });
      const result: {reply?:string;error?:string;tools_used?:string[];proposed_action_prompt?:string}=await response.json();
      if (!response.ok) throw new Error(result.error || `Agent request failed (${response.status}).`);
      if (result.proposed_action_prompt) {
        setChatActionBusy(true);
        // The AI cannot write quotations or tasks. The unchanged V9 proposal endpoint
        // independently checks customers, prices, duplicates and ownership.
        const propose = await fetch("/api/actions/propose", {
          method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",
          body:JSON.stringify({prompt:result.proposed_action_prompt}),
        });
        const proposed: {id?:string;error?:string}=await propose.json();
        if (!propose.ok || !proposed.id) throw new Error(proposed.error || "The verified proposal could not be prepared.");
        await loadActions();
        setMessages(previous=>[...previous,{
          role:"assistant", text:result.reply || "Review this action before approving. Nothing has been saved to quotes or tasks yet.",
          proposalId:proposed.id, toolsUsed:result.tools_used,
        }]);
      } else {
        setMessages(previous=>[...previous,{
          role:"assistant",text:result.reply || "The agent returned no answer.", toolsUsed:result.tools_used,
        }]);
      }
    } catch (error) {
      const message=error instanceof Error?error.message:"Unknown connection error";
      setMessages(previous=>[...previous,{role:"assistant",text:`Could not complete the request: ${message}`}]);
    } finally {setAiLoading(false);setChatActionBusy(false);}
  }

  function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void askQuestion();
  }

  // Block the new-company onboarding screen for members whose access was removed.
  // Invitation links remain usable if the former member is invited to a workspace again.
  if (!loading && !workspace && accessNotice && !joinToken && !dbError) {
    const contactEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accessNotice.contact_email)
      ? accessNotice.contact_email : "";
    return <div className="intrigue-dashboard flex min-h-screen items-center justify-center bg-[#0b1827] px-5 py-12 text-[#f5f0e8]">
      <div className="w-full max-w-xl rounded-3xl border border-[#93733c]/60 bg-[#142539] p-7 shadow-2xl md:p-10">
        <div className="mb-5 inline-flex rounded-xl border border-[#b99a60]/30 bg-[#c9a552]/10 p-3 text-[#e9c577]"><ShieldCheck size={27}/></div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#d5b46a]">INTRIGUE STUDIOS Â· Workspace access</p>
        <h1 className="brand-display mt-3 text-4xl">Your access has been removed.</h1>
        <p className="mt-4 text-sm leading-7 text-[#c7d4df]">
          Your account no longer has permission to view <strong className="text-[#f5f0e8]">{accessNotice.company_name}</strong>.
          If you think this was a mistake, contact the company administrator to request a new invitation.
        </p>
        <p className="mt-3 text-xs text-[#9eacba]">Your INTRIGUE login still exists, but this companyâ€™s data is no longer available to you.</p>
        <div className="mt-7 flex flex-wrap gap-3">
          {contactEmail && <a href={`mailto:${contactEmail}?subject=${encodeURIComponent("INTRIGUE workspace access")}`} className="rounded-xl bg-[#c9a552] px-5 py-3 text-sm font-semibold text-[#0b1827]">Contact company administrator</a>}
          <button type="button" onClick={() => void refresh()} className="rounded-xl border border-[#506077] px-5 py-3 text-sm text-[#f5f0e8]">Check access again</button>
          <button type="button" onClick={async () => { await supabase.auth.signOut(); window.location.assign("/auth/login"); }} className="rounded-xl border border-[#506077] px-5 py-3 text-sm text-[#f5f0e8]">Sign out</button>
        </div>
        {!contactEmail && <p className="mt-4 text-xs text-[#b8c7d4]">For contact details, reach the company owner through your usual communication channel.</p>}
      </div>
    </div>;
  }

  const sidebar = (
    <>
      <div className="flex items-center gap-3 px-5 pb-8 pt-8">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#9b7b35]/45 bg-[#0c1a2a]">
          <img src="https://intriguestudios.de/intrigue-logo.png" alt="INTRIGUE STUDIOS emblem" className="h-[79px] w-[70px] max-w-none translate-y-[12px] object-cover opacity-95" />
        </div>
        <div className="min-w-0">
          <div className="brand-wordmark whitespace-nowrap text-[18px] font-medium leading-5 tracking-[0.16em] text-[#f2eadb]">INTRIGUE</div>
          <div className="mt-1 text-[9px] font-semibold tracking-[0.31em] text-[#cba75b]">STUDIOS</div>
          <div className="mt-1.5 text-[9px] uppercase tracking-[0.14em] text-[#9daebb]">Operations Intelligence</div>
        </div>
      </div>
      <div className="mx-4 mb-7 rounded-xl border border-[#d9b467]/20 bg-[#ffffff]/[0.035] px-3.5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#bd9955]/20 text-[#e1c27f]"><CarFront size={19}/></div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-[#f5f0e8]">{workspace?.name ?? "Your company"}</div>
            <div className="text-[11px] text-[#9eacba]">Private staging workspace</div>
          </div>
        </div>
      </div>
      <div className="intrigue-sidebar-nav min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
        <nav className="space-y-1" aria-label="Workspace navigation">
          {NAV.filter(item => isOwner || !OWNER_ONLY_SECTIONS.includes(item.label)).map((item) => {
            const Icon = item.icon;
            const selected = section === item.label;
            const sectionTitle = ({"Overview":"WORKSPACE","Customers":"BUSINESS","AI Receptionist":"AI & AUTOMATION","Integrations":"SYSTEM"} as Record<string,string>)[item.label];
            return (
              <div key={item.label}>
              {sectionTitle && <div className="mb-2 mt-5 px-3 text-[10px] font-bold tracking-[0.2em] text-[#c4a86e]">{sectionTitle}</div>}
              <button
                type="button"
                onClick={() => navigate(item.label)}
                className={`intrigue-nav-item flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-[13px] font-medium transition-colors ${selected ? "intrigue-nav-item-active" : ""}`}
              >
                <Icon size={18} strokeWidth={selected ? 2.4 : 1.8} />
                <span className="flex-1">{item.label === "Customers" ? "Customers & CRM" : item.label === "Quotations" ? "Quotations & Proposals" : item.label}</span>
                {item.label === "AI Assistant" && !selected && <span className="h-1.5 w-1.5 rounded-full bg-[#d1ad60]"/>}
              </button>
              </div>
            );
          })}
        </nav>
      </div>
      <div className="mt-auto p-4">
        <div className="intrigue-development-preview rounded-xl border border-[#d9b467]/20 bg-gradient-to-br from-[#1e3248] to-[#0c1b2c] p-4">
          <div className="mb-2 flex items-center gap-2 text-[#d5b46a]"><ShieldCheck size={17}/><span className="text-xs font-semibold">Development preview</span></div>
          <p className="text-xs leading-5 text-[#d5dfeb]">Business records are in Supabase. Chat is read-only; Action Center drafts require your approval. Only use fictional data with unvetted model providers.</p>
        </div>
        <div className="mt-4 flex items-center gap-3 px-2 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#344358] text-xs font-bold text-[#f5f0e8]">IS</div>
          <div className="min-w-0"><div className="text-xs font-semibold text-[#f5f0e8]">INTRIGUE STUDIOS</div><div className="text-[11px] text-[#9eacba]">Developer workspace</div></div>
        </div>
      </div>
    </>
  );

  return (
    <div data-intrigue-theme={appearance} className="intrigue-dashboard intrigue-glass min-h-screen bg-[#0b1827] font-sans text-[#f2efe8] lg:flex lg:h-dvh lg:overflow-hidden">
      <aside className="intrigue-sidebar hidden h-dvh w-[258px] shrink-0 flex-col overflow-hidden bg-[#0a1624] lg:flex">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex bg-[#030810]/85 lg:hidden">
          <aside className="intrigue-sidebar flex h-full w-[275px] flex-col overflow-hidden bg-[#0a1624]">{sidebar}</aside>
          <button className="flex h-14 flex-1 justify-end p-4 text-[#f5f0e8]" type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={23}/></button>
        </div>
      )}
      <div className="intrigue-main-scroll min-w-0 flex-1 lg:h-dvh lg:overflow-y-auto lg:overscroll-contain">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#2c3b4d] bg-[#0f2032] px-5 md:px-9">
          <div className="flex items-center gap-3">
            <button type="button" className="rounded-lg p-2 hover:bg-[#26384d] lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={22}/></button>
            <span className="hidden text-[13px] text-[#9eacba] sm:block">Workspace</span>
            <ChevronRight className="hidden text-[#d5dfeb] sm:block" size={15}/>
            <span className="text-sm font-semibold">{section}</span>
          </div>
          <div className="flex items-center gap-3 md:gap-5">
            <span className="hidden items-center gap-1.5 rounded-full bg-[#654e24]/40 px-3 py-1.5 text-[11px] font-bold text-[#e7c37c] sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-[#ddb96d]"/>STAGING DATA</span>
            <button type="button" onClick={toggleAppearance} aria-label={appearance === "dark" ? "Switch to light appearance" : "Switch to dark appearance"} title={appearance === "dark" ? "Light mode" : "Dark mode"} className="rounded-xl border border-[#415064] p-2 text-[#d9c18b] transition hover:bg-[#26384d]">
              {appearance === "dark" ? <Sun size={18}/> : <Moon size={18}/>}
            </button>
            <div className="relative">
              <button type="button" onClick={() => setActivityOpen(open => !open)} aria-expanded={activityOpen} aria-label="Open activity notifications" className="rounded-xl border border-[#415064] p-2 text-[#d9c18b] transition hover:bg-[#26384d]">
                <Bell size={18}/>
              </button>
              {activityOpen && <div role="dialog" aria-label="Notifications" className="intrigue-activity-popover absolute right-0 top-12 z-50 w-[min(345px,85vw)] rounded-2xl border border-[#45566b] bg-[#13263b] p-4 shadow-2xl">
                <div className="flex items-center justify-between gap-4"><h3 className="text-sm font-semibold text-[#f1d189]">Activity & notifications</h3><button onClick={() => setActivityOpen(false)} type="button" aria-label="Close notifications" className="rounded-lg p-1 hover:bg-[#26384d]"><X size={17}/></button></div>
                <p className="mt-3 text-sm text-[#d9e2eb]">No business notifications are connected yet.</p>
                <p className="mt-2 text-xs leading-5 text-[#aebed0]">Contract signatures, quotation approvals, missed appointments and integration alerts will appear here after the secure event service is enabled. This panel does not claim to monitor those events yet.</p>
              </div>}
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#80642f] text-xs font-bold text-[#f5f0e8]">IS</div>
          </div>
        </header>

        <main className="mx-auto max-w-[1430px] px-5 pb-12 pt-8 md:px-9">
          <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#d4b469]">{workspace?.name.toUpperCase() ?? "NEW COMPANY"}  /  PRIVATE STAGING</div>
              <h1 className="brand-display text-[34px] font-medium leading-none tracking-[-0.04em] md:text-[46px]">{section === "Overview" ? "Your operations, in focus." : section}</h1>
              <p className="mt-1.5 text-sm text-[#afbdcb]">{section === "Overview" ? "An intelligent view of everything moving your business forward." : "Saved records from your private staging workspace."}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => navigate("Quotations")} className="flex items-center gap-2 rounded-xl border border-[#415064] bg-[#142539] px-4 py-2.5 text-xs font-semibold text-[#f0e9dc] shadow-sm hover:bg-[#1b2e42]"><Plus size={16}/>View quotes</button>
              {isOwner && <button type="button" onClick={() => navigate("AI Assistant")} className="flex items-center gap-2 rounded-xl bg-[#c9a552] px-4 py-2.5 text-xs font-semibold text-[#111b29] hover:bg-[#e4c47b]"><Sparkles size={16}/>Ask AI</button>}
            </div>
          </div>

          {dbError && <div role="alert" className="mb-6 rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-200">{dbError} <button type="button" onClick={()=>void refresh()} className="ml-3 underline">Retry</button></div>}
          {loading && <div className="rounded-2xl border border-[#304153] bg-[#142539] p-8 text-sm text-[#afbdcb]">Loading your Supabase workspace...</div>}
          {!loading && joinToken && <div className="mb-6 rounded-2xl border border-[#a18343]/60 bg-[#142539] p-6">
            <h2 className="text-lg font-semibold text-[#f2d486]">Team invitation</h2>
            <p className="mt-2 text-sm text-[#d5dfeb]">Join the invited workspace using the account whose verified email matches the invitation. Team access follows the role assigned by your company owner.</p>
            <button type="button" disabled={teamBusy} onClick={()=>void acceptInvite()} className="mt-4 rounded-xl bg-[#c9a552] px-4 py-2.5 text-sm font-semibold text-[#111b29] disabled:opacity-50">{teamBusy?"Joining...":"Accept invitation"}</button>
            {teamError && <p role="alert" className="mt-3 text-sm text-[#ffb3a7]">{teamError}</p>}
          </div>}
          {!loading && !workspace && !dbError && !joinToken && (
            <div className="rounded-2xl border border-[#a18343]/40 bg-[#142539] p-8">
              <h2 className="brand-display text-4xl text-[#f5f0e8]">Create your company workspace.</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[#afbdcb]">V13 starts each newly registered company with an empty, owner-only workspace. Your other company records remain private. For testing, enter a fictional company name and do not upload real customer data.</p>
              <form onSubmit={createCompany} className="mt-6 flex max-w-xl flex-col gap-3 sm:flex-row">
                <label htmlFor="v13-company-name" className="sr-only">Company name</label>
                <input id="v13-company-name" type="text" required minLength={2} maxLength={100} value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Demo Garage Two" className="min-w-0 flex-1 rounded-xl border border-[#51627a] bg-[#101e31] px-4 py-3 text-sm text-[#f5f0e8] outline-none focus:border-[#c9a552]" />
                <button type="submit" disabled={busy || companyName.trim().length < 2} className="rounded-xl bg-[#c9a552] px-5 py-3 text-sm font-bold text-[#111b29] disabled:opacity-50">{busy ? "Creating..." : "Create company"}</button>
              </form>
              <p className="mt-4 text-xs text-[#d5b46a]">One workspace per account in V14. Accept a verified-email invitation to join as staff instead of creating a company.</p>
            </div>
          )}
          {!loading && workspace && <>
          {section === "Overview" && (
            <div className="space-y-6">
              <div className="intrigue-hero relative overflow-hidden rounded-[20px] border border-[#a18343]/35 bg-[linear-gradient(118deg,#15283c_0%,#1a2c3f_62%,#403626_100%)] p-6 text-[#f5f0e8] shadow-[0_18px_45px_rgba(0,0,0,0.14)] md:p-8">
                <div className="absolute -right-12 -top-20 h-64 w-64 rounded-full border-[45px] border-[#d5b264]/10"/>
                <div className="absolute right-20 top-16 h-44 w-44 rounded-full border-[28px] border-[#d5b264]/10"/>
                <img src="https://intriguestudios.de/intrigue-logo.png" alt="" aria-hidden="true" className="pointer-events-none absolute -right-8 -top-24 hidden h-[410px] w-[360px] object-contain opacity-[0.24] lg:block" />
                <div className="relative z-10 max-w-xl">
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-[#e5c47c]/10 px-3 py-1.5 text-[11px] font-semibold text-[#f2d486]"><Zap size={13}/>INTELLIGENCE, BY DESIGN</div>
                  <h2 className="brand-display text-[34px] font-medium leading-[1.05] tracking-[-0.02em] md:text-[51px]">One system. Infinite clarity.</h2>
                  <p className="mt-3 max-w-md text-[13px] leading-6 text-[#d3d8dd]/80">Your clients, knowledge and workflows in one intelligent workspace. Designed to help your business move with precision.</p>
                  {isOwner && <button type="button" onClick={() => navigate("AI Assistant")} className="mt-6 flex items-center gap-2 rounded-xl bg-[#d1ad60] px-4 py-2.5 text-xs font-bold text-[#182234] hover:bg-[#f0d38c]">Meet your AI assistant <ArrowRight size={15}/></button>}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { title: "Active inquiries", value: String(activeEnquiries.length), change: "Saved in Supabase", icon: Users, color: "text-[#e0bf76] bg-[#263447]" },
                  { title: "Draft quote pipeline", value: money(quotePipeline), change: "Unapproved quotes", icon: FileText, color: "text-[#d6bc8e] bg-[#383044]" },
                  { title: "Pending follow-ups", value: String(pendingTasks.length), change: "Actionable tasks", icon: Clock3, color: "text-[#f1cc7f] bg-[#554126]/40" },
                  { title: "Customers tracked", value: String(customers.length), change: "Demo contacts", icon: Users, color: "text-[#b4c1e6] bg-[#263751]" },
                ].map((item) => {
                  const Icon = item.icon;
                  return <div key={item.title} className="rounded-2xl border border-[#304153] bg-[#142539] p-5 shadow-[0_10px_25px_rgba(0,0,0,0.12)]">
                    <div className="flex items-start justify-between"><div className="text-xs font-semibold text-[#afbdcb]">{item.title}</div><div className={`rounded-xl p-2.5 ${item.color}`}><Icon size={18}/></div></div>
                    <div className="mt-3 text-[28px] font-semibold tracking-[-0.05em] text-[#edd4a0]">{item.value}</div>
                    <div className="mt-1 text-[11px] text-[#afbdcb]">{item.change}</div>
                  </div>;
                })}
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(310px,1fr)]">
                <div className="rounded-2xl border border-[#304153] bg-[#142539] shadow-sm">
                  <div className="flex items-center justify-between border-b border-[#2d3b4f] px-5 py-5 md:px-6"><div><h3 className="text-[15px] font-bold">Recent inquiries</h3><p className="mt-1 text-xs text-[#9eacba]">Customers that need your attention</p></div><button type="button" onClick={() => navigate("Customers")} className="flex items-center gap-1 text-xs font-semibold text-[#e0bf76] hover:underline">View all <ArrowUpRight size={15}/></button></div>
                  <div className="intrigue-inquiries-overview min-w-0"><table className="w-full table-fixed text-left"><thead><tr className="border-b border-[#2d3b4f] bg-[#192b3e]/70 text-[11px] uppercase tracking-[0.04em] text-[#9eacba]"><th className="px-6 py-3 font-semibold">Customer</th><th className="px-3 py-3 font-semibold">Request</th><th className="px-3 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Received</th></tr></thead><tbody>{enquiries.slice(0, 5).map((row) => <tr key={row.id} className="border-b border-[#2d3b4f] last:border-0"><td className="px-6 py-4"><div className="text-xs font-bold text-[#f5f0e8]">{customerName(row.customer_id)}</div><div className="mt-1 text-[11px] text-[#9eacba]">{customerVehicle(row.customer_id)}</div></td><td className="px-3 py-4 text-xs text-[#d5dbe0]">{row.subject}</td><td className="px-3 py-4"><Tag variant={row.status === "follow_up" ? "amber" : row.status === "scheduled" ? "emerald" : row.status === "new" ? "blue" : "slate"}>{statusText(row.status)}</Tag></td><td className="px-4 py-4 text-[11px] text-[#9eacba]">{niceDate(row.created_at)}</td></tr>)}</tbody></table></div>
                </div>
                <div className="rounded-2xl border border-[#304153] bg-[#142539] p-5 shadow-sm md:p-6">
                  <div className="mb-1 flex items-center gap-2"><Sparkles size={19} className="text-[#e0bb72]"/><h3 className="text-[15px] font-bold">Ask your business</h3></div>
                  <p className="mb-5 text-xs leading-5 text-[#9eacba]">Ask your AI about customers, quotations and follow-ups saved in Supabase.</p>
                  <div className="mb-4 rounded-xl border border-[#3f3a2b] bg-[#182b3e] p-4"><div className="mb-2 flex items-center gap-2 text-xs font-bold text-[#f5f0e8]"><Bot size={17} className="text-[#e0bf76]"/>INTRIGUE Assistant</div><p className="text-xs leading-6 text-[#d5dbe0]">You have <strong>{pendingTasks.length} pending follow-ups</strong> and <strong>{money(quotePipeline)}</strong> in unapproved quotations. What would you like to review first?</p></div>
                  {isOwner && <div className="space-y-2">{QUICK_PROMPTS.map((prompt) => <button type="button" key={prompt} onClick={() => void askQuestion(prompt)} disabled={aiLoading} className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#35485d] px-3.5 py-3 text-left text-xs font-medium text-[#d5dbe0] hover:border-[#caa961] hover:bg-[#2c3949]/50">{prompt}<ArrowRight size={15} className="shrink-0 text-[#9eacba]"/></button>)}</div>}
                  <div className="mt-4 text-[10px] text-[#9eacba]">AI answers use current database records. The model cannot modify business records.</div>
                </div>
              </div>
              <div className="rounded-xl border border-dashed border-[#516071] bg-[#0f1e2d] px-4 py-3 text-xs text-[#abb8c3]"><strong>Demo workspace:</strong> Figures reflect fictional records stored in your Supabase database. AI is read-only in this phase.</div>
            </div>
          )}

          {section === "AI Receptionist" && workspace && isOwner && (
            <ReceptionistPanel workspaceId={workspace.id} />
          )}

          {section === "Data Management" && workspace && isOwner && (
            <DataManagementPanel workspaceId={workspace.id} onCompleted={() => { void refresh(); }} />
          )}

          {section === "AI Assistant" && (
            <div className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-[#2c3b4d] bg-[#0f2032] shadow-sm">
              <div className="flex items-center gap-3 border-b border-[#2d3b4f] p-5"><div className="rounded-xl bg-[#263447] p-3 text-[#e0bf76]"><Bot size={22}/></div><div><div className="text-sm font-bold">INTRIGUE Assistant</div><div className="text-[11px] text-[#afbdcb]">Tool-calling agent Â· Reads records and prepares approval proposals</div></div><span className="ml-auto"><Tag variant={aiConnected ? "emerald" : "amber"}>{aiConnected ? "AI configured" : "API key missing"}</Tag></span></div>
              <div className="flex h-[440px] flex-col gap-4 overflow-y-auto bg-[#0d1c2b] p-5 md:p-6" aria-live="polite">{messages.map((message, index) => <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`${message.proposalId?"w-full max-w-[90%]":"max-w-[85%]"} space-y-3`}><div className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[13px] leading-6 ${message.role === "user" ? "rounded-tr-sm bg-[#30455b] text-[#f5f0e8]" : "rounded-tl-sm border border-[#304153] bg-[#142539] text-[#f0e9dc]"}`}>{message.text}</div>{message.toolsUsed?.length ? <p className="text-[11px] text-[#d6bc80]">Tools: {message.toolsUsed.join(" Â· ")}</p> : null}{message.proposalId && (actionProposals.find(p=>p.id===message.proposalId) ? <ProposalReviewCard proposal={actionProposals.find(p=>p.id===message.proposalId)!} customer={customerName(actionProposals.find(p=>p.id===message.proposalId)!.customer_id)} busy={actionBusy} onDecide={(id,decision)=>void decideAction(id,decision)} onEdit={editAction}/> : <button type="button" className="text-xs text-[#e9c577] underline" onClick={()=>navigate("Action Center")}>Open proposal in Action Center</button>)}</div></div>)}{aiLoading && <p className="text-xs text-[#d8c18e]">{chatActionBusy?"Preparing a verified proposal...":"Calling authorized business tools..."}</p>}{actionError && <p role="alert" className="rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-xs text-[#ffc2b9]">Action: {actionError}</p>}{actionMessage && <p role="status" className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-xs text-[#b3ead0]">{actionMessage}</p>}</div>
              <div className="border-t border-[#2d3b4f] p-4 md:p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-[#afbdcb]">V10 tools: customers, quotations, follow-ups, knowledge and approval drafts. Human approval required.</span><button type="button" onClick={takeToActionCenter} className="rounded-lg border border-[#b18c46] px-3 py-2 text-xs font-semibold text-[#e9c577] hover:bg-[#26384d]">Prepare actions for approval</button></div><div className="mb-3 flex flex-wrap gap-2">{QUICK_PROMPTS.map((prompt) => <button key={prompt} type="button" onClick={() => void askQuestion(prompt)} disabled={aiLoading} className="rounded-full border border-[#35485d] px-3 py-1.5 text-[11px] text-[#d5dbe0] hover:bg-[#1b2e42]">{prompt}</button>)}</div><form onSubmit={submitChat} className="flex gap-2"><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask a question or request a draft quote..." className="min-w-0 flex-1 rounded-xl border border-[#35485d] bg-[#182c41] px-4 py-3 text-sm text-[#f5f0e8] placeholder:text-[#98a8b8] outline-none focus:border-[#caa961]" aria-label="Message"/><button type="submit" disabled={!draft.trim() || aiLoading} className="flex h-[46px] w-[48px] items-center justify-center rounded-xl bg-[#30455b] text-[#f5f0e8] disabled:opacity-40" aria-label="Send message"><Send size={18}/></button></form></div>
            </div>
          )}

          {section === "Action Center" && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-[#806f46]/50 bg-[#142539] p-6">
                <div className="mb-3 flex items-center gap-3"><ClipboardCheck size={22} className="text-[#e0bf76]"/><h2 className="text-base font-bold">Actions with your approval</h2><Tag variant="amber">V9 Demo</Tag></div>
                <p className="mb-5 max-w-3xl text-xs leading-6 text-[#c9d4df]">Turn a request into a proposed draft quotation and/or follow-up. Prices come from your saved policies or service lists, not from an AI guess. Nothing is written to customer business records until you approve. No emails or WhatsApp messages are sent.</p>
                <form onSubmit={prepareAction} className="space-y-3">
                  <label htmlFor="action-prompt" className="block text-xs font-semibold text-[#e9c577]">What should INTRIGUE prepare?</label>
                  <textarea id="action-prompt" className={`${inputClass} min-h-[100px] resize-y`} value={actionPrompt} maxLength={1000} onChange={e=>setActionPrompt(e.target.value)} placeholder="Prepare a quotation for Alex Fischer's brake inspection and a follow-up task for tomorrow." />
                  <button className={newButtonClass} type="submit" disabled={actionBusy || !workspace || actionPrompt.trim().length<10}>{actionBusy?"Working...":"Prepare proposal"}</button>
                </form>
                <p className="mt-3 text-[11px] text-[#aab9c8]">V9 proposal parsing is rule-based and supports brake inspections, cabin air filters, exact customer names, and tomorrow or YYYY-MM-DD dates. Chat remains powered by OpenRouter.</p>
                {actionError && <p role="alert" className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-[#ffc2b9]">{actionError}</p>}
                {actionMessage && <p role="status" className="mt-4 rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs text-[#b3ead0]">{actionMessage}</p>}
              </div>
              <div className="flex items-center justify-between gap-3"><h3 className="text-base font-semibold">Approval queue</h3><button type="button" className="rounded-lg border border-[#35485d] px-3 py-2 text-xs text-[#e7c37c]" onClick={()=>void loadActions()}>Refresh queue</button></div>
              {actionProposals.length===0 && <div className="rounded-2xl border border-dashed border-[#45576a] p-7 text-sm text-[#afbdcb]">No proposals yet. Submit your first request above.</div>}
              {actionProposals.map(p=><ProposalReviewCard key={p.id} proposal={p} customer={customerName(p.customer_id)} busy={actionBusy} onDecide={(id,decision)=>void decideAction(id,decision)} onEdit={editAction}/>)}
              {actionAudit.length>0 && <div className="rounded-xl border border-[#35485d] bg-[#142539] p-5"><h3 className="mb-3 text-sm font-semibold">Recent audit history</h3>{actionAudit.slice(0,8).map(row=><p key={row.id} className="border-t border-[#35485d] py-2 text-xs text-[#bac9d6]">{row.decision} Â· {niceDate(row.created_at)} Â· Proposal {row.proposal_id.slice(0,8)}</p>)}</div>}
            </div>
          )}

          {section === "Automation Center" && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-[#806f46]/50 bg-[#142539] p-6">
                <div className="mb-3 flex items-center gap-3"><Zap size={22} className="text-[#e0bf76]"/><h2 className="text-base font-bold">INTRIGUE Native Automation Engine</h2><Tag variant="amber">V11 Â· Local worker test</Tag></div>
                <p className="max-w-3xl text-xs leading-6 text-[#c9d4df]">Queue a safe processing receipt for a quotation you already approved. Supabase stores the job and its history. A separate worker processes it. No email, WhatsApp, CRM update or customer action will occur.</p>
              </div>
              {automationError && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-xs text-[#ffc2b9]">{automationError}</p>}
              {automationMessage && <p role="status" className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-xs text-[#b3ead0]">{automationMessage}</p>}
              <div className="rounded-2xl border border-[#35485d] bg-[#142539] p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">Approved quotations available for processing</h3><button type="button" onClick={()=>{void loadActions();void loadAutomationJobs();}} disabled={automationBusy} className="rounded-lg border border-[#806f46] px-3 py-2 text-xs text-[#e9c577]">Refresh</button></div>
                <div className="space-y-3">
                  {actionProposals.filter(p=>p.status==="approved" && !!p.quotation_id).length===0 && <p className="text-xs text-[#afbdcb]">No approved quotations yet. Approve a quote in AI Assistant or Action Center first.</p>}
                  {actionProposals.filter(p=>p.status==="approved" && !!p.quotation_id).map(p=>{
                    const job=automationJobs.find(j=>j.proposal_id===p.id);
                    return <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#34475b] bg-[#0e2032] p-4">
                      <div><p className="text-sm font-semibold">{customerName(p.customer_id)} Â· {p.quote_description || "Approved quotation"}</p><p className="mt-1 text-xs text-[#afbdcb]">{money(Number(p.quote_amount))} Â· Quote {p.quotation_id?.slice(0,8)}</p></div>
                      {job ? <Tag variant={job.status==="completed"?"emerald":job.status==="needs_review"?"amber":"blue"}>{job.status.replaceAll("_"," ")}</Tag> :
                        <button type="button" disabled={automationBusy} onClick={()=>void queueDemoJob(p.id)} className="rounded-lg bg-[#c9a552] px-4 py-2.5 text-xs font-bold text-[#111b29] disabled:opacity-50">Queue demo job</button>}
                    </div>;
                  })}
                </div>
              </div>
              <div className="rounded-2xl border border-[#35485d] bg-[#142539] p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">Job history</h3><span className="text-xs text-[#aebdcb]">{automationJobs.length} visible jobs</span></div>
                {automationJobs.length===0 && <p className="text-xs text-[#afbdcb]">No jobs queued. Use the button above to add the first one.</p>}
                <div className="space-y-3">{automationJobs.map(j=><div key={j.id} className="rounded-xl border border-[#34475b] bg-[#0e2032] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold">Job {j.id.slice(0,8)} Â· Quote {j.quotation_id.slice(0,8)}</p><Tag variant={j.status==="completed"?"emerald":j.status==="needs_review"?"amber":"blue"}>{j.status.replaceAll("_"," ")}</Tag></div>
                  <p className="mt-2 text-[11px] text-[#afbdcb]">Attempts: {j.attempts}/{j.max_attempts} Â· Created {niceDate(j.created_at)}</p>
                  {j.result?.message && <p className="mt-2 text-xs text-[#b3ead0]">{j.result.message}</p>}
                  {j.last_error && <p className="mt-2 text-xs text-[#ffc2b9]">Error: {j.last_error}</p>}
                </div>)}</div>
              </div>
              <div className="rounded-xl border border-[#665632] bg-[#1b2c3f] p-5 text-xs leading-6 text-[#d9c8a7]">For V11 testing, start the separate worker from your VS Code terminal using the README command, then refresh this page. Local workers stop when your laptop is off. Independent cloud deployment comes in V12.</div>
            </div>
          )}

          {section === "Get Started" && <div className="space-y-5">
            <div className="rounded-2xl border border-[#9c8046]/50 bg-[#142539] p-7">
              <h2 className="brand-display text-3xl">Set up your workspace</h2>
              <p className="mt-2 text-sm text-[#afbdcb]">Six practical steps to make INTRIGUE useful for your business. Complete them at your own pace; staff permissions are checked in the database.</p>
              <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-[#28394b]"><div className="h-full bg-[#c9a552]" style={{width:`${Math.round(([true,Boolean(settings.description.trim()&&settings.business_hours.trim()),services.length>0,knowledgeEntries.length>0||documents.length>0,Boolean(settings.ai_name.trim()),teamMembers.length>1].filter(Boolean).length/6)*100)}%`}}/></div>
              <p className="mt-2 text-xs text-[#d9bd7d]">{[true,Boolean(settings.description.trim()&&settings.business_hours.trim()),services.length>0,knowledgeEntries.length>0||documents.length>0,Boolean(settings.ai_name.trim()),teamMembers.length>1].filter(Boolean).length} of 6 steps complete (team optional)</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">{[
              {label:"1. Create your company",done:!!workspace,to:"Settings" as Section,help:"Your workspace exists and belongs to your account."},
              {label:"2. Complete business profile",done:Boolean(settings.description.trim()&&settings.business_hours.trim()),to:"Settings" as Section,help:"Industry, contacts, hours and timezone."},
              {label:"3. Add services and pricing",done:services.length>0,to:"Service Catalog" as Section,help:"Create prices for your own business."},
              {label:"4. Upload knowledge",done:knowledgeEntries.length>0||documents.length>0,to:"Knowledge Base" as Section,help:"Add your policies and service documents."},
              {label:"5. Configure the AI assistant",done:Boolean(settings.ai_name.trim()&&settings.ai_role.trim()&&settings.ai_guidance.trim()),to:"Settings" as Section,help:"Set a name, role and business-specific guidance."},
              {label:"6. Invite your team (optional)",done:teamMembers.length>1,to:"Team" as Section,help:"Choose Admin, Staff or Viewer roles."},
            ].map(step=><button key={step.label} type="button" onClick={()=>navigate(step.to)} className="rounded-xl border border-[#35485d] bg-[#142539] p-5 text-left hover:border-[#c9a552]"><span className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className={step.done?"text-[#b3ead0]":"text-[#71869b]"} size={17}/>{step.label}</span><span className="mt-2 block text-xs text-[#afbdcb]">{step.help}</span><span className="mt-3 block text-xs text-[#e7c37c]">{step.done?"Completed Â· Review":"Open setup"} â†’</span></button>)}</div>
            <p className="text-xs text-[#e6cc8d]">Staging only. Do not upload real customer information until direct cross-account API tests and quota blocking tests pass.</p>
          </div>}

          {section === "Service Catalog" && <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#35485d] bg-[#142539] p-6"><div><h2 className="text-lg font-semibold">Your services & prices</h2><p className="mt-1 text-xs text-[#afbdcb]">Workspace-specific catalog. Your AI can look up active services; quotations still require the existing approval flow.</p></div>
              {canManageCatalog && <button type="button" className={newButtonClass} onClick={()=>{setShowServiceForm(v=>!v);setServiceForm({id:"",name:"",description:"",price:"",currency:settings.currency,is_active:true});}}><Plus size={14} className="mr-1 inline"/>New service</button>}</div>
            {serviceError && <p role="alert" className="rounded-lg border border-red-400/40 p-3 text-sm text-[#ffb3a7]">{serviceError}</p>}
            {canManageCatalog && showServiceForm && <form onSubmit={saveService} className="grid gap-3 rounded-2xl border border-[#927b4e] bg-[#142539] p-5 md:grid-cols-2">
              <label className="text-xs text-[#e7c37c]">Service name<input required minLength={2} maxLength={120} className={`${inputClass} mt-2`} value={serviceForm.name} onChange={e=>setServiceForm({...serviceForm,name:e.target.value})}/></label>
              <label className="text-xs text-[#e7c37c]">Price<input type="number" min="0" max="999999999" step="0.01" required className={`${inputClass} mt-2`} value={serviceForm.price} onChange={e=>setServiceForm({...serviceForm,price:e.target.value})}/></label>
              <label className="text-xs text-[#e7c37c]">Currency<select className={`${inputClass} mt-2`} value={serviceForm.currency} onChange={e=>setServiceForm({...serviceForm,currency:e.target.value})}>{["EUR","USD","GBP","KES"].map(x=><option key={x}>{x}</option>)}</select></label>
              <label className="flex items-center gap-2 text-xs text-[#e7c37c]"><input type="checkbox" checked={serviceForm.is_active} onChange={e=>setServiceForm({...serviceForm,is_active:e.target.checked})}/>Active service</label>
              <label className="text-xs text-[#e7c37c] md:col-span-2">Description<textarea maxLength={1000} className={`${inputClass} mt-2 min-h-20`} value={serviceForm.description} onChange={e=>setServiceForm({...serviceForm,description:e.target.value})}/></label>
              <div className="flex gap-2 md:col-span-2"><button disabled={serviceBusy} className={newButtonClass} type="submit">{serviceBusy?"Saving...":serviceForm.id?"Save changes":"Add service"}</button><button type="button" onClick={()=>setShowServiceForm(false)} className="rounded-xl border border-[#526076] px-4 py-2 text-xs">Cancel</button></div>
            </form>}
            <div className="grid gap-3 md:grid-cols-2">{services.map(item=><article key={item.id} className="rounded-2xl border border-[#35485d] bg-[#142539] p-5"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold">{item.name}</h3><Tag variant={item.is_active?"emerald":"slate"}>{item.is_active?"Active":"Inactive"}</Tag></div><p className="mt-2 text-lg font-semibold text-[#e4c47b]">{new Intl.NumberFormat("en-GB",{style:"currency",currency:item.currency}).format(Number(item.price))}</p><p className="mt-2 text-xs leading-5 text-[#afbdcb]">{item.description||"No description yet"}</p>{canManageCatalog && <div className="mt-4 flex gap-2"><button type="button" className="rounded-lg border border-[#8b764d] px-3 py-2 text-xs" onClick={()=>{setServiceForm({id:item.id,name:item.name,description:item.description,price:String(item.price),currency:item.currency,is_active:item.is_active});setShowServiceForm(true);}}>Edit</button><button type="button" disabled={serviceBusy} className="rounded-lg border border-[#795557] px-3 py-2 text-xs text-[#f3c2b9]" onClick={()=>void removeService(item.id)}>Delete</button></div>}</article>)}{services.length===0 && <p className="rounded-2xl border border-[#35485d] bg-[#142539] p-7 text-sm text-[#afbdcb]">No services yet. {canManageCatalog?"Add the first service to begin.":"Ask your owner or admin to add services."}</p>}</div>
          </div>}

          {section === "Customers" && <div className="overflow-hidden rounded-2xl border border-[#304153] bg-[#142539] shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2d3b4f] p-6"><div><h2 className="text-base font-bold">Customers & inquiries</h2><p className="mt-1 text-xs text-[#afbdcb]">Stored fictional records Â· Supabase</p></div>{canWriteOps && <button type="button" onClick={()=>setShowCustomerForm(!showCustomerForm)} className={newButtonClass}><Plus size={14} className="mr-1 inline"/>New inquiry</button>}</div>
            {canWriteOps && showCustomerForm && <form onSubmit={addCustomer} className="grid gap-3 border-b border-[#2d3b4f] p-5 md:grid-cols-3"><input className={inputClass} placeholder="Customer name" aria-label="Customer name" required maxLength={150} value={customerForm.name} onChange={e=>setCustomerForm({...customerForm,name:e.target.value})}/><input className={inputClass} placeholder="Vehicle (optional)" aria-label="Vehicle" maxLength={120} value={customerForm.vehicle} onChange={e=>setCustomerForm({...customerForm,vehicle:e.target.value})}/><input className={inputClass} placeholder="Service request" aria-label="Service request" required maxLength={300} value={customerForm.service} onChange={e=>setCustomerForm({...customerForm,service:e.target.value})}/><button type="submit" disabled={busy} className={`${newButtonClass} md:col-span-3`}>Save customer & inquiry</button></form>}
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="bg-[#1b2e42] text-xs text-[#afbdcb]"><th className="px-6 py-3">Name</th><th className="px-6 py-3">Vehicle</th><th className="px-6 py-3">Service request</th><th className="px-6 py-3">Status</th></tr></thead><tbody>{enquiries.map((row) => <tr className="border-t border-[#2d3b4f]" key={row.id}><td className="px-6 py-4 font-semibold">{customerName(row.customer_id)}</td><td className="px-6 py-4">{customerVehicle(row.customer_id)}</td><td className="px-6 py-4">{row.subject}</td><td className="px-6 py-4"><Tag>{statusText(row.status)}</Tag></td></tr>)}</tbody></table>{enquiries.length===0 && <p className="p-6 text-sm text-[#afbdcb]">No customer inquiries yet. Add one to get started.</p>}</div>
          </div>}

          {section === "Quotations" && <div className="overflow-hidden rounded-2xl border border-[#304153] bg-[#142539] shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2d3b4f] p-6"><div><h2 className="text-base font-bold">Draft quotations</h2><p className="mt-1 text-xs text-[#afbdcb]">Saved drafts only. Nothing is sent automatically.</p></div>{isOwner && <button type="button" className={newButtonClass} onClick={()=>setShowQuoteForm(!showQuoteForm)}><Plus size={14} className="mr-1 inline"/>New quote</button>}</div>
            {isOwner && showQuoteForm && <form onSubmit={addQuote} className="grid gap-3 border-b border-[#2d3b4f] p-5 md:grid-cols-3"><select className={inputClass} required value={quoteForm.customerId} onChange={e=>setQuoteForm({...quoteForm,customerId:e.target.value})} aria-label="Select customer"><option value="">Select customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}</select><input className={inputClass} placeholder="Service description" aria-label="Service description" required maxLength={300} value={quoteForm.description} onChange={e=>setQuoteForm({...quoteForm,description:e.target.value})}/><input className={inputClass} type="number" min="0.01" step="0.01" placeholder="Amount in EUR" aria-label="Amount in EUR" required value={quoteForm.amount} onChange={e=>setQuoteForm({...quoteForm,amount:e.target.value})}/><button type="submit" disabled={busy || !customers.length} className={`${newButtonClass} md:col-span-3`}>Save draft quote</button></form>}
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="bg-[#1b2e42] text-xs text-[#afbdcb]"><th className="px-6 py-3">Quote</th><th className="px-6 py-3">Customer</th><th className="px-6 py-3">Service</th><th className="px-6 py-3">Amount</th><th className="px-6 py-3">Status</th></tr></thead><tbody>{quotes.map((row) => <tr className="border-t border-[#2d3b4f]" key={row.id}><td className="px-6 py-4 font-semibold">QT-{row.id.slice(0,6).toUpperCase()}</td><td className="px-6 py-4">{customerName(row.customer_id)}</td><td className="px-6 py-4">{row.description}</td><td className="px-6 py-4 font-semibold">{money(Number(row.amount))}</td><td className="px-6 py-4"><Tag variant="amber">{statusText(row.status)}</Tag></td></tr>)}</tbody></table>{quotes.length===0 && <p className="p-6 text-sm text-[#afbdcb]">No quotations yet.</p>}</div>
          </div>}

          {section === "Follow-ups" && <div className="space-y-4">
            {canWriteOps && <div className="flex justify-end"><button type="button" className={newButtonClass} onClick={()=>setShowFollowForm(!showFollowForm)}><Plus size={14} className="mr-1 inline"/>New follow-up</button></div>}
            {canWriteOps && showFollowForm && <form onSubmit={addFollowUp} className="grid gap-3 rounded-2xl border border-[#35485d] bg-[#142539] p-5 md:grid-cols-3"><select className={inputClass} required value={followForm.customerId} onChange={e=>setFollowForm({...followForm,customerId:e.target.value})} aria-label="Select customer"><option value="">Select customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}</select><input className={inputClass} required maxLength={300} placeholder="Follow-up task" aria-label="Follow-up task" value={followForm.title} onChange={e=>setFollowForm({...followForm,title:e.target.value})}/><input className={inputClass} required type="date" aria-label="Due date" value={followForm.date} onChange={e=>setFollowForm({...followForm,date:e.target.value})}/><button disabled={busy || !customers.length} className={`${newButtonClass} md:col-span-3`}>Save follow-up</button></form>}
            <div className="grid gap-4 md:grid-cols-2">{tasks.map(task=><div key={task.id} className="rounded-2xl border border-[#35485d] bg-[#142539] p-6 shadow-sm"><div className="mb-4 flex items-start justify-between gap-3"><div className="text-base font-bold">{customerName(task.customer_id)}</div><Tag variant={task.status==="done"?"emerald":"amber"}>{task.status==="done"?"Completed":task.priority==="high"?"High priority":"Pending"}</Tag></div><p className="text-sm font-medium text-[#f0e9dc]">{task.title}</p><p className="mt-2 text-xs leading-5 text-[#afbdcb]">Due {niceDate(task.due_at)} Â· {customerVehicle(task.customer_id)}</p>{canWriteOps && task.status==="pending" && <button type="button" disabled={busy} onClick={()=>completeFollowUp(task.id)} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[#9f7b39] px-3 py-2 text-xs text-[#e1c178] hover:bg-[#304153]"><CheckCircle2 size={15}/>Mark complete</button>}</div>)}</div>
            {tasks.length===0 && <p className="rounded-xl border border-[#35485d] p-6 text-sm text-[#afbdcb]">No follow-up tasks yet.</p>}
          </div>}

          {section === "Knowledge Base" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#35485d] bg-[#142539] p-6">
                <div><div className="flex items-center gap-2"><BookOpen size={20} className="text-[#e0bf76]"/><h2 className="text-base font-bold">Company Knowledge Base</h2></div>
                  <p className="mt-2 max-w-xl text-xs leading-6 text-[#afbdcb]">Store fictional policies and text-based PDF, TXT or Markdown files. V7 can search by meaning once you build the semantic index. Scanned-PDF OCR is not included.</p>
                </div>
                {isOwner && <button type="button" onClick={() => setShowKnowledgeForm(v => !v)} className={newButtonClass} disabled={!workspace}><Plus size={15} className="mr-1 inline"/> Add knowledge</button>}
              </div>
              {isOwner && <section className="rounded-2xl border border-[#35485d] bg-[#142539] p-6">
                <div className="mb-4 flex items-center gap-3"><FileUp size={20} className="text-[#e0bf76]"/>
                  <div><h3 className="font-semibold text-sm">Upload company documents</h3>
                  <p className="mt-1 text-xs leading-5 text-[#afbdcb]">PDF (selectable text), TXT or Markdown. Max 2 MB, PDFs up to 15 pages. Only extracted text is stored in Supabase, not the original file. Use fictional documents.</p></div>
                </div>
                <form onSubmit={uploadDocument} className="flex flex-wrap gap-3 items-center">
                  <input id="intrigue-document-file" aria-label="Choose a document to upload" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" onChange={e=>setDocumentFile(e.target.files?.[0]||null)} className="block min-w-0 max-w-full flex-1 rounded-xl border border-[#35485d] bg-[#182c41] px-3 py-2 text-xs text-[#d5dfeb]"/>
                  <button className={newButtonClass} type="submit" disabled={!documentFile||!workspace||documentBusy}>{documentBusy?"Reading & saving...":"Upload document"}</button>
                </form>
                {documentError && <p role="alert" className="mt-3 text-xs text-[#ffb3a7]">{documentError}</p>}
                {documentSuccess && <p role="status" className="mt-3 text-xs text-[#b1ead0]">{documentSuccess}</p>}
                {documents.length>0 && <div className="mt-5 space-y-2">
                  {documents.map(d=><div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#35485d] bg-[#0d2032] px-4 py-3">
                    <div className="min-w-0"><p className="break-all text-xs font-semibold text-[#f5f0e8]">{d.filename}</p><p className="mt-1 text-[11px] text-[#afbdcb]">{d.file_type.toUpperCase()} Â· {d.page_count} page(s) Â· {d.characters.toLocaleString()} characters Â· {niceDate(d.created_at)}</p></div>
                    <button type="button" title="Delete document" aria-label={`Delete ${d.filename}`} disabled={documentBusy} className="rounded-lg border border-[#6b5253] px-3 py-2 text-xs text-[#f3c2b9] hover:bg-[#302a35]" onClick={()=>void deleteDocument(d.id)}><Trash2 size={14}/></button>
                  </div>)}
                  <button type="button" onClick={()=>void askQuestion("What do our uploaded documents say? List their filenames and summarize their main points.")} className="mt-2 rounded-xl border border-[#937b48] px-4 py-2.5 text-xs font-semibold text-[#e1c178] hover:bg-[#263447]">Ask AI about uploaded documents</button>
                </div>}
                {documents.length===0 && <p className="mt-3 text-xs text-[#afbdcb]">No uploaded documents yet.</p>}
              </section>}
              {!isOwner && <section className="rounded-2xl border border-[#35485d] bg-[#142539] p-6">
                <h3 className="text-sm font-semibold">Company documents (read-only)</h3>
                {documents.length===0 ? <p className="mt-2 text-xs text-[#afbdcb]">No company documents yet.</p> :
                  <div className="mt-3 space-y-2">{documents.map(d=><div key={d.id} className="rounded-lg border border-[#35485d] p-3 text-xs text-[#d5dfeb]">{d.filename} Â· {d.page_count} page(s)</div>)}</div>}
              </section>}
              {isOwner && <div className="mt-4 rounded-2xl border border-[#9c8046]/60 bg-[#1b2b40] px-5 py-4">
                <h3 className="text-sm font-semibold text-[#e4c47b]">Semantic Search Â· V7</h3>
                <p className="mt-2 max-w-2xl text-xs leading-5 text-[#d0d8df]">Search the meaning of your documents, even when your question uses different words. Click to index your existing uploads and notes, up to 12 sections per click. This calls a paid OpenRouter embeddings model, so very small usage charges may apply. If you haven't added credit, existing keyword search will continue working.</p>
                <button type="button" disabled={!workspace || semanticBusy} onClick={()=>void buildSemanticIndex()} className="mt-3 rounded-xl bg-[#c9a552] px-4 py-2.5 text-xs font-semibold text-[#111b29] hover:bg-[#e4c47b] disabled:opacity-50">{semanticBusy?"Indexing...":"Build semantic index"}</button>
                {semanticStatus && <p role="status" className="mt-3 text-xs text-[#e8d8b4]">{semanticStatus}</p>}
              </div>}
              {knowledgeError && <div role="alert" className="rounded-xl border border-[#a97955] bg-[#3d2a2e] px-4 py-3 text-xs leading-5 text-[#fff0da]">{knowledgeError}</div>}
              {isOwner && showKnowledgeForm && (
                <form onSubmit={addKnowledge} className="space-y-3 rounded-2xl border border-[#35485d] bg-[#142539] p-6">
                  <h3 className="text-sm font-semibold">New knowledge entry</h3>
                  <div className="grid gap-3 md:grid-cols-[1fr_180px]">
                    <input className={inputClass} aria-label="Knowledge title" placeholder="e.g. Brake inspection policy" value={knowledgeForm.title} maxLength={120} required minLength={3} onChange={e => setKnowledgeForm({...knowledgeForm, title:e.target.value})}/>
                    <select className={inputClass} aria-label="Knowledge category" value={knowledgeForm.category} onChange={e => setKnowledgeForm({...knowledgeForm, category:e.target.value})}>
                      {['Policy','Service','FAQ','Supplier'].map(category=><option key={category} value={category}>{category}</option>)}
                    </select>
                  </div>
                  <textarea className={`${inputClass} min-h-[150px] resize-y`} aria-label="Knowledge content" placeholder="Paste a fictional service policy, opening hours or a FAQ answer..." required minLength={10} maxLength={4000} value={knowledgeForm.content} onChange={e => setKnowledgeForm({...knowledgeForm, content:e.target.value})}/>
                  <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-[#afbdcb]">{knowledgeForm.content.length}/4000 characters. Use demo data only.</span><button type="submit" disabled={knowledgeBusy || !workspace} className={newButtonClass}>{knowledgeBusy ? 'Saving...' : 'Save knowledge'}</button></div>
                </form>
              )}
              {knowledgeLoading && <p className="rounded-xl border border-[#35485d] p-5 text-xs text-[#afbdcb]">Loading saved knowledge...</p>}
              {!knowledgeLoading && !knowledgeError && knowledgeEntries.length===0 && <div className="rounded-2xl border border-dashed border-[#45576a] bg-[#0f2032] px-6 py-10 text-center"><h3 className="text-sm font-semibold">No knowledge entries yet</h3><p className="mt-2 text-xs text-[#afbdcb]">Add a fictional company policy and ask the AI a question about it.</p></div>}
              <div className="grid gap-3 md:grid-cols-2">
                {knowledgeEntries.map(entry => <article key={entry.id} className="rounded-2xl border border-[#35485d] bg-[#142539] p-5">
                  <div className="mb-3 flex items-start justify-between gap-3"><Tag variant="blue">{entry.category}</Tag><span className="text-[11px] text-[#afbdcb]">{niceDate(entry.created_at)}</span></div>
                  <h3 className="text-sm font-bold text-[#f5f0e8]">{entry.title}</h3>
                  <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-[#bec9d2]">{entry.content}</p>
                  {isOwner && <button type="button" className="mt-5 rounded-lg border border-[#6b5253] px-3 py-2 text-xs text-[#f3c2b9] hover:bg-[#302a35] disabled:opacity-50" disabled={knowledgeBusy} onClick={() => void deleteKnowledge(entry.id)}>Delete entry</button>}
                </article>)}
              </div>
              {isOwner && knowledgeEntries.length>0 && <button type="button" className="rounded-xl border border-[#937b48] px-4 py-2.5 text-xs font-semibold text-[#e1c178] hover:bg-[#263447]" onClick={()=>void askQuestion('Summarize the company policies and services in our knowledge base.')}>Ask AI about these entries</button>}
            </div>
          )}

          {section === "Calendar" && workspace && isOwner && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-[#35485d] bg-[#142539] p-5">
                <h2 className="text-lg font-semibold text-[#f4efe5]">Calendar & booking</h2>
                <p className="mt-2 text-sm text-[#b8c7d4]">Review upcoming appointments, working hours and the booking connections for this company. Provider authorization remains owner-controlled.</p>
              </div>
              <CalendarConnections />
            </div>
          )}
          {section === "Integrations" && workspace && isOwner && <IntegrationsPanel workspaceId={workspace.id} onImported={() => { void refresh(); }} onOpenCalendar={() => navigate("Calendar")} onOpenReceptionist={() => navigate("AI Receptionist")} />}

          {section === "Plans & Billing" && isOwner && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-[#a18343]/55 bg-[#142539] p-6 md:p-8">
                <div className="mb-4 flex items-center gap-3"><CreditCard size={23} className="text-[#e0bf76]"/><h2 className="text-lg font-bold">Plans & Billing Â· Private Preview</h2></div>
                <p className="max-w-3xl text-sm leading-6 text-[#c6d2df]">Explore possible launch tiers and register your company's interest. This preview does not collect payment information, create subscriptions, process invoices, or change your current access or AI request limits.</p>
                <div className="mt-5 flex flex-wrap gap-2"><Tag variant="amber">No charges enabled</Tag><Tag variant="slate">No plans activated</Tag><Tag variant="blue">Company owner only</Tag></div>
                {planLoading && <p role="status" className="mt-4 text-xs text-[#bbcbd8]">Loading your plan interestâ€¦</p>}
                {planInterest && <p className="mt-5 text-sm text-[#b3ead0]">Interest on file: <strong className="capitalize">{planInterest.requested_tier}</strong> Â· Submitted {niceDate(planInterest.requested_at)}. You can update your interest below.</p>}
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                {PLAN_PREVIEWS.map(plan => <article key={plan.tier} className="flex flex-col rounded-2xl border border-[#3f5064] bg-[#142539] p-6">
                  <div className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-[#c8a65f]">{plan.audience}</div>
                  <h3 className="brand-display text-3xl">{plan.name}</h3>
                  <p className="mt-3 flex-1 text-sm leading-6 text-[#abbccd]">{plan.details}</p>
                  <p className="my-5 border-t border-[#37485b] pt-4 text-xs text-[#d0bc8f]">Pricing by proposal Â· Not yet available for purchase</p>
                  <button type="button" disabled={planSaving || planLoading || !workspace} onClick={()=>void savePlanInterest(plan.tier)} className={`${newButtonClass} w-full`}>{planSaving?"Savingâ€¦":planInterest?.requested_tier===plan.tier?"Update interest":"Register interest"}</button>
                </article>)}
              </div>
              {planError && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-[#ffc2b9]">{planError}</p>}
              {planSuccess && <p role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-[#b3ead0]">{planSuccess}</p>}
              <div className="rounded-xl border border-[#46576a] bg-[#102234] p-5 text-sm leading-6 text-[#aebfcf]">
                <strong className="text-[#f0d18e]">What this does not do:</strong> Your selection is an expression of interest only. No billing integration, payment provider, invoices, subscription benefits, AI quota changes, or company-wide usage enforcement are activated.
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#46576a] bg-[#142539] p-5">
                <div><h3 className="text-sm font-semibold">Request a guided pilot evaluation</h3><p className="mt-2 text-xs leading-5 text-[#aebfcf]">Define your business goal and success criteria for manual review. No automatic trial or subscription.</p></div>
                <button type="button" className={newButtonClass} onClick={()=>navigate("Pilot Application")}>Open pilot application â†’</button>
              </div>
              {aiUsage && <p className="text-xs text-[#aebfcf]">AI requests today for this company's owner account: <strong className="text-[#e7c37c]">{aiUsage.chat_today} / {aiUsage.chat_day_limit}</strong>. The limit remains per owner account, not pooled across staff.</p>}
            </div>
          )}

          {section === "Pilot Application" && isOwner && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-[#a18343]/50 bg-[#142539] p-6 md:p-8">
                <div className="mb-3 flex items-center gap-3"><ClipboardCheck className="text-[#e0bf76]" size={24}/><h2 className="text-lg font-bold">Apply for a guided pilot</h2></div>
                <p className="max-w-3xl text-sm leading-6 text-[#b7c7d5]">Tell INTRIGUE STUDIOS what you want to evaluate. A submitted request is for discussion only. It does not activate payments, extend AI quotas, enable automation workers or authorize production customer data.</p>
                <div className="mt-4 flex flex-wrap gap-2"><Tag variant="amber">Private preview</Tag><Tag variant="blue">Owner only</Tag><Tag variant="slate">Manual review</Tag></div>
                <div className="mt-5 grid gap-3 text-xs md:grid-cols-3">
                  <div className="rounded-xl border border-[#46586a] bg-[#0e2235] p-3"><strong className="text-[#e7c37c]">1 Â· Submitted</strong><p className="mt-1 text-[#b7c7d5]">Your request is stored privately for operator review.</p></div>
                  <div className="rounded-xl border border-[#46586a] bg-[#0e2235] p-3"><strong className="text-[#e7c37c]">2 Â· Contacted</strong><p className="mt-1 text-[#b7c7d5]">An operator has marked the request for follow-up, not activated service.</p></div>
                  <div className="rounded-xl border border-[#46586a] bg-[#0e2235] p-3"><strong className="text-[#e7c37c]">3 Â· Closed</strong><p className="mt-1 text-[#b7c7d5]">The review is complete; no billing or trial is started.</p></div>
                </div>
                {pilotRequest && <div className="mt-5 rounded-xl border border-[#40566a] bg-[#102234] p-4 text-sm">
                  <p>Current request: <strong className="capitalize text-[#efcd85]">{pilotRequest.status.replaceAll("_"," ")}</strong> Â· First submitted {niceDate(pilotRequest.submitted_at)}</p>
                  {pilotRequest.reviewed_at && <p className="mt-2 text-xs text-[#b7c7d5]">Latest operator review: {niceDate(pilotRequest.reviewed_at)}</p>}
                  {pilotRequest.review_message && <div className="mt-3 rounded-lg border border-[#6f6250]/60 bg-[#152d3e] p-3 text-sm text-[#f5dfb2]">
                    <strong className="mb-1 block text-xs uppercase tracking-widest text-[#dfbf7b]">Message from INTRIGUE STUDIOS</strong>
                    <p className="whitespace-pre-wrap break-words">{pilotRequest.review_message}</p>
                  </div>}
                  <p className="mt-3 text-xs text-[#b7c7d5]">An operator sets this status manually. Neither â€œcontactedâ€ nor â€œclosedâ€ activates a trial, subscription, payment, or higher AI limits.</p>
                  <button type="button" onClick={()=>void loadPilotRequest()} disabled={pilotLoading} className="mt-3 rounded-lg border border-[#997b45] px-4 py-2 text-xs font-semibold text-[#e7c37c] disabled:opacity-50">{pilotLoading?"Refreshingâ€¦":"Refresh application status"}</button>
                </div>}
              </div>
              <form onSubmit={submitPilotRequest} className="rounded-2xl border border-[#35485d] bg-[#142539] p-6 md:p-8">
                <h3 className="mb-5 text-sm font-semibold">Your evaluation request</h3>
                <fieldset disabled={pilotSaving || pilotLoading || (!!pilotRequest && pilotRequest.status!=="submitted")} className="grid gap-4 md:grid-cols-2 disabled:opacity-65">
                  <label className="text-xs font-medium text-[#e6c17b]">Contact name
                    <input required minLength={2} maxLength={100} autoComplete="name" className={`${inputClass} mt-2`} value={pilotForm.contact_name} onChange={e=>setPilotForm(v=>({...v,contact_name:e.target.value}))}/>
                  </label>
                  <label className="text-xs font-medium text-[#e6c17b]">Business contact email
                    <input required type="email" maxLength={254} autoComplete="email" className={`${inputClass} mt-2`} value={pilotForm.contact_email} onChange={e=>setPilotForm(v=>({...v,contact_email:e.target.value}))}/>
                  </label>
                  <label className="text-xs font-medium text-[#e6c17b]">Expected team size
                    <input required type="number" min={1} max={1000} step={1} className={`${inputClass} mt-2`} value={pilotForm.estimated_seats} onChange={e=>setPilotForm(v=>({...v,estimated_seats:Number(e.target.value)}))}/>
                  </label>
                  <label className="text-xs font-medium text-[#e6c17b]">Preferred start date (optional)
                    <input type="date" className={`${inputClass} mt-2`} value={pilotForm.preferred_start} onChange={e=>setPilotForm(v=>({...v,preferred_start:e.target.value}))}/>
                  </label>
                  <label className="text-xs font-medium text-[#e6c17b] md:col-span-2">What would you like to automate or improve?
                    <textarea required minLength={20} maxLength={1200} rows={4} className={`${inputClass} mt-2 resize-y`} placeholder="Describe a fictional or non-sensitive example workflowâ€¦" value={pilotForm.intended_use} onChange={e=>setPilotForm(v=>({...v,intended_use:e.target.value}))}/>
                  </label>
                  <label className="text-xs font-medium text-[#e6c17b] md:col-span-2">How would you measure success?
                    <textarea required minLength={10} maxLength={800} rows={3} className={`${inputClass} mt-2 resize-y`} placeholder="For example: reduce manual follow-up work during a controlled demoâ€¦" value={pilotForm.success_criteria} onChange={e=>setPilotForm(v=>({...v,success_criteria:e.target.value}))}/>
                  </label>
                  <label className="text-xs font-medium text-[#e6c17b] md:col-span-2">Additional notes (optional)
                    <textarea maxLength={500} rows={2} className={`${inputClass} mt-2 resize-y`} value={pilotForm.request_notes} onChange={e=>setPilotForm(v=>({...v,request_notes:e.target.value}))}/>
                  </label>
                </fieldset>
                {pilotError && <p role="alert" className="mt-4 rounded-lg border border-red-400/40 p-3 text-xs text-[#ffb3a7]">{pilotError}</p>}
                {pilotSuccess && <p role="status" className="mt-4 rounded-lg border border-emerald-400/30 p-3 text-xs text-[#b3ead0]">{pilotSuccess}</p>}
                {pilotLoading && <p role="status" className="mt-4 text-xs text-[#b7c7d5]">Loading your requestâ€¦</p>}
                {pilotRequest && pilotRequest.status!=="submitted" && <p className="mt-4 text-xs text-[#e7c37c]">This request is already in review or closed; contact INTRIGUE STUDIOS to make changes.</p>}
                <button type="submit" disabled={pilotSaving || pilotLoading || (!!pilotRequest && pilotRequest.status!=="submitted")} className={`${newButtonClass} mt-5`}>{pilotSaving?"Savingâ€¦":pilotRequest?"Update submitted request":"Submit pilot request"}</button>
                <p className="mt-4 text-xs leading-5 text-[#b7c7d5]">For staging, use fictional use cases only. This form does not send an email automatically or start a pilot.</p>
              </form>
            </div>
          )}

          {section === "Security & Usage" && isOwner && <div className="space-y-5">
            <div className="rounded-2xl border border-[#997b45]/50 bg-[#142539] p-6 md:p-8">
              <div className="flex items-center gap-3"><ShieldCheck size={24} className="text-[#e1bd72]"/><h2 className="text-lg font-bold">AI usage and safeguards</h2></div>
              <p className="mt-3 text-sm leading-6 text-[#b7c7d5]">These are request allowances for the signed-in owner, not billing amounts or model-token costs. All limits are enforced atomically by Supabase before contacting the AI provider.</p>
              <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={()=>void loadAiUsage()} disabled={usageBusy} className="rounded-lg border border-[#967b48] px-4 py-2 text-xs font-semibold text-[#e7c37c] disabled:opacity-50">{usageBusy?"Refreshingâ€¦":"Refresh usage"}</button><Tag variant="amber">Staging Â· No real client data</Tag></div>
              {usageError && <p role="alert" className="mt-4 rounded-xl border border-red-400/40 p-4 text-xs text-[#ffc2b9]">{usageError}</p>}
              {aiUsage && <><div className="mt-6 grid gap-4 sm:grid-cols-2">
                {[
                  {name:"Chat requests today",value:aiUsage.chat_today,limit:aiUsage.chat_day_limit},
                  {name:"Chat requests this minute",value:aiUsage.chat_this_minute,limit:aiUsage.chat_minute_limit},
                  {name:"Indexing requests today",value:aiUsage.index_today,limit:aiUsage.index_day_limit},
                  {name:"Indexing requests this minute",value:aiUsage.index_this_minute,limit:aiUsage.index_minute_limit},
                ].map(item=><div key={item.name} className="rounded-xl border border-[#35485d] bg-[#0d1f31] p-5">
                  <p className="text-xs text-[#bac9d7]">{item.name}</p>
                  <p className="mt-2 text-2xl font-semibold text-[#f3d18e]">{item.value} <span className="text-sm font-normal text-[#aebdcb]">/ {item.limit}</span></p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#34485c]"><div className="h-full bg-[#d2ae65]" style={{width:`${Math.min(100,Math.max(0,(item.value/Math.max(1,item.limit))*100))}%`}}/></div>
                </div>)}
              </div><p className="mt-4 text-xs text-[#bdc8d4]">Daily limits reset at {aiUsage.reset_utc} UTC. This screen never allows staff to reset or edit counters.</p></>}
            </div>
            <div className="rounded-2xl border border-[#35485d] bg-[#142539] p-6">
              <h3 className="text-sm font-bold">Launch security gates</h3>
              <div className="mt-4 space-y-3 text-xs leading-6 text-[#bccbd9]">
                <p>â€¢ Database RLS and Owner/Admin/Staff/Viewer permissions: configuration and interface tests completed in V14.2.</p>
                <p>â€¢ Cross-company denied reads and writes: use the V14.3 transaction rollback test from the upgrade ZIP.</p>
                <p>â€¢ Quota rejection: use the no-provider-call rollback test. A displayed usage counter alone does not prove rejection.</p>
                <p>â€¢ Production: confirm data retention, backups, provider processing agreements and real API-session authorization before accepting client data.</p>
              </div>
            </div>
          </div>}

          {section === "Settings" && <div className="space-y-5">
            <div className="rounded-2xl border border-[#35485d] bg-[#142539] p-7 shadow-sm">
              <div className="flex items-center gap-3"><Settings className="text-[#e0bf76]" size={22}/><h2 className="text-lg font-bold">Company & assistant setup</h2></div>
              <p className="mt-2 text-sm text-[#afbdcb]">Configure your business identity, service hours and AI preferences. All data stays in your workspace.</p>
              <div className="mt-4 text-xs text-[#b3ead0]">Workspace: {workspace.name} Â· Your access: {role}</div>
              {!isOwner ? <p className="mt-5 rounded-xl border border-[#526076] p-4 text-sm text-[#afbdcb]">Team members have read-only access. Ask the company owner to change these settings.</p> :
              <form onSubmit={saveSettings} className="mt-6 space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-xs text-[#e7c37c]">Company name<input className={`${inputClass} mt-2`} value={companyEditName} maxLength={100} minLength={2} required onChange={e=>setCompanyEditName(e.target.value)}/></label>
                  <label className="text-xs text-[#e7c37c]">Industry<select className={`${inputClass} mt-2`} value={settings.industry} onChange={e=>setSettings({...settings,industry:e.target.value})}>{["Automotive","Real Estate","Retail","Hospitality","Healthcare","Professional Services","Technology","Logistics","Other"].map(x=><option key={x}>{x}</option>)}</select></label>
                  <label className="text-xs text-[#e7c37c]">Business email<input className={`${inputClass} mt-2`} type="email" maxLength={254} value={settings.contact_email} onChange={e=>setSettings({...settings,contact_email:e.target.value})}/></label>
                  <label className="text-xs text-[#e7c37c]">Telephone<input className={`${inputClass} mt-2`} maxLength={60} value={settings.phone} onChange={e=>setSettings({...settings,phone:e.target.value})}/></label>
                  <label className="text-xs text-[#e7c37c]">Website<input className={`${inputClass} mt-2`} maxLength={255} placeholder="https://example.com" value={settings.website} onChange={e=>setSettings({...settings,website:e.target.value})}/></label>
                  <label className="text-xs text-[#e7c37c]">Business timezone<select className={`${inputClass} mt-2`} value={settings.timezone} onChange={e=>setSettings({...settings,timezone:e.target.value})}>{["Europe/Berlin","Europe/London","Africa/Nairobi","America/New_York","America/Los_Angeles","UTC"].map(x=><option key={x}>{x}</option>)}</select></label>
                  <label className="text-xs text-[#e7c37c]">Currency<select className={`${inputClass} mt-2`} value={settings.currency} onChange={e=>setSettings({...settings,currency:e.target.value})}>{["EUR","USD","GBP","KES"].map(x=><option key={x}>{x}</option>)}</select></label>
                  <label className="text-xs text-[#e7c37c]">Business hours<input className={`${inputClass} mt-2`} maxLength={350} placeholder="Monâ€“Fri 09:00â€“18:00" value={settings.business_hours} onChange={e=>setSettings({...settings,business_hours:e.target.value})}/></label>
                </div>
                <label className="block text-xs text-[#e7c37c]">What does your company do?<textarea className={`${inputClass} mt-2 min-h-24`} maxLength={1000} value={settings.description} onChange={e=>setSettings({...settings,description:e.target.value})}/></label>
                <div className="border-t border-[#35485d] pt-5">
                  <h3 className="flex items-center gap-2 text-base font-bold"><Bot size={18} className="text-[#d9bd7d]"/>AI Assistant configuration</h3>
                  <p className="mt-1 text-xs text-[#afbdcb]">These preferences are included in the owner AI agent's system context. Security limits, tool permissions and human approval are unchanged.</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="text-xs text-[#e7c37c]">Assistant name<input className={`${inputClass} mt-2`} minLength={2} maxLength={80} value={settings.ai_name} onChange={e=>setSettings({...settings,ai_name:e.target.value})}/></label>
                    <label className="text-xs text-[#e7c37c]">Communication style<select className={`${inputClass} mt-2`} value={settings.ai_tone} onChange={e=>setSettings({...settings,ai_tone:e.target.value})}>{["Professional","Friendly","Concise","Formal"].map(x=><option key={x}>{x}</option>)}</select></label>
                    <label className="text-xs text-[#e7c37c] sm:col-span-2">Business role<input className={`${inputClass} mt-2`} maxLength={160} minLength={4} value={settings.ai_role} onChange={e=>setSettings({...settings,ai_role:e.target.value})}/></label>
                  </div>
                  <label className="mt-4 block text-xs text-[#e7c37c]">Additional assistant guidance<textarea className={`${inputClass} mt-2 min-h-24`} maxLength={1000} placeholder="Preferred terminology and response style. Do not include secrets or private customer information." value={settings.ai_guidance} onChange={e=>setSettings({...settings,ai_guidance:e.target.value})}/></label>
                </div>
                {settingsError && <p role="alert" className="text-xs text-[#ffb3a7]">{settingsError}</p>}
                {settingsMessage && <p role="status" className="text-xs text-[#b1ead0]">{settingsMessage}</p>}
                <button type="submit" disabled={settingsBusy} className={newButtonClass}>{settingsBusy?"Saving...":"Save company & AI settings"}</button>
              </form>}
            </div>
            <div className="rounded-2xl border border-[#35485d] bg-[#142539] p-6">
              <h3 className="text-base font-semibold">Onboarding checklist</h3>
              <p className="mt-1 text-xs text-[#afbdcb]">Follow these steps before activating client-facing workflows.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  ["Create company",true],["Configure business profile",Boolean(settings.description.trim()&&settings.business_hours.trim())],
                  ["Add services and pricing",services.length>0],["Add company knowledge",knowledgeEntries.length>0||documents.length>0],["Review AI preferences",Boolean(settings.ai_role.trim())],
                  ["Invite staff (optional)",teamMembers.length>1],["Pass production security tests",false],
                ].map(([label,done])=><div key={String(label)} className="flex items-center gap-2 rounded-lg border border-[#35485d] p-3 text-xs"><CheckCircle2 size={16} className={done?"text-[#b3ead0]":"text-[#708093]"}/>{label}</div>)}
              </div>
              <button type="button" onClick={()=>navigate("Get Started")} className="mt-4 rounded-lg border border-[#937b48] px-3 py-2 text-xs text-[#e7c37c]">Open guided setup</button>
            </div>
          </div>}

          {section === "Team" && <div className="space-y-5">
            <div className="rounded-2xl border border-[#35485d] bg-[#142539] p-7">
              <div className="flex items-center gap-3"><UserPlus className="text-[#e0bf76]" size={22}/><h2 className="text-lg font-bold">Team members</h2></div>
              <p className="mt-2 text-sm leading-6 text-[#afbdcb]">Invite colleagues as Admin, Staff or Viewer. Admins manage services; Staff can add enquiries and follow-ups; Viewers only read. AI, actions, settings and invitations remain owner-only.</p>
              {!isOwner ? <p className="mt-5 text-sm text-[#b3ead0]">Your role is {role}. Only the workspace owner manages invitations and roles.</p> : <>
                <form onSubmit={createInvite} className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <input className={inputClass} type="email" placeholder="colleague@company.com" aria-label="Team member email" required maxLength={254} value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)}/>
                  <select className={`${inputClass} sm:max-w-40`} aria-label="Invitation role" value={selectedInviteRole} onChange={e=>setSelectedInviteRole(e.target.value as "admin"|"staff"|"viewer")}><option value="viewer">Viewer</option><option value="staff">Staff</option><option value="admin">Admin</option></select>
                  <button className={newButtonClass} type="submit" disabled={teamBusy}>{teamBusy?"Creating...":"Create invitation link"}</button>
                </form>
                {inviteLink && <div className="mt-4 rounded-xl border border-[#937b48] bg-[#17293d] p-4">
                  <p className="mb-2 text-xs font-semibold text-[#e7c37c]">Copy this link now. It is shown only once.</p>
                  <p className="break-all text-xs text-[#d5dfeb]">{inviteLink}</p>
                  <button type="button" onClick={()=>void navigator.clipboard.writeText(inviteLink)} className="mt-3 rounded-lg bg-[#c9a552] px-3 py-2 text-xs font-semibold text-[#111b29]">Copy invitation</button>
                  <p className="mt-2 text-[11px] text-[#afbdcb]">Share it only with the invited person. They must verify the exact invited email, sign in, then open this link and accept.</p>
                </div>}
                {teamError && <p role="alert" className="mt-4 text-sm text-[#ffb3a7]">{teamError}</p>}
                {teamMessage && <p role="status" className="mt-4 text-xs text-[#b3ead0]">{teamMessage}</p>}
                <h3 className="mt-7 text-sm font-bold">Active members</h3>
                <div className="mt-3 space-y-2">{teamMembers.map(m=><div key={m.member_user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#35485d] bg-[#102034] p-4">
                  <div><p className="text-sm font-semibold">{m.email}</p><p className="mt-1 text-xs text-[#afbdcb]">{m.role} Â· Joined {niceDate(m.joined_at)}</p></div>
                  {m.role!=="owner" && <div className="flex items-center gap-2"><select aria-label={`Role for ${m.email}`} disabled={teamBusy} className="rounded-lg border border-[#526076] bg-[#182c41] px-2 py-2 text-xs" value={m.role==="member"?"viewer":m.role} onChange={e=>void updateTeamRole(m.member_user_id,e.target.value as "admin"|"staff"|"viewer")}><option value="viewer">Viewer</option><option value="staff">Staff</option><option value="admin">Admin</option></select><button type="button" disabled={teamBusy} onClick={()=>void removeMember(m.member_user_id)} className="rounded-lg border border-[#795557] px-3 py-2 text-xs text-[#f3c2b9]">Remove access</button></div>}
                </div>)}</div>
                <h3 className="mt-7 text-sm font-bold">Pending invitations</h3>
                {teamInvites.length===0 && <p className="mt-3 text-xs text-[#afbdcb]">No pending invitations.</p>}
                <div className="mt-3 space-y-2">{teamInvites.map(i=><div key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#35485d] bg-[#102034] p-4">
                  <div><p className="text-sm font-semibold">{i.invited_email}</p><p className="mt-1 text-xs text-[#afbdcb]">{i.role} Â· Expires {niceDate(i.expires_at)}</p></div>
                  <button type="button" disabled={teamBusy} onClick={()=>void revokeInvite(i.id)} className="rounded-lg border border-[#795557] px-3 py-2 text-xs text-[#f3c2b9]">Revoke</button>
                </div>)}</div>
                <div className="mt-8 rounded-xl border border-[#35485d] bg-[#102034] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-[#f3d18e]">Membership activity</h3>
                    <button type="button" onClick={()=>void loadTeamAudit()} className="rounded-lg border border-[#937b48] px-3 py-2 text-xs text-[#e7c37c]">Refresh history</button>
                  </div>
                  <p className="mt-2 text-xs text-[#afbdcb]">Owner-only audit trail. Events start after installing V14.4.</p>
                  {teamAuditError && <p role="alert" className="mt-3 text-xs text-[#ffb3a7]">{teamAuditError}</p>}
                  {!teamAuditError && teamAudit.length===0 && <p className="mt-4 text-xs text-[#afbdcb]">No membership changes recorded yet.</p>}
                  <div className="mt-3 space-y-2">{teamAudit.map((event,i)=><div key={`${event.event_at}-${i}`} className="rounded-lg border border-[#35485d] p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2"><strong>{event.event_type==="role_changed"?"Role changed":event.event_type==="removed"?"Access removed":"Member joined"}</strong><span className="text-[#afbdcb]">{new Date(event.event_at).toLocaleString()}</span></div>
                    <p className="mt-1 break-all">{event.member_email}{event.old_role||event.new_role?` Â· ${event.old_role||"none"} â†’ ${event.new_role||"none"}`:""}</p>
                    <p className="mt-1 break-all text-[#afbdcb]">By: {event.actor_email}</p>
                  </div>)}</div>
                </div>
              </>}
            </div>
          </div>}

          </>}

          <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#9eacba]"><span>Â© 2026 INTRIGUE STUDIOS Â· Engineered intelligence</span><span>Demo records in Supabase â€¢ Chat read-only â€¢ Approved drafts only</span></footer>
        </main>
      </div>
    </div>
  );
}

