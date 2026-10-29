import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight, BookOpen, CheckCheck, ClipboardList,
  LockKeyhole, ShieldCheck, Users, Workflow,
} from "lucide-react";

export const metadata: Metadata = {
  title: "INTRIGUE Operations AI | Private Preview",
  description: "Company operations, knowledge, approvals and team permissions in one workspace. Private staging preview.",
};

const features = [
  {
    title: "One workspace per business",
    text: "Keep customer enquiries, draft quotations, follow-ups and service records together.",
    Icon: ClipboardList,
  },
  {
    title: "Grounded AI assistance",
    text: "Ask about your workspace and uploaded knowledge. Proposed business actions require approval.",
    Icon: BookOpen,
  },
  {
    title: "Team access by role",
    text: "Invite colleagues and control which workflows each role can view or manage.",
    Icon: Users,
  },
  {
    title: "Designed with safeguards",
    text: "Workspace-level access rules, request quotas and membership event history.",
    Icon: LockKeyhole,
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#091522] text-[#f5f0e6]">
      <div className="pointer-events-none absolute left-0 right-0 top-0 h-[680px] overflow-hidden" aria-hidden="true">
        <div className="absolute -right-32 -top-64 h-[700px] w-[700px] rounded-full border-[110px] border-[#caa75f]/[0.055]" />
        <div className="absolute right-40 top-36 h-[350px] w-[350px] rounded-full border-[70px] border-[#caa75f]/[0.05]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-10">
        <header className="flex items-center justify-between gap-4 border-b border-[#c9ab71]/20 py-6">
          <Link href="/" className="flex items-center gap-3" aria-label="INTRIGUE Operations AI home">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[#c9ab71]/60 text-xl text-[#e3c789]">Ⅰ</span>
            <span className="flex flex-col leading-tight">
              <span className="font-serif text-xl tracking-[0.14em]">INTRIGUE</span>
              <span className="text-[9px] font-bold tracking-[0.26em] text-[#d7b36a]">OPERATIONS AI</span>
            </span>
          </Link>
          <nav className="flex items-center gap-3 sm:gap-5" aria-label="Main navigation">
            <Link href="/auth/login" className="text-sm text-[#dfd9ce] hover:text-white">Sign in</Link>
            <Link href="/auth/sign-up" className="rounded-lg bg-[#c9a552] px-4 py-2.5 text-xs font-bold text-[#111b29] hover:bg-[#e6c77d]">Enter private preview</Link>
          </nav>
        </header>

        <section className="grid gap-10 py-20 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] lg:items-center lg:py-28">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#b49454]/50 bg-[#b49454]/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#e5c77f]">
              <ShieldCheck size={15} /> Private preview · Staging
            </div>
            <h1 className="max-w-3xl font-serif text-[clamp(3.1rem,6.6vw,6.4rem)] leading-[1.04] tracking-[-0.045em]">
              Your business.<br/><span className="text-[#dfbd79]">In focus.</span>
            </h1>
            <p className="mt-7 max-w-xl text-base leading-8 text-[#bac5d0]">
              Customers, knowledge, service pricing, team roles and AI-assisted operations, designed to live in one company workspace.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/auth/sign-up" className="inline-flex items-center gap-2 rounded-xl bg-[#c9a552] px-6 py-3.5 text-sm font-bold text-[#101b28] hover:bg-[#e3c177]">
                Explore staging <ArrowRight size={17}/>
              </Link>
              <Link href="/auth/login" className="inline-flex items-center gap-2 rounded-xl border border-[#526279] px-6 py-3.5 text-sm font-semibold hover:bg-[#203348]">Sign in to your workspace</Link>
            </div>
            <p className="mt-5 max-w-xl text-xs leading-5 text-[#d1b886]">For fictional test data only. No live customer processing, payments or automatic external messaging is enabled in this preview.</p>
          </div>
          <div className="rounded-[26px] border border-[#9d824d]/50 bg-[linear-gradient(145deg,#183047,#0d1d2d)] p-6 shadow-2xl lg:p-8">
            <div className="mb-6 flex items-center justify-between text-sm"><span className="font-semibold text-[#d9c18c]">OPERATIONS AT A GLANCE</span><span className="rounded-full bg-[#ba9b5a]/15 px-3 py-1 text-[10px] text-[#f0cd7f]">Preview</span></div>
            {[{name:"Customer enquiries",Icon:ClipboardList},{name:"Company knowledge",Icon:BookOpen},{name:"Human approvals",Icon:CheckCheck},{name:"Team roles",Icon:Users}].map(({name,Icon}) => (
              <div key={name} className="mb-3 flex items-center justify-between rounded-xl border border-[#405367] bg-[#1d344a]/70 px-4 py-4">
                <span className="flex items-center gap-3 text-sm"><Icon size={18} className="text-[#dfc07a]"/>{name}</span><ShieldCheck size={16} className="text-[#77baa2]"/>
              </div>
            ))}
            <p className="mt-6 text-xs leading-6 text-[#9bb0c1]">A shared operations hub with permissions at every step. No customer-facing automations run by themselves in this preview.</p>
          </div>
        </section>

        <section className="border-t border-[#c9ab71]/20 py-16" aria-labelledby="built-for-ops">
          <div className="mb-10 flex items-start gap-3"><Workflow className="mt-1 text-[#c9a552]"/><div><h2 id="built-for-ops" className="font-serif text-3xl md:text-4xl">Clarity, across every workflow.</h2><p className="mt-2 text-sm text-[#aebfcf]">Start with the systems your business already needs.</p></div></div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {features.map(({title,text,Icon}) => <article key={title} className="rounded-2xl border border-[#3e5063] bg-[#132639] p-6"><Icon size={24} className="mb-5 text-[#ddbc7b]"/><h3 className="font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-[#aebfcf]">{text}</p></article>)}
          </div>
        </section>

        <section className="mb-14 flex flex-col gap-6 rounded-2xl border border-[#9b7e45]/35 bg-[#142638] p-7 md:flex-row md:items-center md:justify-between md:p-10">
          <div><div className="text-xs font-bold uppercase tracking-[0.2em] text-[#d2b273]">Early access</div><h2 className="mt-2 font-serif text-3xl">Built for a better operating day.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-[#aebfcf]">Plans and billing are being prepared. No subscription is charged or activated in the current preview.</p></div>
          <Link href="/auth/sign-up" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[#c5a45e] px-5 py-3 text-sm font-semibold text-[#edcd8d] hover:bg-[#2c3d4d]">Explore the preview <ArrowRight size={16}/></Link>
        </section>
        <footer className="flex flex-wrap justify-between gap-3 border-t border-[#c9ab71]/20 py-7 text-xs text-[#9eacba]"><span>© 2026 INTRIGUE STUDIOS</span><span>Private staging preview · Not a paid product offer</span></footer>
      </div>
    </main>
  );
}
