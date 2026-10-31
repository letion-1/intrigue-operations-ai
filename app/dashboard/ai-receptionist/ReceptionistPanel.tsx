'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

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

type Props = { workspaceId: string };
const fmtDuration = (seconds: number | null) => seconds == null ? '—' : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2,'0')}s`;

export default function ReceptionistPanel({workspaceId}: Props) {
  const [calls,setCalls] = useState<ReceptionistCall[]>([]);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const db = useMemo(() => createClient(), []);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    const {data,error:readError} = await db.from('intrigue_receptionist_calls')
      .select('id,caller_number,direction,call_status,outcome,started_at,duration_seconds,summary,transcript,recording_available')
      .eq('workspace_id',workspaceId).order('started_at',{ascending:false}).limit(100);
    if (readError) {setCalls([]);setError('Call history is not ready: '+readError.message);}
    else setCalls((data ?? []) as ReceptionistCall[]);
    setLoading(false);
  },[db,workspaceId]);
  useEffect(()=>{ void refresh(); },[refresh]);
  const [tab,setTab] = useState<'overview'|'history'|'dial'|'settings'>('overview');
  const [query,setQuery] = useState('');
  const [selected,setSelected] = useState<string | null>(null);
  const [number,setNumber] = useState('');
  const matches = useMemo(()=>calls.filter(c=>`${c.caller_number??''} ${c.outcome} ${c.summary??''}`.toLowerCase().includes(query.toLowerCase())),[calls,query]);
  const active = matches.find(c=>c.id===selected) ?? matches[0];
  const completed = calls.filter(c=>c.call_status==='ended').length;
  const booked = calls.filter(c=>c.outcome==='booked').length;
  const missed = calls.filter(c=>c.outcome==='missed').length;
  return <section className="space-y-5 rounded-2xl border border-[#304153] bg-[#102236] p-5 text-[#f2efe8]" aria-label="AI Receptionist control center">
    <header><h1 className="text-2xl font-semibold">AI Receptionist</h1><p className="text-sm text-[#afbdcb]">Call operations and history for your company</p></header>
    <nav className="flex flex-wrap gap-2" aria-label="Receptionist tabs">{(['overview','history','dial','settings'] as const).map(t=><button key={t} onClick={()=>setTab(t)} className={`rounded-lg border px-3 py-2 text-sm ${tab===t?'border-[#d1ad60] bg-[#d1ad60]/15 text-[#f1cb75]':'border-[#34485c]'}`}>{({overview:'Overview',history:'Call History',dial:'Dial Pad',settings:'Settings'})[t]}</button>)}</nav>
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {loading && <p role="status">Loading calls…</p>}
    <button type="button" onClick={()=>void refresh()} className="rounded-lg border border-[#c5a25b] px-3 py-2 text-xs text-[#efd18e]">Refresh call history</button>
    <p className="text-xs text-[#aebfd0]">Only records saved in your company workspace are shown. Historical Vapi calls are not imported yet.</p>
    {tab==='overview' && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[['Total calls',calls.length],['Completed calls',completed],['Booked appointments',booked],['Missed calls',missed]].map(([label,value])=><div key={label} className="rounded-xl border border-[#34485c] bg-[#142b40] p-4"><p className="text-sm opacity-70">{label}</p><p className="text-2xl font-semibold">{value}</p></div>)}</div>}
    {tab==='history' && <div className="space-y-3"><label className="block text-sm">Search call history<input aria-label="Search call history" value={query} onChange={e=>setQuery(e.target.value)} className="mt-1 w-full rounded-lg border border-[#40556b] bg-transparent p-2" placeholder="Phone, outcome or summary" /></label><div className="grid gap-4 md:grid-cols-2"><div className="space-y-2">{matches.length===0 ? <p>No matching calls</p> : matches.map(c=><button key={c.id} onClick={()=>setSelected(c.id)} className="w-full rounded-lg border border-[#34485c] p-3 text-left"><div className="flex justify-between gap-2"><strong>{c.caller_number || 'Unknown caller'}</strong><span className="text-xs">{c.outcome}</span></div><p className="text-xs opacity-70">{c.started_at ? new Date(c.started_at).toLocaleString():'Unknown date'} · {fmtDuration(c.duration_seconds)} · {c.direction}</p></button>)}</div>{active && <article className="rounded-xl border border-[#34485c] bg-[#142b40] p-4"><h2 className="font-semibold">Call details</h2><p className="my-2 text-sm">{active.summary ?? 'No summary available.'}</p><h3 className="font-semibold">Transcript</h3><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{active.transcript ?? 'No transcript available or permitted.'}</pre><p className="mt-3 text-xs opacity-70">Recording: {active.recording_available?'Available to authorized playback integration':'Not available'}</p></article>}</div></div>}
    {tab==='dial' && <div className="max-w-sm space-y-3"><p className="text-sm text-amber-600">Outbound calling is disabled until phone-number capability, owner permissions, consent policy and billing safeguards are verified.</p><label className="block text-sm">Phone number<input value={number} onChange={e=>setNumber(e.target.value)} placeholder="+49…" className="mt-1 w-full rounded-lg border border-[#40556b] bg-transparent p-3" /></label><div className="grid grid-cols-3 gap-2">{'123456789*0#'.split('').map(d=><button key={d} onClick={()=>setNumber(n=>n+d)} className="rounded-lg border border-[#40556b] p-3">{d}</button>)}</div><button onClick={()=>setNumber(n=>n.slice(0,-1))} className="rounded-lg border px-4 py-2">Delete</button><button disabled className="ml-2 rounded-lg bg-neutral-500 px-4 py-2 opacity-40">Call with Ava (coming soon)</button></div>}
    {tab==='settings' && <div className="rounded-xl border border-[#34485c] bg-[#142b40] p-4"><h2 className="font-semibold">Receptionist settings</h2><p className="mt-2 text-sm">Assistant connection, recording retention and outbound permissions will be configured after existing INTRIGUE integrations and roles are verified.</p></div>}
  </section>;
}
