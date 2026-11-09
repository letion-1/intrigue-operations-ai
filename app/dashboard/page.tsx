"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import "./brand.css";
import "./intrigue-themes.css";
import "./rc22-startup.css";
import "./client-shell.css";
import CustomersCRMPanel from "./crm/CustomersCRMPanel";
import QuotationsStudio from "./quotations/QuotationsStudio";
import IndustryIcon, { isAutomotiveIndustry } from "./crm/IndustryIcon";
import "./intrigue-logout.css";
import { LogOut } from "lucide-react";
import AccountDeletionPanel from "./account/AccountDeletionPanel";
import "./knowledge-hub.css";
import IntegrationsPanel from "./integrations-panel";
import CalendarConnections from "./calendar-connections";
import ReceptionistPanel from "./ai-receptionist/ReceptionistPanel";
import DataManagementPanel from "./data-management/DataManagementPanel";
import AutomationCentreV2 from "./automation/AutomationCentreV2";
import CompanyOnboarding from "./company-onboarding/CompanyOnboarding";
import { uiText, availableUiLocale, uiDirection, ASSISTANT_INTRO } from "@/lib/intrigue-ui-language";
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
  currency: string; preferred_language: string; ai_name: string; ai_tone: string; ai_role: string; ai_guidance: string;
};
const COMPANY_LANGUAGES = [
  ['en','English'],['de','Deutsch (German)'],['fr','Français (French)'],
  ['es','Español (Spanish)'],['pt','Português (Portuguese)'],['it','Italiano (Italian)'],
  ['nl','Nederlands (Dutch)'],['sw','Kiswahili (Swahili)'],['ar','العربية (Arabic)'],
  ['tr','Türkçe (Turkish)'],['pl','Polski (Polish)'],['hi','हिन्दी (Hindi)'],
  ['zh','中文 (Chinese)'],['ja','日本語 (Japanese)'],['ko','한국어 (Korean)'],
  ['ru','Русский (Russian)'],
] as const;
const EMPTY_SETTINGS: Omit<CompanySettings, "workspace_id"> = {
  industry: "Other", description: "", contact_email: "", phone: "", website: "",
  business_hours: "", timezone: "Europe/Berlin", currency: "EUR", preferred_language: "en",
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
const OWNER_ONLY_SECTIONS: Section[] = ["AI Assistant","AI Receptionist","Automation Center","Integrations","Calendar","Data Management","Security & Usage","Plans & Billing","Pilot Application"];

type Customer = { id: string; full_name: string; email: string | null; phone: string | null; vehicle: string | null; created_at: string; updated_at: string };
type Enquiry = { id: string; customer_id: string; subject: string; status: string; created_at: string; updated_at: string };
type Quote = { id: string; customer_id: string; description: string; amount: number; status: string; created_at: string; updated_at: string; quote_note?: string | null; currency?: string | null };
type FollowUp = { id: string; customer_id: string; title: string; due_at: string; status: string; priority: string; updated_at: string; source_enquiry_id?: string | null; source_intent?: string | null; assigned_to?: string | null };
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
      <div className="mb-1 text-xs font-semibold text-[#d9bd7d]">Draft quotation  |  Price locked to source</div>
      <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{p.quote_description}</span><strong>{money(Number(p.quote_amount))}</strong></div>
      <p className="mt-2 text-[11px] text-[#aebdcb]">Source: {p.quote_source}</p>
    </div>}
    {p.follow_up_title && <div className="mb-3 rounded-xl border border-[#394b5f] bg-[#0d1e30] p-4">
      <div className="flex items-center justify-between gap-2"><div className="text-xs font-semibold text-[#d9bd7d]">Follow-up task</div>
      {p.status==="pending" && <button type="button" disabled={busy} onClick={()=>setEditing(!editing)} className="inline-flex items-center gap-1 text-xs text-[#e9c577] hover:underline"><Pencil size={13}/>{editing?"Cancel edit":"Edit task"}</button>}</div>
      {!editing ? <><div className="mt-2 text-sm">{p.follow_up_title}</div><p className="mt-2 text-[11px] text-[#aebdcb]">Due {niceDate(p.follow_up_due_at || "")}  |  Normal priority</p></>:
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
  const [gmailOauthNotice, setGmailOauthNotice] = useState<string>("");
  const [highlightEnquiryId, setHighlightEnquiryId] = useState<string | null>(null);
  const [guideStep,setGuideStep]=useState<number|null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [appearance, setAppearance] = useState<"dark" | "light">("light");
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [workspaceResolvedOnce, setWorkspaceResolvedOnce] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("intrigue-appearance-v1");
      if (stored === "dark" || stored === "light") setAppearance(stored);
    } catch { /* Storage can be disabled in private browsing. */ }
    // Never render the full dashboard under an incorrect temporary theme.
    setAppearanceReady(true);
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
    { role: "assistant", text: "Welcome to INTRIGUE Operations AI. I can answer questions using records from your signed-in company workspace. I can prepare draft actions for your approval. Nothing is saved to quotations or tasks without your approval, and I never contact customers." },
  ]);


  // Authenticated Supabase browser client. Authorization is also enforced in Postgres RLS.
  const supabase = useMemo(() => createClient(), []);
  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      window.location.replace("/auth/login");
    } catch (err) {
      window.alert(`Unable to log out: ${err instanceof Error ? err.message : String(err)}`);
      setSigningOut(false);
    }
  };

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [role, setRole] = useState<MemberRole>("owner");
  const isOwner = role === "owner";
  const canManageCatalog = role === "owner" || role === "admin";
  const canWriteOps = canManageCatalog || role === "staff";
  const [settings, setSettings] = useState<Omit<CompanySettings,"workspace_id">>(EMPTY_SETTINGS);
  const [savedUiLocale, setSavedUiLocale] = useState<string>('en');
  const [settingsReadyId, setSettingsReadyId] = useState<string|null>(null);
  const locale = availableUiLocale(savedUiLocale);
  const t = (text:string) => uiText(locale,text);
  useEffect(()=>{document.documentElement.lang=locale;document.documentElement.dir=uiDirection(locale);},[locale]);
  useEffect(() => {
    // This effect must appear AFTER locale is declared: TypeScript cannot read
    // a block-scoped value before it is initialized.
    // Only update the untouched initial greeting; do not rewrite conversations.
    setMessages(previous => {
      if (previous.length !== 1 || previous[0].role !== 'assistant') return previous;
      const text = previous[0].text;
      if (!Object.values(ASSISTANT_INTRO).includes(text)) return previous;
      const next = ASSISTANT_INTRO[locale];
      return text === next ? previous : [{ role: 'assistant', text: next }];
    });
  }, [locale]);
  const [onboardingSteps,setOnboardingSteps] = useState<Record<number,'skipped'|'completed'>>({});
  const [progressLoaded,setProgressLoaded] = useState(false);
  const [progressBusy,setProgressBusy] = useState(false);
  const [progressError,setProgressError] = useState('');
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
  useEffect(() => { if (!loading) setWorkspaceResolvedOnce(true); }, [loading]);
  const [busy, setBusy] = useState(false);
  /* Company creation is server-provisioned, not client self-service. */
  const [dbError, setDbError] = useState("");
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [showFollowForm, setShowFollowForm] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: "", vehicle: "", service: "" });
  const [quoteForm, setQuoteForm] = useState({ customerId: "", description: "", amount: "" });
  const [followForm, setFollowForm] = useState({ customerId: "", title: "", date: "", assignedTo: "" });
  // Knowledge entries are stored separately, so missing V5 SQL never blocks V4 features.
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState("");
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);

  const [knowledgeHubMode, setKnowledgeHubMode] = useState<'files'|'write'>('files');
  const [knowledgeAnalysis, setKnowledgeAnalysis] = useState('');
  const [knowledgeAnalysisError, setKnowledgeAnalysisError] = useState('');
  const [knowledgeAnalysisBusy, setKnowledgeAnalysisBusy] = useState(false);
  const [knowledgeForm, setKnowledgeForm] = useState({ title: "", category: "Policy", content: "" });
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [documentSuccess, setDocumentSuccess] = useState("");
  const [semanticBusy, setSemanticBusy] = useState(false);
  const [semanticStatus, setSemanticStatus] = useState("");
  const [actionPrompt, setActionPrompt] = useState("");
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
    const gmailResult = params.get("gmail");
    if (gmailResult) {
      const messages: Record<string, string> = {
        connected: "Gmail connected successfully. Confirm the sender in Integrations → Business email.",
        expired_state: "Gmail connection expired or this authorization link was already used. Open Integrations → Business email and click Connect Gmail to start a fresh, one-time authorization. Keep this tab open until Google returns.",
        invalid_state: "Gmail authorization could not be verified. Start a fresh connection from Integrations.",
        declined: "Gmail permission was declined. No account was connected.",
        token_failed: "Google did not accept the Gmail authorization. Retry using a fresh Connect Gmail attempt; verify the registered redirect URI if it persists.",
        no_refresh_token: "Google did not provide offline Gmail access. Reconnect and grant permission; remove an old authorization from your Google account first if necessary.",
        missing_code: "Google did not return an authorization code. Please reconnect Gmail.",
        profile_failed: "Gmail authorization completed but the Google profile could not be checked. Retry.",
        email_unverified: "The selected Google email could not be verified. Use a verified account.",
        storage_failed: "Gmail authorization succeeded but the connection could not be saved. Contact your workspace administrator.",
        access_revoked: "Your workspace permissions changed; Gmail could not be connected.",
        callback_failed: "Gmail connection could not be completed. Retry and check deployment logs if it happens again.",
      };
      setGmailOauthNotice(messages[gmailResult] || "Gmail authorization requires attention. Review Business email integrations.");
      setSection("Integrations");
      params.delete("gmail");
      const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", clean);
    }
    if (gmailResult || params.has("integration")) setSection("Integrations");
    else if (params.get("section") === "ai-receptionist") setSection("AI Receptionist");
    const token = params.get("join");
    if (token && /^[0-9a-f]{64}$/.test(token)) setJoinToken(token);
  }, []);

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setDbError("");
    setAccessNotice(null);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      setWorkspace(null); setRole("viewer");
      setCustomers([]); setEnquiries([]); setQuotes([]); setTasks([]);
      setDbError("Your session has expired. Please sign in again.");
      setLoading(false);
      return;
    }
    const result = await supabase.from("workspaces").select("id,name,owner_id").order("created_at", { ascending: true }).limit(100);
    if (result.error) {
      setDbError(`Database connection failed: ${result.error.message}. Run the setup SQL in Supabase first.`);
      setLoading(false);
      return;
    }
    // Honor the just-accepted invitation only if Supabase RLS returned this workspace.
    let preferredWorkspaceId = "";
    try { preferredWorkspaceId = window.sessionStorage.getItem(`intrigue-preferred-workspace:${authData.user.id}`) || ""; } catch {}
    const found = ((result.data || []).find(w => w.id === preferredWorkspaceId)
      || result.data?.[0] || null) as Workspace | null;
    if (found) {
      const member = await supabase.from("workspace_memberships").select("role")
        .eq("workspace_id",found.id).eq("user_id",authData.user.id).maybeSingle();
      if (member.error || !member.data || !["owner","admin","staff","viewer","member"].includes(member.data.role)) {
        setWorkspace(null); setRole("viewer");
        setCustomers([]); setEnquiries([]); setQuotes([]); setTasks([]);
        setDbError("This account has no verified membership for its workspace.");
        setLoading(false); return;
      }
      setRole(member.data.role as MemberRole);
      setWorkspace(previous => previous?.id === found.id && previous.name === found.name && previous.owner_id === found.owner_id ? previous : found);
      if (showLoading) setCompanyEditName(found.name);
    }
    if (!found) {
      setWorkspace(null); setRole("viewer");
      // An accepted historical invitation distinguishes a removed member from a new signup.
      // The RPC returns only the current authenticated user's former company, if any.
      const { data: previousAccess, error: accessError } = await supabase.rpc("get_intrigue_access_notice");
      if (accessError) {
        setDbError(`Unable to verify workspace access: ${accessError.message}. Please contact your workspace administrator.`);
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
      supabase.from("customers").select("id,full_name,email,phone,vehicle,created_at,updated_at").eq("workspace_id", found.id).order("updated_at", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("enquiries").select("id,customer_id,subject,status,created_at,updated_at").eq("workspace_id", found.id).order("updated_at", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("quotations").select("id,customer_id,description,amount,status,created_at,quote_note,currency,updated_at").eq("workspace_id", found.id).order("updated_at", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("follow_ups").select("id,customer_id,title,due_at,status,priority,updated_at,source_enquiry_id,source_intent,assigned_to").eq("workspace_id", found.id).order("updated_at", { ascending: false }).order("due_at", { ascending: true }),
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

  useEffect(() => { void refresh(true); }, [refresh]);

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
    if (error) { setSettingsError(error.message);setSettingsReadyId(workspace.id); return; }
    setSavedUiLocale(data?.preferred_language || "en");
    setSettingsReadyId(workspace.id);
    setSettings(data ? {
      industry:data.industry,description:data.description,contact_email:data.contact_email,
      phone:data.phone,website:data.website,business_hours:data.business_hours,
      timezone:data.timezone,currency:data.currency,preferred_language:data.preferred_language || "en",ai_name:data.ai_name,
      ai_tone:data.ai_tone,ai_role:data.ai_role,ai_guidance:data.ai_guidance,
    } : EMPTY_SETTINGS);
  },[supabase,workspace]);
  useEffect(()=>{if(workspace) void loadSettings();},[workspace,loadSettings]);
  useEffect(()=>{
    let current=true;
    setProgressLoaded(false); setOnboardingSteps({}); setProgressError('');
    if(!workspace || !isOwner) { setProgressLoaded(true); return; }
    void (async()=>{
      const {data,error}=await supabase.from('intrigue_onboarding_progress')
        .select('step,status').eq('workspace_id',workspace.id);
      if(!current)return;
      if(error){setProgressError('Tutorial progress unavailable: '+error.message);}
      else {const next:Record<number,'skipped'|'completed'>={};
        for(const row of data||[]) if(row.status==='skipped'||row.status==='completed') next[Number(row.step)]=row.status;
        setOnboardingSteps(next);
      }
      setProgressLoaded(true);
    })();
    return ()=>{current=false;};
  },[supabase,workspace?.id,isOwner]);
  async function saveTutorialStep(step:number,status:'skipped'|'completed'):Promise<boolean>{
    if(!workspace || !isOwner || progressBusy || !progressLoaded)return false;
    setProgressBusy(true);setProgressError('');
    const {error}=await supabase.from('intrigue_onboarding_progress').upsert({
      workspace_id:workspace.id, step, status,
    },{onConflict:'workspace_id,step'});
    setProgressBusy(false);
    if(error){setProgressError(t('Unable to save tutorial progress')+': '+error.message);return false;}
    setOnboardingSteps(prev=>({...prev,[step]:status}));
    return true;
  }
  async function skipTutorialStep(){
    if(guideStep===null)return;
    const step=guideStep;
    if(await saveTutorialStep(step,'skipped')) {openGuide(step+1);}
  }
  async function finishTutorial(){
    if(await saveTutorialStep(6,'completed')) {setGuideStep(null);navigate('Get Started');}
  }

  // Read-only, owner-scoped quota summary from a security-definer database RPC.
  const loadAiUsage = useCallback(async () => {
    if (!workspace || !isOwner) {setAiUsage(null); return;}
    setUsageBusy(true); setUsageError("");
    const {data,error}=await supabase.rpc("get_intrigue_ai_usage");
    if (error) { setUsageError("Usage reporting is unavailable: " + error.message);setAiUsage(null); }
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
      supabase.rpc("list_intrigue_secure_team_invites",{p_workspace_id:workspace.id}),
    ]);
    if(members.error || invites.error) setTeamError(members.error?.message||invites.error?.message||"Team unavailable");
    else {setTeamError("");setTeamMembers((members.data||[]) as TeamMember[]);setTeamInvites((invites.data||[]) as TeamInvite[]);}
  },[supabase,workspace,isOwner]);
  useEffect(()=>{if(section==="Team" || section==="Settings" || section==="Follow-ups") void loadTeam();},[section,loadTeam]);

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
    if(name.length<2||name.length>100){setSettingsError("Company name must have 2-100 characters.");setSettingsBusy(false);return;}
    const nameResult = await supabase.from("workspaces").update({name})
      .eq("id",workspace.id).eq("owner_id",workspace.owner_id);
    if(nameResult.error){setSettingsError(nameResult.error.message);setSettingsBusy(false);return;}
    const saveResult=await supabase.from("workspace_settings").upsert({workspace_id:workspace.id,...settings},{onConflict:"workspace_id"});
    if(saveResult.error)setSettingsError(saveResult.error.message);
    else {
      setSettingsMessage(t("Company and AI settings saved."));
      const languageChanged = settings.preferred_language !== savedUiLocale;
      setSavedUiLocale(settings.preferred_language);
      const readyStep1=!!settings.description.trim() && !!settings.business_hours.trim();
      const readyStep4=!!settings.ai_role.trim() && !!settings.ai_guidance.trim();
      if(guideStep===1 && readyStep1)await saveTutorialStep(1,'completed');
      if(guideStep===4 && readyStep4)await saveTutorialStep(4,'completed');
      await refresh();
      if(languageChanged){
        if(guideStep===1 && readyStep1 || guideStep===4 && readyStep4){
          try{window.sessionStorage.setItem('intrigue-guide-resume:'+workspace.id, String(guideStep===1?2:5));}catch{/* Session storage disabled */}
        }
        setSettingsMessage(t('Language saved. Reloading your workspace…'));
        window.location.reload();
        return;
      }
      if(guideStep===1 && readyStep1)openGuide(2);
      else if(guideStep===4 && readyStep4)openGuide(5);
    }
    setSettingsBusy(false);
  }

  async function createInvite(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!workspace||!isOwner||teamBusy)return;
    setTeamBusy(true);setTeamError("");setTeamMessage("");setInviteLink("");
    const {data,error}=await supabase.rpc("create_intrigue_secure_team_invite",{
      p_workspace_id:workspace.id,p_email:inviteEmail.trim().toLowerCase(),p_role:selectedInviteRole,
    });
    if(error)setTeamError(error.message);
    else if(typeof data==="string"){
      setInviteLink(`${window.location.origin}/join?token=${data}`);
      setInviteEmail("");setTeamMessage("Invitation created. Copy the link now and send it privately to the invited email owner. Expires in 7 days.");
      await loadTeam();
    }
    setTeamBusy(false);
  }
  async function acceptInvite() {
    if(!joinToken||teamBusy)return;
    setTeamBusy(true);setTeamError("");
    const {error}=await supabase.rpc("accept_intrigue_team_invite_secure",{p_token:joinToken});
    if(error){setTeamError(error.message);setTeamBusy(false);return;}
    window.history.replaceState(null,"",window.location.pathname);
    setJoinToken("");setTeamMessage("You joined your company workspace. Your access is controlled by your assigned role.");
    await refresh();setTeamBusy(false);
  }
  async function revokeInvite(id:string) {
    if(!isOwner||teamBusy||!window.confirm("Revoke this invitation?"))return;
    setTeamBusy(true);setTeamError("");
    const {error}=await supabase.rpc("revoke_intrigue_secure_team_invite",{p_invitation_id:id});
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
    else {
      setServiceForm({id:"",name:"",description:"",price:"",currency:settings.currency,is_active:true});
      setShowServiceForm(false);await loadServices();
      if(guideStep===3){void saveTutorialStep(3,'completed');openGuide(4);}
    }
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
    const {error} = await supabase.from("follow_ups").insert({workspace_id:workspace.id, customer_id:followForm.customerId, title:followForm.title.trim(), due_at:new Date(`${followForm.date}T12:00:00`).toISOString(), status:"pending", priority:"normal", assigned_to:followForm.assignedTo || null});
    if (error) setDbError(error.message);
    else { setFollowForm({customerId:"",title:"",date:"",assignedTo:""}); setShowFollowForm(false); await refresh(); }
    setBusy(false);
  }

  async function assignFollowUp(id: string, assignedTo: string) {
    if (!isOwner || !workspace) return;
    setBusy(true); setDbError("");
    const { error } = await supabase.from("follow_ups")
      .update({ assigned_to: assignedTo || null })
      .eq("id", id).eq("workspace_id", workspace.id);
    if (error) setDbError(error.message); else await refresh();
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
      setKnowledgeError(`Knowledge Base isn't ready yet: ${result.error.message}. Please contact your workspace administrator.`);
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
    if (error) setDocumentError("Documents are not available right now. Please contact your workspace administrator.");
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
      setKnowledgeError("Title must have 3-120 characters and content 10-4,000 characters.");
      return;
    }
    setKnowledgeBusy(true); setKnowledgeError("");
    const { error } = await supabase.from("knowledge_entries").insert({
      workspace_id: workspace.id, title, content, category: knowledgeForm.category,
    });
    if (error) setKnowledgeError(`Could not save knowledge: ${error.message}`);
    else {
      setKnowledgeForm({ title: "", category: "Policy", content: "" });
      await loadKnowledge();
    }
    setKnowledgeBusy(false);
  }

  // AI review is informational ONLY: it never prepares approval proposals or
  // creates quotations, customers, services, or follow-up records.
  async function reviewKnowledgeWithAi(mode: 'files'|'write') {
    if (knowledgeAnalysisBusy || !workspace || !isOwner) return;
    const draft = knowledgeForm.content.trim();
    if (mode === 'write' && draft.length < 10 && knowledgeEntries.length === 0) {
      setKnowledgeAnalysisError('Type at least 10 characters or save a knowledge entry first.');
      return;
    }
    if (mode === 'files' && documents.length === 0) {
      setKnowledgeAnalysisError('Upload a company document before requesting file analysis.');
      return;
    }
    setKnowledgeAnalysis('');
    setKnowledgeAnalysisError('');
    setKnowledgeAnalysisBusy(true);
    const question = mode === 'files'
      ? 'Review ONLY the uploaded company knowledge documents. List filenames, summarize business facts, products or services, policies, and any missing information. Distinguish facts from unknowns. This is an analysis request, NOT a request to draft a quotation, contact a customer or create approval proposals.'
      : 'Analyze the following fictional company notes and any saved company knowledge entries. Produce a clear summary of company identity, offering, policies, and missing information. Do not invent prices, orders, quotations or customer records. This is informational analysis only.\n\nNotes: '+draft.slice(0,4000);
    try {
      const response=await fetch('/api/agent',{
        method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
        body:JSON.stringify({question}),
      });
      const result:{reply?:string;error?:string;proposed_action_prompt?:string}=await response.json();
      if(!response.ok) throw new Error(result.error || 'AI analysis could not be completed.');
      setKnowledgeAnalysis(result.reply?.trim() || 'The AI returned no analysis. Try describing a specific document or policy.');
      if(result.proposed_action_prompt) setKnowledgeAnalysisError('The assistant suggested an action, but nothing was submitted for approval or changed in your records.');
    } catch(err){
      setKnowledgeAnalysisError(err instanceof Error ? err.message : 'AI analysis unavailable.');
    } finally { setKnowledgeAnalysisBusy(false); }
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
    if (a.error || b.error) setActionError("Action Center is unavailable. Please contact your workspace administrator.");
    else {setActionError("");setActionProposals((a.data||[]) as ActionProposal[]);setActionAudit((b.data||[]) as ActionAudit[]);}
  },[supabase,workspace]);

  useEffect(() => { if (section==="Automation Center") void loadActions(); },[section,loadActions]);

  const loadAutomationJobs = useCallback(async () => {
    if (!workspace) { setAutomationJobs([]); return; }
    const result=await supabase.from("automation_jobs")
      .select("id,proposal_id,quotation_id,kind,status,attempts,max_attempts,last_error,result,created_at,updated_at,completed_at")
      .eq("workspace_id",workspace.id).order("created_at",{ascending:false}).limit(75);
    if (result.error) setAutomationError("Unable to load previous automation jobs: " + result.error.message);
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
  const customerContext = (id:string) => {
    const customer = customers.find((c) => c.id === id);
    return isAutomotiveIndustry(settings.industry)
      ? (customer?.vehicle || "Vehicle not provided")
      : (customer?.email || customer?.phone || "Contact not provided");
  };
  const activeEnquiries = enquiries.filter((e) => e.status !== "closed");
  const pendingTasks = tasks.filter((t) => t.status === "pending");
  const pendingQuotes = quotes.filter((q) => q.status !== "approved");
  const quotePipeline = pendingQuotes.reduce((sum, q) => sum + Number(q.amount), 0);
  const inputClass = "w-full rounded-xl border border-[#35485d] bg-[#182c41] px-3 py-2.5 text-sm text-[#f5f0e8] outline-none focus:border-[#caa961]";
  const newButtonClass = "rounded-xl bg-[#c9a552] px-4 py-2.5 text-xs font-semibold text-[#111b29] hover:bg-[#e4c47b] disabled:opacity-50";

  const guideActualDone=[
    Boolean(settings.description.trim()&&settings.business_hours.trim()),
    knowledgeEntries.length>0||documents.length>0,
    services.length>0,
    Boolean(settings.ai_role.trim()&&settings.ai_guidance.trim()),
    teamMembers.length>1,
    onboardingSteps[6]==='completed',
  ];
  const guideState=(step:number):'completed'|'skipped'|'pending'=>
    guideActualDone[step-1] || onboardingSteps[step]==='completed' ? 'completed' : onboardingSteps[step]==='skipped' ? 'skipped' : 'pending';
  const guideHandled=[1,2,3,4,5,6].filter(step=>guideState(step)!=='pending').length;
  const guideCompleted=[1,2,3,4,5,6].filter(step=>guideState(step)==='completed').length;
  const guideSkipped=guideHandled-guideCompleted;
  const GUIDE_TITLES = [
    'Complete business profile','Upload company knowledge and data',
    'Review products and pricing','Configure your AI Assistant',
    'Invite team members (optional)','Review setup readiness',
  ];
  const GUIDE_DESTINATIONS:Section[] = ['Settings','Knowledge Base','Service Catalog','Settings','Team','Get Started'];
  function openGuide(step:number){
    const n=Math.max(1,Math.min(6,step));
    setGuideStep(n);
    navigate(GUIDE_DESTINATIONS[n-1]);
  }
  useEffect(()=>{
    if(!workspace || !isOwner)return;
    try{
      const key='intrigue-guide-resume:'+workspace.id;
      const next=Number(window.sessionStorage.getItem(key));
      if(next>=1&&next<=6){window.sessionStorage.removeItem(key);setGuideStep(next);setSection(GUIDE_DESTINATIONS[next-1]);}
    }catch{/* Session storage disabled */}
  },[workspace?.id,isOwner]);
  useEffect(()=>{
    if(guideStep!==4 || section!=='Settings')return;
    const frame=window.requestAnimationFrame(()=>document.getElementById('intrigue-ai-config')?.scrollIntoView({behavior:'smooth',block:'start'}));
    return ()=>window.cancelAnimationFrame(frame);
  },[guideStep,section]);

  function navigate(next: Section) {
    if (!isOwner && OWNER_ONLY_SECTIONS.includes(next) && !(next === "Automation Center" && role === "admin")) return;
    setSection(next);
    setMobileOpen(false);
  }

  function takeToActionCenter() {
    // The Action Center is for actionable, supported commands only.
    setActionPrompt("");
    setSection("Automation Center");
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

  // During first hydration, hide temporary dark styling and generic company
  // placeholders. Reveal the full interface only after local theme and first
  // workspace lookup are resolved. Subsequent refreshes keep the shell mounted.
  if (!appearanceReady || !workspaceResolvedOnce || (!!workspace && settingsReadyId!==workspace.id)) {
    return <div className="intrigue-rc22-boot" data-theme={appearanceReady ? appearance : 'pending'} role="status" aria-live="polite" aria-busy="true">
      <div className="intrigue-rc22-boot-inner">
        <span className="intrigue-rc22-boot-wordmark">INTRIGUE <small>STUDIOS</small></span>
        <div className="intrigue-rc22-boot-progress" aria-hidden="true"><span/></div>
        <p>{t("Preparing your secure workspace…")}</p>
      </div>
    </div>;
  }

  // Block the new-company onboarding screen for members whose access was removed.
  // Invitation links remain usable if the former member is invited to a workspace again.
  if (!loading && !workspace && accessNotice && !joinToken && !dbError) {
    const contactEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accessNotice.contact_email)
      ? accessNotice.contact_email : "";
    return <div className="intrigue-dashboard flex min-h-screen items-center justify-center bg-[#0b1827] px-5 py-12 text-[#f5f0e8]">
      <div className="w-full max-w-xl rounded-3xl border border-[#93733c]/60 bg-[#142539] p-7 shadow-2xl md:p-10">
        <div className="mb-5 inline-flex rounded-xl border border-[#b99a60]/30 bg-[#c9a552]/10 p-3 text-[#e9c577]"><ShieldCheck size={27}/></div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#d5b46a]">{t("INTRIGUE STUDIOS  |  Workspace access")}</p>
        <h1 className="brand-display mt-3 text-4xl">{t("Your access has been removed.")}</h1>
        <p className="mt-4 text-sm leading-7 text-[#c7d4df]">
          Your account no longer has permission to view <strong className="text-[#f5f0e8]">{accessNotice.company_name}</strong>.
          If you think this was a mistake, contact the company administrator to request a new invitation.
        </p>
        <p className="mt-3 text-xs text-[#9eacba]">{t("Your INTRIGUE login still exists, but this company's data is no longer available to you.")}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          {contactEmail && <a href={`mailto:${contactEmail}?subject=${encodeURIComponent("INTRIGUE workspace access")}`} className="rounded-xl bg-[#c9a552] px-5 py-3 text-sm font-semibold text-[#0b1827]">{t("Contact company administrator")}</a>}
          <button type="button" onClick={() => void refresh()} className="rounded-xl border border-[#506077] px-5 py-3 text-sm text-[#f5f0e8]">{t("Check access again")}</button>
          <button type="button" onClick={async () => { await supabase.auth.signOut(); window.location.assign("/auth/login"); }} className="rounded-xl border border-[#506077] px-5 py-3 text-sm text-[#f5f0e8]">{t("Sign out")}</button>
        </div>
        {!contactEmail && <p className="mt-4 text-xs text-[#b8c7d4]">{t("For contact details, reach the company owner through your usual communication channel.")}</p>}
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
          <div className="mt-1.5 text-[9px] uppercase tracking-[0.14em] text-[#9daebb]">{t("Operations Intelligence")}</div>
        </div>
      </div>
      <div className="mx-4 mb-7 rounded-xl border border-[#d9b467]/20 bg-[#ffffff]/[0.035] px-3.5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#bd9955]/20 text-[#e1c27f]"><IndustryIcon industry={settings.industry} size={19}/></div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-[#f5f0e8]">{workspace?.name ?? "Your company"}</div>
            <div className="text-[11px] text-[#9eacba]">{t("Private company workspace")}</div>
          </div>
        </div>
      </div>
      <div className="intrigue-sidebar-nav min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
        <nav className="space-y-1" aria-label="Workspace navigation">
          {NAV.filter(item => !["Data Management","Security & Usage","Plans & Billing","Pilot Application"].includes(item.label) && (isOwner || (role === "admin" && item.label === "Automation Center") || !OWNER_ONLY_SECTIONS.includes(item.label))).map(item => {
            const Icon=item.icon; const selected=section===item.label;
            const group=({"Overview":"WORKSPACE","Customers":"BUSINESS","AI Assistant":"AI & AUTOMATION","Integrations":"CONNECTIONS","Team":"ADMINISTRATION"} as Record<string,string>)[item.label];
            return <div key={item.label}>
              {group && <div className="mb-2 mt-5 px-3 text-[10px] font-bold tracking-[0.2em] text-[#c4a86e]">{t(group)}</div>}
              <button type="button" onClick={()=>navigate(item.label)} aria-current={selected?'page':undefined}
                className={`intrigue-nav-item flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-[13px] font-medium transition-colors ${selected?'intrigue-nav-item-active':''}`}>
                <Icon size={18} strokeWidth={selected?2.4:1.8}/>
                <span className="flex-1">{t(item.label === "Customers" ? "Customers & CRM" : item.label === "Quotations" ? "Quotations & Proposals" : item.label === "Service Catalog" && /retail|fashion|commerce/i.test(settings.industry) ? "Product Catalog" : item.label)}</span>
              </button>
            </div>;
          })}
          {isOwner && <details className="mt-5 border-t border-[#c5a566]/25 pt-4">
            <summary className="cursor-pointer rounded-lg px-3 py-2 text-xs font-bold tracking-wide text-[#c4a86e]">{t("Advanced settings")}</summary>
            {["Data Management","Security & Usage","Plans & Billing","Pilot Application"].map(label=>{
              const item=NAV.find(n=>n.label===label)!;const Icon=item.icon;
              return <button key={label} type="button" onClick={()=>navigate(item.label)} aria-current={section===label?'page':undefined}
                className={`intrigue-nav-item flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-[13px] ${section===label?'intrigue-nav-item-active':''}`}>
                <Icon size={17}/><span>{t(label==='Pilot Application'?'Pilot request':label)}</span>
              </button>;
            })}
          </details>}
        </nav>
      </div>
      <div className="mt-auto p-4">

<button type="button" onClick={() => void handleSignOut()} disabled={signingOut} className="intrigue-signout-button mt-3 flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition disabled:opacity-60" aria-label="Log out of INTRIGUE"><LogOut size={15}/>{t(signingOut ? "Logging out…" : "Log out")}</button>
        <div className="mt-4 flex items-center gap-3 px-2 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#344358] text-xs font-bold text-[#f5f0e8]">IS</div>
          <div className="min-w-0"><div className="text-xs font-semibold text-[#f5f0e8]">{workspace?.name ?? "Your workspace"}</div><div className="text-[11px] text-[#9eacba]">{t(role === "owner" ? "Company owner" : role === "admin" ? "Administrator" : "Team member")}</div></div>
        </div>
      </div>
    </>
  );

  return (
    <div lang={locale} dir={uiDirection(locale)} data-intrigue-theme={appearance} className="intrigue-dashboard intrigue-glass min-h-screen bg-[#0b1827] font-sans text-[#f2efe8] lg:flex lg:h-dvh lg:overflow-hidden">
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
            <span className="hidden text-[13px] text-[#9eacba] sm:block">{t("Workspace")}</span>
            <ChevronRight className="hidden text-[#d5dfeb] sm:block" size={15}/>
            <span className="text-sm font-semibold">{t(section === "Service Catalog" && /retail|fashion|commerce/i.test(settings.industry) ? "Product Catalog" : section)}</span>
          </div>
          <div className="flex items-center gap-3 md:gap-5">
            <span className="hidden items-center gap-1.5 rounded-full bg-[#654e24]/40 px-3 py-1.5 text-[11px] font-bold text-[#e7c37c] sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-[#ddb96d]"/>{t("WORKSPACE")}</span>
            <button type="button" onClick={toggleAppearance} aria-label={appearance === "dark" ? "Switch to light appearance" : "Switch to dark appearance"} title={appearance === "dark" ? "Light mode" : "Dark mode"} className="rounded-xl border border-[#415064] p-2 text-[#d9c18b] transition hover:bg-[#26384d]">
              {appearance === "dark" ? <Sun size={18}/> : <Moon size={18}/>}
            </button>
            <div className="relative">
              <button type="button" onClick={() => setActivityOpen(open => !open)} aria-expanded={activityOpen} aria-label="Open activity notifications" className="rounded-xl border border-[#415064] p-2 text-[#d9c18b] transition hover:bg-[#26384d]">
                <Bell size={18}/>
              </button>
              {activityOpen && <div role="dialog" aria-label="Notifications" className="intrigue-activity-popover absolute right-0 top-12 z-50 w-[min(345px,85vw)] rounded-2xl border border-[#45566b] bg-[#13263b] p-4 shadow-2xl">
                <div className="flex items-center justify-between gap-4"><h3 className="text-sm font-semibold text-[#f1d189]">{t("Activity & notifications")}</h3><button onClick={() => setActivityOpen(false)} type="button" aria-label="Close notifications" className="rounded-lg p-1 hover:bg-[#26384d]"><X size={17}/></button></div>
                <p className="mt-3 text-sm text-[#d9e2eb]">{t("Notifications appear here when connected services report an event.")}</p>
                <p className="mt-2 text-xs leading-5 text-[#aebed0]">{t("Your current alerts and activity settings are managed in Integrations and Settings.")}</p>
              </div>}
            </div>
            <button type="button" className="intrigue-signout-button inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition disabled:opacity-60" onClick={() => void handleSignOut()} disabled={signingOut} aria-label="Log out of INTRIGUE" title="Log out">
              <LogOut size={16}/><span className="hidden sm:inline">{t(signingOut ? "Logging out…" : "Log out")}</span>
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#80642f] text-xs font-bold text-[#f5f0e8]">IS</div>
          </div>
        </header>

        <main className="mx-auto max-w-[1430px] px-5 pb-12 pt-8 md:px-9">
          <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.26em] text-[#d4b469]">{workspace?.name.toUpperCase() ?? "NEW COMPANY"}  /  WORKSPACE</div>
              <h1 className="brand-display text-[34px] font-medium leading-none tracking-[-0.04em] md:text-[46px]">{section === "Overview" ? "Your operations, in focus." : (t(section === "Service Catalog" && /retail|fashion|commerce/i.test(settings.industry) ? "Product Catalog" : section))}</h1>
              <p className="mt-1.5 text-sm text-[#afbdcb]">{section === "Overview" ? "An intelligent view of everything moving your business forward." : "Workspace data and tools for your team."}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => navigate("Quotations")} className="flex items-center gap-2 rounded-xl border border-[#415064] bg-[#142539] px-4 py-2.5 text-xs font-semibold text-[#f0e9dc] shadow-sm hover:bg-[#1b2e42]"><Plus size={16}/>{t("View quotes")}</button>
              {isOwner && <button type="button" onClick={() => navigate("AI Assistant")} className="flex items-center gap-2 rounded-xl bg-[#c9a552] px-4 py-2.5 text-xs font-semibold text-[#111b29] hover:bg-[#e4c47b]"><Sparkles size={16}/>{t("Ask AI")}</button>}
            </div>
          </div>

          {gmailOauthNotice && <div role="status" className="mb-6 rounded-xl border border-[#b59450] bg-[#604d22]/30 p-4 text-sm text-[#f5dfab]">
            <strong>Gmail connection:</strong> {gmailOauthNotice}
            <button type="button" onClick={() => {setGmailOauthNotice("");setSection("Integrations");}} className="ml-3 underline">Dismiss / Open integrations</button>
          </div>}
          {dbError && <div role="alert" className="mb-6 rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-200">{dbError} <button type="button" onClick={()=>void refresh()} className="ml-3 underline">{t("Retry")}</button></div>}
          {loading && <div className="rounded-2xl border border-[#304153] bg-[#142539] p-8 text-sm text-[#afbdcb]">{t("Loading your Supabase workspace...")}</div>}
          {!loading && joinToken && <div className="mb-6 rounded-2xl border border-[#a18343]/60 bg-[#142539] p-6">
            <h2 className="text-lg font-semibold text-[#f2d486]">{t("Team invitation")}</h2>
            <p className="mt-2 text-sm text-[#d5dfeb]">{t("Join the invited workspace using the account whose verified email matches the invitation. Team access follows the role assigned by your company owner.")}</p>
            <button type="button" disabled={teamBusy} onClick={()=>void acceptInvite()} className="mt-4 rounded-xl bg-[#c9a552] px-4 py-2.5 text-sm font-semibold text-[#111b29] disabled:opacity-50">{teamBusy?"Joining...":"Accept invitation"}</button>
            {teamError && <p role="alert" className="mt-3 text-sm text-[#ffb3a7]">{teamError}</p>}
          </div>}
          {!loading && !workspace && !dbError && !joinToken && (
            <div className="rounded-2xl border border-[#a18343]/40 bg-[#142539] p-8">
              <h2 className="brand-display text-4xl text-[#f5f0e8]">No company workspace assigned</h2>
              <p className="mt-3 max-w-xl text-sm leading-7 text-[#afbdcb]">Your login is active, but it is not a member of an INTRIGUE company. Ask the company owner for a private team invitation and open that link while signed into the invited email.</p>
              <p className="mt-3 text-sm text-[#d5b46a]">New company subscriptions are provisioned separately after approval. Employee registration never creates a second company or subscription.</p>
              <button type="button" onClick={() => void refresh(true)} className="mt-6 rounded-xl border border-[#977b4a] px-4 py-2.5 text-xs font-semibold text-[#e9c577]">Check workspace access</button>
            </div>
          )}
          {!loading && workspace && <>
          {isOwner && guideStep!==null && section!=="Get Started" && (
            <section className="intrigue-setup-guide mb-6 rounded-2xl border border-[#b9975c] bg-[#142539] p-5" aria-label="Guided company setup">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#d6ae67]">{t("Guided company setup")} / {guideStep}/6</div>
                  <h2 className="mt-1 text-lg font-semibold">{t(GUIDE_TITLES[guideStep-1])}</h2>
                  <p className="mt-2 text-xs opacity-80">{t("Your information is saved in your company workspace. Move between steps whenever you need.")}</p>
                </div>
                <button type="button" className="rounded-lg border border-[#977b4a] px-3 py-2 text-xs" onClick={()=>{setGuideStep(null);navigate('Get Started');}}>{t("Exit tutorial")}</button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={guideStep===1} onClick={()=>openGuide(guideStep-1)} className="rounded-lg border border-[#927648] px-4 py-2 text-xs disabled:opacity-40">{t("Previous step")}</button>
                {guideStep<6 && <button type="button" disabled={progressBusy||!progressLoaded} onClick={()=>{void skipTutorialStep();}} className="rounded-lg border border-[#927648] px-4 py-2 text-xs disabled:opacity-40">{t('Skip this step')}</button>}
                {guideStep<6 && <button type="button" disabled={guideState(guideStep)==='pending'||progressBusy||!progressLoaded} onClick={()=>openGuide(guideStep+1)} className="rounded-lg bg-[#c9a552] px-4 py-2 text-xs font-semibold text-[#122036] disabled:opacity-40">{t('Continue')} {guideStep+1} →</button>}
                {guideStep===6 && <button type="button" disabled={progressBusy||!progressLoaded} onClick={()=>{void finishTutorial();}} className="rounded-lg bg-[#c9a552] px-4 py-2 text-xs font-semibold text-[#122036]">{t('Finish tutorial')}</button>}
              </div>
              {progressError && <p role="alert" className="mt-3 text-xs text-red-300">{progressError}</p>}
            </section>
          )}

          {section === "Overview" && (
            <div className="space-y-6">
              <div className="intrigue-hero relative overflow-hidden rounded-[20px] border border-[#a18343]/35 bg-[linear-gradient(118deg,#15283c_0%,#1a2c3f_62%,#403626_100%)] p-6 text-[#f5f0e8] shadow-[0_18px_45px_rgba(0,0,0,0.14)] md:p-8">
                <div className="absolute -right-12 -top-20 h-64 w-64 rounded-full border-[45px] border-[#d5b264]/10"/>
                <div className="absolute right-20 top-16 h-44 w-44 rounded-full border-[28px] border-[#d5b264]/10"/>
                <img src="https://intriguestudios.de/intrigue-logo.png" alt="" aria-hidden="true" className="pointer-events-none absolute -right-8 -top-24 hidden h-[410px] w-[360px] object-contain opacity-[0.24] lg:block" />
                <div className="relative z-10 max-w-xl">
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-[#e5c47c]/10 px-3 py-1.5 text-[11px] font-semibold text-[#f2d486]"><Zap size={13}/>{t("INTELLIGENCE, BY DESIGN")}</div>
                  <h2 className="brand-display text-[34px] font-medium leading-[1.05] tracking-[-0.02em] md:text-[51px]">{t("One system. Infinite clarity.")}</h2>
                  <p className="mt-3 max-w-md text-[13px] leading-6 text-[#d3d8dd]/80">{t("Your clients, knowledge and workflows in one intelligent workspace. Designed to help your business move with precision.")}</p>
                  {isOwner && <button type="button" onClick={() => navigate("AI Assistant")} className="mt-6 flex items-center gap-2 rounded-xl bg-[#d1ad60] px-4 py-2.5 text-xs font-bold text-[#182234] hover:bg-[#f0d38c]">{t("Meet your AI assistant")} <ArrowRight size={15}/></button>}
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
                  <div className="flex items-center justify-between border-b border-[#2d3b4f] px-5 py-5 md:px-6"><div><h3 className="text-[15px] font-bold">{t("Recent inquiries")}</h3><p className="mt-1 text-xs text-[#9eacba]">{t("Customers that need your attention")}</p></div><button type="button" onClick={() => navigate("Customers")} className="flex items-center gap-1 text-xs font-semibold text-[#e0bf76] hover:underline">{t("View all")} <ArrowUpRight size={15}/></button></div>
                  <div className="intrigue-inquiries-overview min-w-0"><table className="w-full table-fixed text-left"><thead><tr className="border-b border-[#2d3b4f] bg-[#192b3e]/70 text-[11px] uppercase tracking-[0.04em] text-[#9eacba]"><th className="px-6 py-3 font-semibold">{t("Customer")}</th><th className="px-3 py-3 font-semibold">{t("Request")}</th><th className="px-3 py-3 font-semibold">{t("Customer handling")}</th>{/* INTRIGUE_CORE_AI_HANDLING_SPLIT_V1 */}<th className="px-4 py-3 font-semibold">{t("Received")}</th></tr></thead><tbody>{enquiries.slice(0, 5).map((row) => <tr key={row.id} className="cursor-pointer border-b border-[#2d3b4f] last:border-0 hover:bg-[#20354b]" onClick={() => {setHighlightEnquiryId(row.id);navigate("Customers");}} onKeyDown={event => {if(event.key === "Enter"){setHighlightEnquiryId(row.id);navigate("Customers");}}} tabIndex={0} aria-label="Open enquiry"><td className="px-6 py-4"><div className="text-xs font-bold text-[#f5f0e8]">{customerName(row.customer_id)}</div><div className="mt-1 text-[11px] text-[#9eacba]">{customerContext(row.customer_id)}</div></td><td className="px-3 py-4 text-xs text-[#d5dbe0]">{row.subject}</td><td className="px-3 py-4"><Tag variant={row.status === "follow_up" ? "amber" : row.status === "scheduled" ? "emerald" : row.status === "new" ? "blue" : "slate"}>{statusText(row.status)}</Tag></td><td className="px-4 py-4 text-[11px] text-[#9eacba]">{niceDate(row.created_at)}</td></tr>)}</tbody></table></div>
                </div>
                <div className="rounded-2xl border border-[#304153] bg-[#142539] p-5 shadow-sm md:p-6">
                  <div className="mb-1 flex items-center gap-2"><Sparkles size={19} className="text-[#e0bb72]"/><h3 className="text-[15px] font-bold">{t("Ask your business")}</h3></div>
                  <p className="mb-5 text-xs leading-5 text-[#9eacba]">{t("Ask your AI about customers, quotations and follow-ups saved in Supabase.")}</p>
                  <div className="mb-4 rounded-xl border border-[#3f3a2b] bg-[#182b3e] p-4"><div className="mb-2 flex items-center gap-2 text-xs font-bold text-[#f5f0e8]"><Bot size={17} className="text-[#e0bf76]"/>INTRIGUE Assistant</div><p className="text-xs leading-6 text-[#d5dbe0]">{t("You have")} <strong>{pendingTasks.length} {t("pending follow-ups")}</strong> {t("and")} <strong>{money(quotePipeline)}</strong> {t("in unapproved quotations. What would you like to review first?")}</p></div>
                  {isOwner && <div className="space-y-2">{QUICK_PROMPTS.map((prompt) => <button type="button" key={prompt} onClick={() => void askQuestion(prompt)} disabled={aiLoading} className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#35485d] px-3.5 py-3 text-left text-xs font-medium text-[#d5dbe0] hover:border-[#caa961] hover:bg-[#2c3949]/50">{t(prompt)}<ArrowRight size={15} className="shrink-0 text-[#9eacba]"/></button>)}</div>}
                  <div className="mt-4 text-[10px] text-[#9eacba]">{t("AI answers use current database records. The model cannot modify business records.")}</div>
                </div>
              </div>

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
              <div className="flex items-center gap-3 border-b border-[#2d3b4f] p-5"><div className="rounded-xl bg-[#263447] p-3 text-[#e0bf76]"><Bot size={22}/></div><div><div className="text-sm font-bold">INTRIGUE Assistant</div><div className="text-[11px] text-[#afbdcb]">{t("Tool-calling agent  |  Reads records and prepares approval proposals")}</div></div><span className="ml-auto"><Tag variant={aiConnected ? "emerald" : "amber"}>{t(aiConnected ? "AI configured" : "API key missing")}</Tag></span></div>
              <div className="flex h-[440px] flex-col gap-4 overflow-y-auto bg-[#0d1c2b] p-5 md:p-6" aria-live="polite">{messages.map((message, index) => <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`${message.proposalId?"w-full max-w-[90%]":"max-w-[85%]"} space-y-3`}><div className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[13px] leading-6 ${message.role === "user" ? "rounded-tr-sm bg-[#30455b] text-[#f5f0e8]" : "rounded-tl-sm border border-[#304153] bg-[#142539] text-[#f0e9dc]"}`}>{message.text}</div>{message.toolsUsed?.length ? <p className="text-[11px] text-[#d6bc80]">{t("Tools:")} {message.toolsUsed.join("  |  ")}</p> : null}{message.proposalId && (actionProposals.find(p=>p.id===message.proposalId) ? <ProposalReviewCard proposal={actionProposals.find(p=>p.id===message.proposalId)!} customer={customerName(actionProposals.find(p=>p.id===message.proposalId)!.customer_id)} busy={actionBusy} onDecide={(id,decision)=>void decideAction(id,decision)} onEdit={editAction}/> : <button type="button" className="text-xs text-[#e9c577] underline" onClick={()=>navigate("Automation Center")}>{t("View approval queue")}</button>)}</div></div>)}{aiLoading && <p className="text-xs text-[#d8c18e]">{chatActionBusy?"Preparing a verified proposal...":"Calling authorized business tools..."}</p>}{actionError && <p role="alert" className="rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-xs text-[#ffc2b9]">{t("Action:")} {actionError}</p>}{actionMessage && <p role="status" className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-xs text-[#b3ead0]">{actionMessage}</p>}</div>
              <div className="border-t border-[#2d3b4f] p-4 md:p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-[#afbdcb]">{t("Tools: customers, quotations, follow-ups, knowledge and approval drafts. Human approval required.")}</span><button type="button" onClick={takeToActionCenter} className="rounded-lg border border-[#b18c46] px-3 py-2 text-xs font-semibold text-[#e9c577] hover:bg-[#26384d]">{t("View approvals")}</button></div><div className="mb-3 flex flex-wrap gap-2">{QUICK_PROMPTS.map((prompt) => <button key={prompt} type="button" onClick={() => void askQuestion(prompt)} disabled={aiLoading} className="rounded-full border border-[#35485d] px-3 py-1.5 text-[11px] text-[#d5dbe0] hover:bg-[#1b2e42]">{t(prompt)}</button>)}</div><form onSubmit={submitChat} className="flex gap-2"><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("Ask a question or request a draft quote...")} className="min-w-0 flex-1 rounded-xl border border-[#35485d] bg-[#182c41] px-4 py-3 text-sm text-[#f5f0e8] placeholder:text-[#98a8b8] outline-none focus:border-[#caa961]" aria-label="Message"/><button type="submit" disabled={!draft.trim() || aiLoading} className="flex h-[46px] w-[48px] items-center justify-center rounded-xl bg-[#30455b] text-[#f5f0e8] disabled:opacity-40" aria-label="Send message"><Send size={18}/></button></form></div>
            </div>
          )}

          {section === "Automation Center" && (
            <div className="space-y-5">
              {workspace && <AutomationCentreV2 workspaceId={workspace.id} canManage={isOwner || role === "admin"} />}
              {isOwner && actionProposals.length > 0 && <details className="rounded-2xl border border-[#35485d] bg-[#142539] p-5">
                <summary className="cursor-pointer text-sm font-semibold text-[#e3c07b]">Other pending approvals ({actionProposals.filter(p=>p.status === "pending").length})</summary>
                <div className="mt-4 space-y-3">
                  <p className="text-xs opacity-70">{t("Approval requests created through the AI assistant. All actions require confirmation.")}</p>
                  {actionProposals.map(proposal=><ProposalReviewCard key={proposal.id} proposal={proposal} customer={customerName(proposal.customer_id)} busy={actionBusy} onDecide={(id,decision)=>void decideAction(id,decision)} onEdit={editAction}/>)}
                </div>
              </details>}
              {isOwner && <details className="rounded-2xl border border-[#35485d] bg-[#142539] p-5">
                <summary className="cursor-pointer text-sm font-semibold text-[#e3c07b]">{t("Previous test jobs")}</summary>
                <div className="mt-5 space-y-5">
              <div className="rounded-2xl border border-[#806f46]/50 bg-[#142539] p-6">
                <div className="mb-3 flex items-center gap-3"><Zap size={22} className="text-[#e0bf76]"/><h2 className="text-base font-bold">{t("INTRIGUE Native Automation Engine")}</h2><Tag variant="amber">{t("Manual test processing")}</Tag></div>
                <p className="max-w-3xl text-xs leading-6 text-[#c9d4df]">{t("Queue a safe processing receipt for a quotation you already approved. Supabase stores the job and its history. A separate worker processes it. No email, WhatsApp, CRM update or customer action will occur.")}</p>
              </div>
              {automationError && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-xs text-[#ffc2b9]">{automationError}</p>}
              {automationMessage && <p role="status" className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-xs text-[#b3ead0]">{automationMessage}</p>}
              <div className="rounded-2xl border border-[#35485d] bg-[#142539] p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">{t("Approved quotations available for processing")}</h3><button type="button" onClick={()=>{void loadActions();void loadAutomationJobs();}} disabled={automationBusy} className="rounded-lg border border-[#806f46] px-3 py-2 text-xs text-[#e9c577]">{t("Refresh")}</button></div>
                <div className="space-y-3">
                  {actionProposals.filter(p=>p.status==="approved" && !!p.quotation_id).length===0 && <p className="text-xs text-[#afbdcb]">{t("No approved quotations yet. Approve a quote in AI Assistant first.")}</p>}
                  {actionProposals.filter(p=>p.status==="approved" && !!p.quotation_id).map(p=>{
                    const job=automationJobs.find(j=>j.proposal_id===p.id);
                    return <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#34475b] bg-[#0e2032] p-4">
                      <div><p className="text-sm font-semibold">{customerName(p.customer_id)}  |  {p.quote_description || "Approved quotation"}</p><p className="mt-1 text-xs text-[#afbdcb]">{money(Number(p.quote_amount))}  |  Quote {p.quotation_id?.slice(0,8)}</p></div>
                      {job ? <Tag variant={job.status==="completed"?"emerald":job.status==="needs_review"?"amber":"blue"}>{job.status.replaceAll("_"," ")}</Tag> :
                        <button type="button" disabled={automationBusy} onClick={()=>void queueDemoJob(p.id)} className="rounded-lg bg-[#c9a552] px-4 py-2.5 text-xs font-bold text-[#111b29] disabled:opacity-50">{t("Queue internal job")}</button>}
                    </div>;
                  })}
                </div>
              </div>
              <div className="rounded-2xl border border-[#35485d] bg-[#142539] p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">{t("Job history")}</h3><span className="text-xs text-[#aebdcb]">{automationJobs.length} {t("visible jobs")}</span></div>
                {automationJobs.length===0 && <p className="text-xs text-[#afbdcb]">{t("No jobs queued. Use the button above to add the first one.")}</p>}
                <div className="space-y-3">{automationJobs.map(j=><div key={j.id} className="rounded-xl border border-[#34475b] bg-[#0e2032] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold">{t("Job")} {j.id.slice(0,8)}  |  Quote {j.quotation_id.slice(0,8)}</p><Tag variant={j.status==="completed"?"emerald":j.status==="needs_review"?"amber":"blue"}>{j.status.replaceAll("_"," ")}</Tag></div>
                  <p className="mt-2 text-[11px] text-[#afbdcb]">{t("Attempts:")} {j.attempts}/{j.max_attempts}  |  Created {niceDate(j.created_at)}</p>
                  {j.result?.message && <p className="mt-2 text-xs text-[#b3ead0]">{j.result.message}</p>}
                  {j.last_error && <p className="mt-2 text-xs text-[#ffc2b9]">{t("Error:")} {j.last_error}</p>}
                </div>)}</div>
              </div>
              <div className="rounded-xl border border-[#665632] bg-[#1b2c3f] p-5 text-xs leading-6 text-[#d9c8a7]">{t("Previous test jobs remain available for reference. Use the workflow manager above for new test runs.")}</div>
                </div>
              </details>}
            </div>
          )}

          {section === "Get Started" && <div className="space-y-5">
            <div className="rounded-2xl border border-[#9c8046]/50 bg-[#142539] p-7">
              <h2 className="brand-display text-3xl">{t('Your guided workspace setup')}</h2>
              <p className="mt-2 text-sm text-[#afbdcb]">{t('Follow the steps in order. Each step opens the right page, and you can return here any time. Team invitation is optional.')}</p>
              <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-[#28394b]"><div className="h-full bg-[#c9a552]" style={{width:`${Math.round(guideHandled/6*100)}%`}}/></div>
              <p className="mt-2 text-xs text-[#d9bd7d]">{guideHandled}/6 {t('Review')} · {guideCompleted} {t('Completed')} · {guideSkipped} {t('Skipped')}</p>
              <button type="button" className={`${newButtonClass} mt-4`} onClick={()=>openGuide([1,2,3,4,5,6].find(step=>guideState(step)==='pending')??1)}>{t('Start guided tutorial')}</button>
              {progressError && <p role="alert" className="mt-3 text-xs text-red-300">{progressError}</p>}
            </div>
            <div className="grid gap-3 md:grid-cols-2">{[
              {label:'1. Complete business profile',help:'Company name, currency, language, industry, contact details and hours.'},
              {label:'2. Upload company knowledge and data',help:'Import TXT, CSV, JSON or ZIP, or write information for direct saving.'},
              {label:'3. Products and pricing',help:'Verify the imported catalog or add items manually.'},
              {label:'4. Configure AI Assistant',help:'Assistant name, language preference, role and guidance.'},
              {label:'5. Invite your team (optional)',help:'Add Admin, Staff or Viewer members, or skip.'},
              {label:'6. Review setup',help:'Review each module before enabling client workflows.'},
            ].map((step,i)=>{
              const state=guideState(i+1);
              return <button key={step.label} type="button" onClick={()=>openGuide(i+1)} className="rounded-xl border border-[#35485d] bg-[#142539] p-5 text-left hover:border-[#c9a552]">
                <span className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className={state==='completed'?'text-[#b3ead0]':state==='skipped'?'text-[#e7c37c]':'text-[#71869b]'} size={17}/>{t(step.label)}</span>
                <span className="mt-2 block text-xs text-[#afbdcb]">{t(step.help)}</span>
                <span className="mt-3 block text-xs text-[#e7c37c]">{state==='completed'?t('Completed. Review'):state==='skipped'?t('Skipped. Review'):t('Open step')} →</span>
              </button>
            })}</div>
            <p className="text-xs text-[#e6cc8d]">{t("Test mode: use fictional records until cross-company API and quota security checks pass.")}</p>
          </div>}

          {section === "Service Catalog" && <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#35485d] bg-[#142539] p-6"><div><h2 className="text-lg font-semibold">{/retail|fashion|commerce/i.test(settings.industry) ? "Your products & prices" : "Your services & prices"}</h2><p className="mt-1 text-xs text-[#afbdcb]">{t("Workspace-specific catalog. Your AI can look up active services; quotations still require the existing approval flow.")}</p></div>
              {canManageCatalog && <button type="button" className={newButtonClass} onClick={()=>{setShowServiceForm(v=>!v);setServiceForm({id:"",name:"",description:"",price:"",currency:settings.currency,is_active:true});}}><Plus size={14} className="mr-1 inline"/>{/retail|fashion|commerce/i.test(settings.industry) ? "New product" : "New service"}</button>}</div>
            {serviceError && <p role="alert" className="rounded-lg border border-red-400/40 p-3 text-sm text-[#ffb3a7]">{serviceError}</p>}
            {canManageCatalog && showServiceForm && <form onSubmit={saveService} className="grid gap-3 rounded-2xl border border-[#927b4e] bg-[#142539] p-5 md:grid-cols-2">
              <label className="text-xs text-[#e7c37c]">{/retail|fashion|commerce/i.test(settings.industry) ? "Product name" : "Service name"}<input required minLength={2} maxLength={120} className={`${inputClass} mt-2`} value={serviceForm.name} onChange={e=>setServiceForm({...serviceForm,name:e.target.value})}/></label>
              <label className="text-xs text-[#e7c37c]">{t("Price")}<input type="number" min="0" max="999999999" step="0.01" required className={`${inputClass} mt-2`} value={serviceForm.price} onChange={e=>setServiceForm({...serviceForm,price:e.target.value})}/></label>
              <label className="text-xs text-[#e7c37c]">{t("Currency")}<select className={`${inputClass} mt-2`} value={serviceForm.currency} onChange={e=>setServiceForm({...serviceForm,currency:e.target.value})}>{["EUR","USD","GBP","KES"].map(x=><option key={x}>{x}</option>)}</select></label>
              <label className="flex items-center gap-2 text-xs text-[#e7c37c]"><input type="checkbox" checked={serviceForm.is_active} onChange={e=>setServiceForm({...serviceForm,is_active:e.target.checked})}/>{t("Active service")}</label>
              <label className="text-xs text-[#e7c37c] md:col-span-2">{t("Description")}<textarea maxLength={1000} className={`${inputClass} mt-2 min-h-20`} value={serviceForm.description} onChange={e=>setServiceForm({...serviceForm,description:e.target.value})}/></label>
              <div className="flex gap-2 md:col-span-2"><button disabled={serviceBusy} className={newButtonClass} type="submit">{serviceBusy?"Saving...":serviceForm.id?"Save changes":"Add service"}</button><button type="button" onClick={()=>setShowServiceForm(false)} className="rounded-xl border border-[#526076] px-4 py-2 text-xs">{t("Cancel")}</button></div>
            </form>}
            <div className="grid gap-3 md:grid-cols-2">{services.map(item=><article key={item.id} className="rounded-2xl border border-[#35485d] bg-[#142539] p-5"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold">{item.name}</h3><Tag variant={item.is_active?"emerald":"slate"}>{item.is_active?"Active":"Inactive"}</Tag></div><p className="mt-2 text-lg font-semibold text-[#e4c47b]">{new Intl.NumberFormat("en-GB",{style:"currency",currency:item.currency}).format(Number(item.price))}</p><p className="mt-2 text-xs leading-5 text-[#afbdcb]">{item.description||"No description yet"}</p>{canManageCatalog && <div className="mt-4 flex gap-2"><button type="button" className="rounded-lg border border-[#8b764d] px-3 py-2 text-xs" onClick={()=>{setServiceForm({id:item.id,name:item.name,description:item.description,price:String(item.price),currency:item.currency,is_active:item.is_active});setShowServiceForm(true);}}>{t("Edit")}</button><button type="button" disabled={serviceBusy} className="rounded-lg border border-[#795557] px-3 py-2 text-xs text-[#f3c2b9]" onClick={()=>void removeService(item.id)}>{t("Delete")}</button></div>}</article>)}{services.length===0 && <p className="rounded-2xl border border-[#35485d] bg-[#142539] p-7 text-sm text-[#afbdcb]">{t("No services yet.")} {canManageCatalog?"Add the first service to begin.":"Ask your owner or admin to add services."}</p>}</div>
          </div>}

          {section === "Customers" && <CustomersCRMPanel
            workspaceId={workspace?.id ?? ""}
            companyName={workspace?.name ?? ""}
            industry={settings.industry}
            customers={customers}
            enquiries={enquiries}
            canWrite={canWriteOps}
            canManageImport={canManageCatalog}
            refresh={refresh}
            highlightEnquiryId={highlightEnquiryId}
            onOpenAutomation={isOwner || role === "admin" ? () => navigate("Automation Center") : undefined}
          />}

          {section === "Quotations" && <QuotationsStudio
            workspaceId={workspace?.id ?? ""}
            companyName={workspace?.name ?? ""}
            customers={customers}
            services={services}
            quotes={quotes}
            canWrite={canWriteOps}
            refresh={refresh}
          />}

          {section === "Follow-ups" && <div className="space-y-4">
            {canWriteOps && <div className="flex justify-end"><button type="button" className={newButtonClass} onClick={()=>setShowFollowForm(!showFollowForm)}><Plus size={14} className="mr-1 inline"/>{t("New follow-up")}</button></div>}
            {canWriteOps && showFollowForm && <form onSubmit={addFollowUp} className="grid gap-3 rounded-2xl border border-[#35485d] bg-[#142539] p-5 md:grid-cols-3"><select className={inputClass} required value={followForm.customerId} onChange={e=>setFollowForm({...followForm,customerId:e.target.value})} aria-label="Select customer"><option value="">{t("Select customer")}</option>{customers.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}</select><input className={inputClass} required maxLength={300} placeholder="Follow-up task" aria-label="Follow-up task" value={followForm.title} onChange={e=>setFollowForm({...followForm,title:e.target.value})}/><input className={inputClass} required type="date" aria-label="Due date" value={followForm.date} onChange={e=>setFollowForm({...followForm,date:e.target.value})}/>{isOwner && <select className={inputClass} aria-label="Assign follow-up to a team member" value={followForm.assignedTo} onChange={e=>setFollowForm({...followForm,assignedTo:e.target.value})}><option value="">Unassigned</option>{teamMembers.filter(m=>["owner","admin","staff"].includes(m.role)).map(m=><option key={m.member_user_id} value={m.member_user_id}>{m.email} ({m.role})</option>)}</select>}<button disabled={busy || !customers.length} className={`${newButtonClass} md:col-span-3`}>{t("Save follow-up")}</button></form>}
            <div className="grid gap-4 md:grid-cols-2">{tasks.map(task=><div key={task.id} className="rounded-2xl border border-[#35485d] bg-[#142539] p-6 shadow-sm"><div className="mb-4 flex items-start justify-between gap-3"><div className="text-base font-bold">{customerName(task.customer_id)}</div><Tag variant={task.status==="done"?"emerald":"amber"}>{task.status==="done"?"Completed":task.priority==="high"?"High priority":"Pending"}</Tag></div><p className="text-sm font-medium text-[#f0e9dc]">{task.title}</p><p className="mt-2 text-xs leading-5 text-[#afbdcb]">{t("Due")} {niceDate(task.due_at)}  |  {customerContext(task.customer_id)}</p>{task.source_enquiry_id && <p className="mt-2 text-xs text-[#d7bb78]">AI-routed enquiry ({task.source_intent === "exchange" ? "Exchange" : task.source_intent === "order_status" ? "Order tracking" : "Support"}): {enquiries.find(e=>e.id===task.source_enquiry_id)?.subject || "Review the original request."} <button type="button" className="ml-2 underline" onClick={()=>{setHighlightEnquiryId(task.source_enquiry_id || null);navigate("Customers");}}>View enquiry</button></p>}{isOwner && <div className="mt-3"><label className="text-xs text-[#b9c7d6]" htmlFor={`follow-assignee-${task.id}`}>Assigned to</label><select id={`follow-assignee-${task.id}`} aria-label="Assign follow-up" disabled={busy} className={`${inputClass} mt-1`} value={task.assigned_to || ""} onChange={e=>void assignFollowUp(task.id,e.target.value)}><option value="">Unassigned</option>{teamMembers.filter(m=>["owner","admin","staff"].includes(m.role)).map(m=><option key={m.member_user_id} value={m.member_user_id}>{m.email} ({m.role})</option>)}</select></div>}{canWriteOps && task.status==="pending" && <button type="button" disabled={busy} onClick={()=>completeFollowUp(task.id)} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[#9f7b39] px-3 py-2 text-xs text-[#e1c178] hover:bg-[#304153]"><CheckCircle2 size={15}/>{t("Mark complete")}</button>}</div>)}</div>
            {tasks.length===0 && <p className="rounded-xl border border-[#35485d] p-6 text-sm text-[#afbdcb]">{t("No follow-up tasks yet.")}</p>}
          </div>}

          {section === "Knowledge Base" && workspace && (
            <div className="space-y-5 intrigue-khub">
              {isOwner ? <CompanyOnboarding
                locale={locale}
                workspaceId={workspace.id}
                workspaceName={workspace.name}
                onImported={() => { void refresh(); void loadKnowledge(); void loadServices(); void loadDocuments(); if(guideStep===2){void saveTutorialStep(2,'completed');openGuide(3);} }}
              /> : <section className="rounded-2xl border p-6"><h2 className="font-bold">{t("Company Knowledge (read-only)")}</h2><p className="mt-2 text-sm">{t("Only the company owner can import or update business records.")}</p></section>}
              <section className="rounded-2xl border border-[#35485d] bg-[#142539] p-6">
                <div className="flex items-center gap-2"><BookOpen size={18}/><h3 className="font-semibold">Saved company knowledge ({knowledgeEntries.length})</h3></div>
                {!knowledgeEntries.length && <p className="mt-3 text-sm">{t("No saved entries yet. Upload or type company information above to populate this automatically.")}</p>}
                <div className="mt-4 grid gap-3 md:grid-cols-2">{knowledgeEntries.map(entry => <article key={entry.id} className="intrigue-khub-file rounded-xl border p-4">
                  <p className="text-xs opacity-70">{entry.category}</p><h4 className="mt-2 font-semibold">{entry.title}</h4>
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6">{entry.content}</p>
                  {isOwner && <button type="button" className="intrigue-khub-delete mt-4 rounded-lg border px-3 py-2 text-xs" onClick={() => { void deleteKnowledge(entry.id); }}>{t("Delete")}</button>}
                </article>)}</div>
              </section>
              {documents.length > 0 && <section className="rounded-2xl border border-[#35485d] bg-[#142539] p-6">
                <h3 className="font-semibold">Previously uploaded searchable documents ({documents.length})</h3>
                <p className="mt-2 text-xs">These were uploaded before the automatic importer. They remain available to your knowledge search; uploading a company dataset above creates structured records.</p>
                <div className="mt-3 space-y-2">{documents.map(d => <div key={d.id} className="intrigue-khub-file rounded-xl border p-3 text-xs">{d.filename}</div>)}</div>
              </section>}
            </div>
          )}

          {section === "Calendar" && workspace && isOwner && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-[#35485d] bg-[#142539] p-5">
                <h2 className="text-lg font-semibold text-[#f4efe5]">{t("Calendar & booking")}</h2>
                <p className="mt-2 text-sm text-[#b8c7d4]">Review upcoming appointments, working hours and the booking connections for this company. Provider authorization remains owner-controlled.</p>
              </div>
              <CalendarConnections />
            </div>
          )}
          {section === "Integrations" && workspace && isOwner && <IntegrationsPanel workspaceId={workspace.id} onImported={() => { void refresh(); }} onOpenCalendar={() => navigate("Calendar")} onOpenReceptionist={() => navigate("AI Receptionist")} />}

          {section === "Plans & Billing" && isOwner && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-[#a18343]/55 bg-[#142539] p-6 md:p-8">
                <div className="mb-4 flex items-center gap-3"><CreditCard size={23} className="text-[#e0bf76]"/><h2 className="text-lg font-bold">Plans & Billing  |  Private Preview</h2></div>
                <p className="max-w-3xl text-sm leading-6 text-[#c6d2df]">Explore possible launch tiers and register your company's interest. This preview does not collect payment information, create subscriptions, process invoices, or change your current access or AI request limits.</p>
                <div className="mt-5 flex flex-wrap gap-2"><Tag variant="amber">{t("No charges enabled")}</Tag><Tag variant="slate">{t("No plans activated")}</Tag><Tag variant="blue">{t("Company owner only")}</Tag></div>
                {planLoading && <p role="status" className="mt-4 text-xs text-[#bbcbd8]">{t("Loading your plan interest...")}</p>}
                {planInterest && <p className="mt-5 text-sm text-[#b3ead0]">Interest on file: <strong className="capitalize">{planInterest.requested_tier}</strong>  |  Submitted {niceDate(planInterest.requested_at)}. You can update your interest below.</p>}
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                {PLAN_PREVIEWS.map(plan => <article key={plan.tier} className="flex flex-col rounded-2xl border border-[#3f5064] bg-[#142539] p-6">
                  <div className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-[#c8a65f]">{plan.audience}</div>
                  <h3 className="brand-display text-3xl">{plan.name}</h3>
                  <p className="mt-3 flex-1 text-sm leading-6 text-[#abbccd]">{plan.details}</p>
                  <p className="my-5 border-t border-[#37485b] pt-4 text-xs text-[#d0bc8f]">{t("Pricing by proposal  |  Not yet available for purchase")}</p>
                  <button type="button" disabled={planSaving || planLoading || !workspace} onClick={()=>void savePlanInterest(plan.tier)} className={`${newButtonClass} w-full`}>{planSaving?"Saving...":planInterest?.requested_tier===plan.tier?"Update interest":"Register interest"}</button>
                </article>)}
              </div>
              {planError && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-[#ffc2b9]">{planError}</p>}
              {planSuccess && <p role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-[#b3ead0]">{planSuccess}</p>}
              <div className="rounded-xl border border-[#46576a] bg-[#102234] p-5 text-sm leading-6 text-[#aebfcf]">
                <strong className="text-[#f0d18e]">What this does not do:</strong> Your selection is an expression of interest only. No billing integration, payment provider, invoices, subscription benefits, AI quota changes, or company-wide usage enforcement are activated.
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#46576a] bg-[#142539] p-5">
                <div><h3 className="text-sm font-semibold">{t("Request a guided pilot evaluation")}</h3><p className="mt-2 text-xs leading-5 text-[#aebfcf]">Define your business goal and success criteria for manual review. No automatic trial or subscription.</p></div>
                <button type="button" className={newButtonClass} onClick={()=>navigate("Pilot Application")}>{t("Open pilot application (next)")}</button>
              </div>
              {aiUsage && <p className="text-xs text-[#aebfcf]">AI requests today for this company's owner account: <strong className="text-[#e7c37c]">{aiUsage.chat_today} / {aiUsage.chat_day_limit}</strong>. The limit remains per owner account, not pooled across staff.</p>}
            </div>
          )}

          {section === "Pilot Application" && isOwner && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-[#a18343]/50 bg-[#142539] p-6 md:p-8">
                <div className="mb-3 flex items-center gap-3"><ClipboardCheck className="text-[#e0bf76]" size={24}/><h2 className="text-lg font-bold">{t("Apply for a guided pilot")}</h2></div>
                <p className="max-w-3xl text-sm leading-6 text-[#b7c7d5]">Tell INTRIGUE STUDIOS what you want to evaluate. A submitted request is for discussion only. It does not activate payments, extend AI quotas, enable automation workers or authorize production customer data.</p>
                <div className="mt-4 flex flex-wrap gap-2"><Tag variant="amber">{t("Private preview")}</Tag><Tag variant="blue">{t("Owner only")}</Tag><Tag variant="slate">{t("Manual review")}</Tag></div>
                <div className="mt-5 grid gap-3 text-xs md:grid-cols-3">
                  <div className="rounded-xl border border-[#46586a] bg-[#0e2235] p-3"><strong className="text-[#e7c37c]">1  |  Submitted</strong><p className="mt-1 text-[#b7c7d5]">{t("Your request is stored privately for operator review.")}</p></div>
                  <div className="rounded-xl border border-[#46586a] bg-[#0e2235] p-3"><strong className="text-[#e7c37c]">2  |  Contacted</strong><p className="mt-1 text-[#b7c7d5]">{t("An operator has marked the request for follow-up, not activated service.")}</p></div>
                  <div className="rounded-xl border border-[#46586a] bg-[#0e2235] p-3"><strong className="text-[#e7c37c]">3  |  Closed</strong><p className="mt-1 text-[#b7c7d5]">{t("The review is complete; no billing or trial is started.")}</p></div>
                </div>
                {pilotRequest && <div className="mt-5 rounded-xl border border-[#40566a] bg-[#102234] p-4 text-sm">
                  <p>Current request: <strong className="capitalize text-[#efcd85]">{pilotRequest.status.replaceAll("_"," ")}</strong>  |  First submitted {niceDate(pilotRequest.submitted_at)}</p>
                  {pilotRequest.reviewed_at && <p className="mt-2 text-xs text-[#b7c7d5]">Latest operator review: {niceDate(pilotRequest.reviewed_at)}</p>}
                  {pilotRequest.review_message && <div className="mt-3 rounded-lg border border-[#6f6250]/60 bg-[#152d3e] p-3 text-sm text-[#f5dfb2]">
                    <strong className="mb-1 block text-xs uppercase tracking-widest text-[#dfbf7b]">Message from INTRIGUE STUDIOS</strong>
                    <p className="whitespace-pre-wrap break-words">{pilotRequest.review_message}</p>
                  </div>}
                  <p className="mt-3 text-xs text-[#b7c7d5]">An operator sets this status manually. Neither "contacted" nor "closed" activates a trial, subscription, payment, or higher AI limits.</p>
                  <button type="button" onClick={()=>void loadPilotRequest()} disabled={pilotLoading} className="mt-3 rounded-lg border border-[#997b45] px-4 py-2 text-xs font-semibold text-[#e7c37c] disabled:opacity-50">{pilotLoading?"Refreshing...":"Refresh application status"}</button>
                </div>}
              </div>
              <form onSubmit={submitPilotRequest} className="rounded-2xl border border-[#35485d] bg-[#142539] p-6 md:p-8">
                <h3 className="mb-5 text-sm font-semibold">{t("Your evaluation request")}</h3>
                <fieldset disabled={pilotSaving || pilotLoading || (!!pilotRequest && pilotRequest.status!=="submitted")} className="grid gap-4 md:grid-cols-2 disabled:opacity-65">
                  <label className="text-xs font-medium text-[#e6c17b]">{t("Contact name")}
                    <input required minLength={2} maxLength={100} autoComplete="name" className={`${inputClass} mt-2`} value={pilotForm.contact_name} onChange={e=>setPilotForm(v=>({...v,contact_name:e.target.value}))}/>
                  </label>
                  <label className="text-xs font-medium text-[#e6c17b]">{t("Business contact email")}
                    <input required type="email" maxLength={254} autoComplete="email" className={`${inputClass} mt-2`} value={pilotForm.contact_email} onChange={e=>setPilotForm(v=>({...v,contact_email:e.target.value}))}/>
                  </label>
                  <label className="text-xs font-medium text-[#e6c17b]">{t("Expected team size")}
                    <input required type="number" min={1} max={1000} step={1} className={`${inputClass} mt-2`} value={pilotForm.estimated_seats} onChange={e=>setPilotForm(v=>({...v,estimated_seats:Number(e.target.value)}))}/>
                  </label>
                  <label className="text-xs font-medium text-[#e6c17b]">{t("Preferred start date (optional)")}
                    <input type="date" className={`${inputClass} mt-2`} value={pilotForm.preferred_start} onChange={e=>setPilotForm(v=>({...v,preferred_start:e.target.value}))}/>
                  </label>
                  <label className="text-xs font-medium text-[#e6c17b] md:col-span-2">{t("What would you like to automate or improve?")}
                    <textarea required minLength={20} maxLength={1200} rows={4} className={`${inputClass} mt-2 resize-y`} placeholder="Describe a fictional or non-sensitive example workflow..." value={pilotForm.intended_use} onChange={e=>setPilotForm(v=>({...v,intended_use:e.target.value}))}/>
                  </label>
                  <label className="text-xs font-medium text-[#e6c17b] md:col-span-2">{t("How would you measure success?")}
                    <textarea required minLength={10} maxLength={800} rows={3} className={`${inputClass} mt-2 resize-y`} placeholder="For example: reduce manual follow-up work during a controlled demo..." value={pilotForm.success_criteria} onChange={e=>setPilotForm(v=>({...v,success_criteria:e.target.value}))}/>
                  </label>
                  <label className="text-xs font-medium text-[#e6c17b] md:col-span-2">{t("Additional notes (optional)")}
                    <textarea maxLength={500} rows={2} className={`${inputClass} mt-2 resize-y`} value={pilotForm.request_notes} onChange={e=>setPilotForm(v=>({...v,request_notes:e.target.value}))}/>
                  </label>
                </fieldset>
                {pilotError && <p role="alert" className="mt-4 rounded-lg border border-red-400/40 p-3 text-xs text-[#ffb3a7]">{pilotError}</p>}
                {pilotSuccess && <p role="status" className="mt-4 rounded-lg border border-emerald-400/30 p-3 text-xs text-[#b3ead0]">{pilotSuccess}</p>}
                {pilotLoading && <p role="status" className="mt-4 text-xs text-[#b7c7d5]">{t("Loading your request...")}</p>}
                {pilotRequest && pilotRequest.status!=="submitted" && <p className="mt-4 text-xs text-[#e7c37c]">{t("This request is already in review or closed; contact INTRIGUE STUDIOS to make changes.")}</p>}
                <button type="submit" disabled={pilotSaving || pilotLoading || (!!pilotRequest && pilotRequest.status!=="submitted")} className={`${newButtonClass} mt-5`}>{pilotSaving?"Saving...":pilotRequest?"Update submitted request":"Submit pilot request"}</button>
                <p className="mt-4 text-xs leading-5 text-[#b7c7d5]">For staging, use fictional use cases only. This form does not send an email automatically or start a pilot.</p>
              </form>
            </div>
          )}

          {section === "Security & Usage" && isOwner && <div className="space-y-5">
            <div className="rounded-2xl border border-[#997b45]/50 bg-[#142539] p-6 md:p-8">
              <div className="flex items-center gap-3"><ShieldCheck size={24} className="text-[#e1bd72]"/><h2 className="text-lg font-bold">{t("AI usage and safeguards")}</h2></div>
              <p className="mt-3 text-sm leading-6 text-[#b7c7d5]">These are request allowances for the signed-in owner, not billing amounts or model-token costs. All limits are enforced atomically by Supabase before contacting the AI provider.</p>
              <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={()=>void loadAiUsage()} disabled={usageBusy} className="rounded-lg border border-[#967b48] px-4 py-2 text-xs font-semibold text-[#e7c37c] disabled:opacity-50">{usageBusy?"Refreshing...":"Refresh usage"}</button><Tag variant="amber">Staging  |  No real client data</Tag></div>
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
              <h3 className="text-sm font-bold">{t("Launch security gates")}</h3>
              <div className="mt-4 space-y-3 text-xs leading-6 text-[#bccbd9]">
                <p>- Database access controls: configuration and interface tests have been performed; continued verification is required.</p>
                <p>- Cross-company isolation: validate denied reads and writes with dedicated staging accounts.</p>
                <p>- Quota rejection: use the no-provider-call rollback test. A displayed usage counter alone does not prove rejection.</p>
                <p>- Production: confirm data retention, backups, provider processing agreements and real API-session authorization before accepting client data.</p>
              </div>
            </div>
          </div>}

          {section === "Settings" && <div className="space-y-5">
            <AccountDeletionPanel />
            <div className="rounded-2xl border border-[#35485d] bg-[#142539] p-7 shadow-sm">
              <div className="flex items-center gap-3"><Settings className="text-[#e0bf76]" size={22}/><h2 className="text-lg font-bold">{t("Company & assistant setup")}</h2></div>
              <p className="mt-2 text-sm text-[#afbdcb]">{t("Configure your business identity, service hours and AI preferences. All data stays in your workspace.")}</p>
              <div className="mt-4 text-xs text-[#b3ead0]">Workspace: {workspace.name}  |  Your access: {role}</div>
              {!isOwner ? <p className="mt-5 rounded-xl border border-[#526076] p-4 text-sm text-[#afbdcb]">{t("Team members have read-only access. Ask the company owner to change these settings.")}</p> :
              <form onSubmit={saveSettings} className="mt-6 space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-xs text-[#e7c37c]">{t("Company name")}<input className={`${inputClass} mt-2`} value={companyEditName} maxLength={100} minLength={2} required onChange={e=>setCompanyEditName(e.target.value)}/></label>
                  <label className="text-xs text-[#e7c37c]">{t("Industry")}<select className={`${inputClass} mt-2`} value={settings.industry} onChange={e=>setSettings({...settings,industry:e.target.value})}>{["Automotive","Real Estate","Retail","Hospitality","Healthcare","Professional Services","Technology","Logistics","Other"].map(x=><option key={x}>{x}</option>)}</select></label>
                  <label className="text-xs text-[#e7c37c]">{t("Business email")}<input className={`${inputClass} mt-2`} type="email" maxLength={254} value={settings.contact_email} onChange={e=>setSettings({...settings,contact_email:e.target.value})}/></label>
                  <label className="text-xs text-[#e7c37c]">{t("Telephone")}<input className={`${inputClass} mt-2`} maxLength={60} value={settings.phone} onChange={e=>setSettings({...settings,phone:e.target.value})}/></label>
                  <label className="text-xs text-[#e7c37c]">{t("Website")}<input className={`${inputClass} mt-2`} maxLength={255} placeholder="https://example.com" value={settings.website} onChange={e=>setSettings({...settings,website:e.target.value})}/></label>
                  <label className="text-xs text-[#e7c37c]">{t("Business timezone")}<select className={`${inputClass} mt-2`} value={settings.timezone} onChange={e=>setSettings({...settings,timezone:e.target.value})}>{["Europe/Berlin","Europe/London","Africa/Nairobi","America/New_York","America/Los_Angeles","UTC"].map(x=><option key={x}>{x}</option>)}</select></label>
                  <label className="text-xs text-[#e7c37c]">{t("Currency")}<select className={`${inputClass} mt-2`} value={settings.currency} onChange={e=>setSettings({...settings,currency:e.target.value})}>{["EUR","USD","GBP","KES"].map(x=><option key={x}>{x}</option>)}</select></label>
                  <label className="text-xs text-[#e7c37c]">{t("Preferred customer communication language")}<select className={`${inputClass} mt-2`} value={settings.preferred_language} onChange={e=>setSettings({...settings,preferred_language:e.target.value})}>{COMPANY_LANGUAGES.map(([code,label])=><option key={code} value={code}>{label}</option>)}</select><span className="mt-1 block text-[11px] opacity-70">{t("The selected language applies to your workspace and AI. Some specialist screens are not translated yet.")}</span></label>
                  <label className="text-xs text-[#e7c37c]">{t("Business hours")}<input className={`${inputClass} mt-2`} maxLength={350} placeholder="Mon-Fri 09:00-18:00" value={settings.business_hours} onChange={e=>setSettings({...settings,business_hours:e.target.value})}/></label>
                </div>
                <label className="block text-xs text-[#e7c37c]">{t("What does your company do?")}<textarea className={`${inputClass} mt-2 min-h-24`} maxLength={1000} value={settings.description} onChange={e=>setSettings({...settings,description:e.target.value})}/></label>
                <div id="intrigue-ai-config" className="scroll-mt-32 border-t border-[#35485d] pt-5">
                  <h3 className="flex items-center gap-2 text-base font-bold"><Bot size={18} className="text-[#d9bd7d]"/>{t("AI Assistant configuration")}</h3>
                  <p className="mt-1 text-xs text-[#afbdcb]">These preferences are included in the owner AI agent's system context. Security limits, tool permissions and human approval are unchanged.</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="text-xs text-[#e7c37c]">{t("Assistant name")}<input className={`${inputClass} mt-2`} minLength={2} maxLength={80} value={settings.ai_name} onChange={e=>setSettings({...settings,ai_name:e.target.value})}/></label>
                    <label className="text-xs text-[#e7c37c]">{t("Communication style")}<select className={`${inputClass} mt-2`} value={settings.ai_tone} onChange={e=>setSettings({...settings,ai_tone:e.target.value})}>{["Professional","Friendly","Concise","Formal"].map(x=><option key={x}>{x}</option>)}</select></label>
                    <label className="text-xs text-[#e7c37c] sm:col-span-2">{t("Business role")}<input className={`${inputClass} mt-2`} maxLength={160} minLength={4} value={settings.ai_role} onChange={e=>setSettings({...settings,ai_role:e.target.value})}/></label>
                  </div>
                  <label className="mt-4 block text-xs text-[#e7c37c]">{t("Additional assistant guidance")}<textarea className={`${inputClass} mt-2 min-h-24`} maxLength={1000} placeholder="Preferred terminology and response style. Do not include secrets or private customer information." value={settings.ai_guidance} onChange={e=>setSettings({...settings,ai_guidance:e.target.value})}/></label>
                </div>
                {settingsError && <p role="alert" className="text-xs text-[#ffb3a7]">{settingsError}</p>}
                {settingsMessage && <p role="status" className="text-xs text-[#b1ead0]">{settingsMessage}</p>}
                <button type="submit" disabled={settingsBusy} className={newButtonClass}>{t(settingsBusy?"Saving...":"Save company & AI settings")}</button>
              </form>}
            </div>
            <div className="rounded-2xl border border-[#35485d] bg-[#142539] p-6">
              <h3 className="text-base font-semibold">{t("Onboarding checklist")}</h3>
              <p className="mt-1 text-xs text-[#afbdcb]">{t("Follow these steps before activating client-facing workflows.")}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  ["Create company",true],["Configure business profile",Boolean(settings.description.trim()&&settings.business_hours.trim())],
                  ["Add services and pricing",services.length>0],["Add company knowledge",knowledgeEntries.length>0||documents.length>0],["Review AI preferences",Boolean(settings.ai_role.trim())],
                  ["Invite staff (optional)",teamMembers.length>1],["Pass production security tests",false],
                ].map(([label,done])=><div key={String(label)} className="flex items-center gap-2 rounded-lg border border-[#35485d] p-3 text-xs"><CheckCircle2 size={16} className={done?"text-[#b3ead0]":"text-[#708093]"}/>{t(String(label))}</div>)}
              </div>
              <button type="button" onClick={()=>navigate("Get Started")} className="mt-4 rounded-lg border border-[#937b48] px-3 py-2 text-xs text-[#e7c37c]">{t("Open guided setup")}</button>
            </div>
          </div>}

          {section === "Team" && <div className="space-y-5">
            <div className="rounded-2xl border border-[#35485d] bg-[#142539] p-7">
              <div className="flex items-center gap-3"><UserPlus className="text-[#e0bf76]" size={22}/><h2 className="text-lg font-bold">{t("Team members")}</h2></div>
              <p className="mt-2 text-sm leading-6 text-[#afbdcb]">{t("Invite colleagues as Admin, Staff or Viewer. Admins manage services; Staff can add enquiries and follow-ups; Viewers only read. AI, actions, settings and invitations remain owner-only.")}</p>
              {!isOwner ? <p className="mt-5 text-sm text-[#b3ead0]">Your role is {role}. Only the workspace owner manages invitations and roles.</p> : <>
                <form onSubmit={createInvite} className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <input className={inputClass} type="email" placeholder="colleague@company.com" aria-label="Team member email" required maxLength={254} value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)}/>
                  <select className={`${inputClass} sm:max-w-40`} aria-label="Invitation role" value={selectedInviteRole} onChange={e=>setSelectedInviteRole(e.target.value as "admin"|"staff"|"viewer")}><option value="viewer">{t("Viewer")}</option><option value="staff">{t("Staff")}</option><option value="admin">{t("Admin")}</option></select>
                  <button className={newButtonClass} type="submit" disabled={teamBusy}>{teamBusy?"Creating...":"Create invitation link"}</button>
                </form>
                {inviteLink && <div className="mt-4 rounded-xl border border-[#937b48] bg-[#17293d] p-4">
                  <p className="mb-2 text-xs font-semibold text-[#e7c37c]">{t("Copy this link now. It is shown only once.")}</p>
                  <p className="break-all text-xs text-[#d5dfeb]">{inviteLink}</p>
                  <button type="button" onClick={()=>void navigator.clipboard.writeText(inviteLink)} className="mt-3 rounded-lg bg-[#c9a552] px-3 py-2 text-xs font-semibold text-[#111b29]">{t("Copy invitation")}</button>
                  <p className="mt-2 text-[11px] text-[#afbdcb]">{t("Share it only with the invited person. They must verify the exact invited email, sign in, then open this link and accept.")}</p>
                </div>}
                {teamError && <p role="alert" className="mt-4 text-sm text-[#ffb3a7]">{teamError}</p>}
                {teamMessage && <p role="status" className="mt-4 text-xs text-[#b3ead0]">{teamMessage}</p>}
                <h3 className="mt-7 text-sm font-bold">{t("Active members")}</h3>
                <div className="mt-3 space-y-2">{teamMembers.map(m=><div key={m.member_user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#35485d] bg-[#102034] p-4">
                  <div><p className="text-sm font-semibold">{m.email}</p><p className="mt-1 text-xs text-[#afbdcb]">{m.role}  |  Joined {niceDate(m.joined_at)}</p></div>
                  {m.role!=="owner" && <div className="flex items-center gap-2"><select aria-label={`Role for ${m.email}`} disabled={teamBusy} className="rounded-lg border border-[#526076] bg-[#182c41] px-2 py-2 text-xs" value={m.role==="member"?"viewer":m.role} onChange={e=>void updateTeamRole(m.member_user_id,e.target.value as "admin"|"staff"|"viewer")}><option value="viewer">{t("Viewer")}</option><option value="staff">{t("Staff")}</option><option value="admin">{t("Admin")}</option></select><button type="button" disabled={teamBusy} onClick={()=>void removeMember(m.member_user_id)} className="rounded-lg border border-[#795557] px-3 py-2 text-xs text-[#f3c2b9]">{t("Remove access")}</button></div>}
                </div>)}</div>
                <h3 className="mt-7 text-sm font-bold">{t("Pending invitations")}</h3>
                {teamInvites.length===0 && <p className="mt-3 text-xs text-[#afbdcb]">{t("No pending invitations.")}</p>}
                <div className="mt-3 space-y-2">{teamInvites.map(i=><div key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#35485d] bg-[#102034] p-4">
                  <div><p className="text-sm font-semibold">{i.invited_email}</p><p className="mt-1 text-xs text-[#afbdcb]">{i.role}  |  Expires {niceDate(i.expires_at)}</p></div>
                  <button type="button" disabled={teamBusy} onClick={()=>void revokeInvite(i.id)} className="rounded-lg border border-[#795557] px-3 py-2 text-xs text-[#f3c2b9]">{t("Revoke")}</button>
                </div>)}</div>
                <div className="mt-8 rounded-xl border border-[#35485d] bg-[#102034] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-[#f3d18e]">{t("Membership activity")}</h3>
                    <button type="button" onClick={()=>void loadTeamAudit()} className="rounded-lg border border-[#937b48] px-3 py-2 text-xs text-[#e7c37c]">{t("Refresh history")}</button>
                  </div>
                  <p className="mt-2 text-xs text-[#afbdcb]">{t("Owner-only audit trail. Earlier events may not appear here.")}</p>
                  {teamAuditError && <p role="alert" className="mt-3 text-xs text-[#ffb3a7]">{teamAuditError}</p>}
                  {!teamAuditError && teamAudit.length===0 && <p className="mt-4 text-xs text-[#afbdcb]">{t("No membership changes recorded yet.")}</p>}
                  <div className="mt-3 space-y-2">{teamAudit.map((event,i)=><div key={`${event.event_at}-${i}`} className="rounded-lg border border-[#35485d] p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2"><strong>{event.event_type==="role_changed"?"Role changed":event.event_type==="removed"?"Access removed":"Member joined"}</strong><span className="text-[#afbdcb]">{new Date(event.event_at).toLocaleString()}</span></div>
                    <p className="mt-1 break-all">{event.member_email}{event.old_role||event.new_role?`  |  ${event.old_role||"none"}  -> ${event.new_role||"none"}`:""}</p>
                    <p className="mt-1 break-all text-[#afbdcb]">{t("By:")} {event.actor_email}</p>
                  </div>)}</div>
                </div>
              </>}
            </div>
          </div>}

          </>}

          <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#9eacba]"><span>(c) 2026 INTRIGUE STUDIOS  |  Engineered intelligence</span><span>Demo records in Supabase - Chat read-only - Approved drafts only</span></footer>
        </main>
      </div>
    </div>
  );
}

