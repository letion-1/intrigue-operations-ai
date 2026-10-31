'use client';

import { useMemo, useState } from 'react';

export type ReceptionistCall = {
  id: string;
  caller_number: string | null;
  direction: 'inbound' | 'outbound' | 'web' | 'unknown';
  call_status: string;
  outcome: string;
  started_at: string | null;
  duration_seconds: number | null;
  summary: string | null;
  transcript: string | null;
  recording_available: boolean;
};

type Props = { calls: ReceptionistCall[]; loading?: boolean; error?: string | null };
const fmtDuration = (seconds: number | null) => seconds == null ? '—' : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2,'0')}s`;

export default function ReceptionistPanel({calls,loading=false,error=null}: Props) {
  const [tab,setTab] = useState<'overview'|'history'|'dial'|'settings'>('overview');
  const [query,setQuery] = useState('');
  const [selected,setSelected] = useState<string | null>(null);
  const [number,setNumber] = useState('');
  const matches = useMemo(()=>calls.filter(c=>`${c.caller_number??''} ${c.outcome} ${c.summary??''}`.toLowerCase().includes(query.toLowerCase())),[calls,query]);
  const active = matches.find(c=>c.id===selected) ?? matches[0];
  const completed = calls.filter(c=>c.call_status==='ended').length;
  const booked = calls.filter(c=>c.outcome==='booked').length;
  const missed = calls.filter(c=>c.outcome==='missed').length;
  return <section className="space-y-5 p-5" aria-label="AI Receptionist control center">
    <header><h1 className="text-2xl font-semibold">AI Receptionist</h1><p className="text-sm text-neutral-500">Call operations and history for your company</p></header>
    <nav className="flex flex-wrap gap-2" aria-label="Receptionist tabs">{(['overview','history','dial','settings'] as const).map(t=><button key={t} onClick={()=>setTab(t)} className={`rounded-lg border px-3 py-2 text-sm ${tab===t?'border-amber-500':'border-neutral-500/30'}`}>{({overview:'Overview',history:'Call History',dial:'Dial Pad',settings:'Settings'})[t]}</button>)}</nav>
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {loading && <p role="status">Loading calls…</p>}
    {tab==='overview' && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[['Total calls',calls.length],['Completed calls',completed],['Booked appointments',booked],['Missed calls',missed]].map(([label,value])=><div key={label} className="rounded-xl border border-neutral-500/30 p-4"><p className="text-sm opacity-70">{label}</p><p className="text-2xl font-semibold">{value}</p></div>)}</div>}
    {tab==='history' && <div className="space-y-3"><label className="block text-sm">Search call history<input aria-label="Search call history" value={query} onChange={e=>setQuery(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-500/50 bg-transparent p-2" placeholder="Phone, outcome or summary" /></label><div className="grid gap-4 md:grid-cols-2"><div className="space-y-2">{matches.length===0 ? <p>No matching calls</p> : matches.map(c=><button key={c.id} onClick={()=>setSelected(c.id)} className="w-full rounded-lg border border-neutral-500/30 p-3 text-left"><div className="flex justify-between gap-2"><strong>{c.caller_number || 'Unknown caller'}</strong><span className="text-xs">{c.outcome}</span></div><p className="text-xs opacity-70">{c.started_at ? new Date(c.started_at).toLocaleString():'Unknown date'} · {fmtDuration(c.duration_seconds)} · {c.direction}</p></button>)}</div>{active && <article className="rounded-xl border border-neutral-500/30 p-4"><h2 className="font-semibold">Call details</h2><p className="my-2 text-sm">{active.summary ?? 'No summary available.'}</p><h3 className="font-semibold">Transcript</h3><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{active.transcript ?? 'No transcript available or permitted.'}</pre><p className="mt-3 text-xs opacity-70">Recording: {active.recording_available?'Available to authorized playback integration':'Not available'}</p></article>}</div></div>}
    {tab==='dial' && <div className="max-w-sm space-y-3"><p className="text-sm text-amber-600">Outbound calling is disabled until phone-number capability, owner permissions, consent policy and billing safeguards are verified.</p><label className="block text-sm">Phone number<input value={number} onChange={e=>setNumber(e.target.value)} placeholder="+49…" className="mt-1 w-full rounded-lg border border-neutral-500/50 bg-transparent p-3" /></label><div className="grid grid-cols-3 gap-2">{'123456789*0#'.split('').map(d=><button key={d} onClick={()=>setNumber(n=>n+d)} className="rounded-lg border border-neutral-500/40 p-3">{d}</button>)}</div><button onClick={()=>setNumber(n=>n.slice(0,-1))} className="rounded-lg border px-4 py-2">Delete</button><button disabled className="ml-2 rounded-lg bg-neutral-500 px-4 py-2 opacity-40">Call with Ava (coming soon)</button></div>}
    {tab==='settings' && <div className="rounded-xl border border-neutral-500/30 p-4"><h2 className="font-semibold">Receptionist settings</h2><p className="mt-2 text-sm">Assistant connection, recording retention and outbound permissions will be configured after existing INTRIGUE integrations and roles are verified.</p></div>}
  </section>;
}
