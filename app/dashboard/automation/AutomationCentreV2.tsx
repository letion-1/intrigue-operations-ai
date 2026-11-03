'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CheckCircle2, CircleAlert, Clock3, History, Pause, Play, Plus, RefreshCw, RotateCcw, ShieldCheck, Workflow, XCircle } from 'lucide-react';
import './automation-centre-v2.css';

type WorkflowRow = {
  id:string;name:string;trigger_type:string;action_type:string;enabled:boolean;
  requires_approval:boolean;max_attempts:number;created_at:string;updated_at:string;
};
type RunRow = {
  id:string;workflow_id:string;event_key:string;status:string;attempts:number;
  max_attempts:number;approved_at:string|null;approved_by:string|null;
  last_error:string|null;result:{kind?:string;result?:string}|null;
  available_at:string;created_at:string;finished_at:string|null;
};
type EventRow = {id:number;run_id:string;event_type:string;details:Record<string,unknown>;created_at:string};
type Snapshot = {workflows:WorkflowRow[];runs:RunRow[];events:EventRow[];mode:'audit_only';worker:'local'};
const EMPTY:Snapshot={workflows:[],runs:[],events:[],mode:'audit_only',worker:'local'};
const STATUS:Record<string,string>={
  awaiting_approval:'Awaiting approval',queued:'Queued',running:'Running',retry_wait:'Retry scheduled',
  succeeded:'Succeeded',dead_letter:'Needs attention',cancelled:'Cancelled',
};
const when=(time:string|null)=>time?new Date(time).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const message=(e:unknown)=>e instanceof Error?e.message:'Automation request failed.';

export default function AutomationCentreV2({workspaceId,canManage}:{workspaceId:string;canManage:boolean}) {
  const supabase=useMemo(()=>createClient(),[]);
  const [snapshot,setSnapshot]=useState<Snapshot>(EMPTY);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [name,setName]=useState('');
  const [tab,setTab]=useState<'workflows'|'approvals'|'history'>('workflows');
  const [expandedRun,setExpandedRun]=useState<string|null>(null);

  const request=useCallback(async(method:'GET'|'POST',payload?:Record<string,unknown>):Promise<Record<string,unknown>>=>{
    const {data,error:authError}=await supabase.auth.getSession();
    if(authError||!data.session?.access_token)throw Error('Your session expired. Sign in again.');
    const url=method==='GET'?`/api/automation/v17?workspaceId=${encodeURIComponent(workspaceId)}`:'/api/automation/v17';
    const res=await fetch(url,{method,cache:'no-store',headers:{
      Authorization:`Bearer ${data.session.access_token}`,
      ...(method==='POST'?{'Content-Type':'application/json'}:{}),
    },...(payload?{body:JSON.stringify({workspaceId,...payload})}:{} )});
    const raw:unknown=await res.json().catch(()=>null);
    const row=raw && typeof raw==='object' && !Array.isArray(raw) ? raw as Record<string,unknown>:{};
    if(!res.ok)throw Error(typeof row.error==='string'?row.error:`Workflow request failed (${res.status}).`);
    return row;
  },[supabase,workspaceId]);

  const load=useCallback(async()=>{
    const data=await request('GET');
    if(!Array.isArray(data.workflows)||!Array.isArray(data.runs)||!Array.isArray(data.events)||data.mode!=='audit_only'){
      throw Error('Unexpected workflow response.');
    }
    setSnapshot(data as Snapshot);
  },[request]);

  useEffect(()=>{
    let active=true;
    setSnapshot(EMPTY);setError('');setNotice('');setLoading(true);
    if(!canManage || !workspaceId){setLoading(false);return;}
    const start=async()=>{
      try{const data=await request('GET');if(active){
        if(!Array.isArray(data.workflows)||!Array.isArray(data.runs)||!Array.isArray(data.events)||data.mode!=='audit_only')throw Error('Unexpected workflow response.');
        setSnapshot(data as Snapshot);
      }}catch(e){if(active)setError(message(e));}
      finally{if(active)setLoading(false);}
    };
    void start();
    return()=>{active=false;};
  },[request,workspaceId,canManage]);

  const act=async(action:Record<string,unknown>,success:string):Promise<boolean>=>{
    if(busy)return false;
    setBusy(true);setError('');setNotice('');
    try{await request('POST',action);await load();setNotice(success);return true;}
    catch(e){setError(message(e));return false;}
    finally{setBusy(false);}
  };
  const create=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();
    if(name.trim().length<3 || busy)return;
    if(await act({operation:'create_workflow',name:name.trim()},'Workflow created. Enable it when you are ready to run an internal test.'))setName('');
  };
  const confirm=async(action:'approve'|'cancel'|'retry',run:RunRow)=>{
    const messages={
      approve:'Approve this internal audit-only run? The local worker can process it; no customer communication will be sent.',
      cancel:'Cancel this queued internal run? This cannot be undone.',
      retry:'Retry this previously approved, failed internal run? Its attempt counter will restart.',
    };
    if(!window.confirm(messages[action]))return;
    await act({operation:action,runId:run.id},action==='approve'?'Approved. The local worker will pick it up when running.':action==='retry'?'Run queued for another attempt.':'Run cancelled.');
  };
  const queue=async(w:WorkflowRow)=>{
    if(!window.confirm(`Queue a manual approval request for "${w.name}"? No external actions are enabled.`))return;
    const eventKey=`manual:${crypto.randomUUID()}`;
    await act({operation:'enqueue',workflowId:w.id,eventKey},'Run created and awaiting Owner/Admin approval.');
  };
  const toggle=async(w:WorkflowRow)=>{
    if(!window.confirm(`${w.enabled?'Disable':'Enable'} "${w.name}"? Disabling blocks new runs but does not cancel existing ones.`))return;
    await act({operation:'toggle_workflow',workflowId:w.id,enabled:!w.enabled},`Workflow ${w.enabled?'disabled':'enabled'}.`);
  };
  const workflowName=(id:string)=>snapshot.workflows.find(w=>w.id===id)?.name||`Workflow ${id.slice(0,8)}`;
  const pending=snapshot.runs.filter(r=>r.status==='awaiting_approval');
  const failures=snapshot.runs.filter(r=>r.status==='dead_letter');
  const completed=snapshot.runs.filter(r=>r.status==='succeeded').length;
  if(!canManage)return null;
  return <section className="acv2" aria-label="Automation Centre V2">
    <div className="acv2-heading">
      <div>
        <p className="acv2-eyebrow"><Workflow size={14}/> AUTOMATION CENTRE V2 · V17.1B</p>
        <h2>Workflows & execution control</h2>
        <p>Workspace-scoped manual workflows, human approval, retry controls and a durable execution history.</p>
      </div>
      <div className="acv2-actions">
        <span className="acv2-pill"><ShieldCheck size={14}/> Audit-only mode</span>
        <button type="button" disabled={busy||loading} onClick={()=>void load().then(()=>setNotice('Workflow data refreshed.')).catch(e=>setError(message(e)))}><RefreshCw size={15}/> Refresh</button>
      </div>
    </div>
    <p className="acv2-safety"><CircleAlert size={16}/> Customer emails, CRM updates, external calls, calendar bookings and automatic triggers are <strong>not enabled</strong> here. The local worker must be started manually.</p>
    {error&&<p className="acv2-error" role="alert">{error}</p>}
    {notice&&<p className="acv2-notice" role="status">{notice}</p>}
    <div className="acv2-stats">
      <div><strong>{snapshot.workflows.length}</strong><span>Workflows</span></div>
      <div><strong>{pending.length}</strong><span>Awaiting approval</span></div>
      <div><strong>{completed}</strong><span>Completed</span></div>
      <div><strong>{failures.length}</strong><span>Needs attention</span></div>
    </div>
    <div className="acv2-tabs" role="tablist" aria-label="Automation views">
      <button role="tab" aria-selected={tab==='workflows'} onClick={()=>setTab('workflows')}><Workflow size={15}/> Workflows</button>
      <button role="tab" aria-selected={tab==='approvals'} onClick={()=>setTab('approvals')}><ShieldCheck size={15}/> Approval queue ({pending.length})</button>
      <button role="tab" aria-selected={tab==='history'} onClick={()=>setTab('history')}><History size={15}/> Execution history</button>
    </div>
    {loading?<div className="acv2-empty">Loading workspace workflows…</div>:<>
      {tab==='workflows'&&<div className="acv2-section">
        <form className="acv2-create" onSubmit={e=>void create(e)}>
          <label htmlFor="acv2-name">Create an internal test workflow</label>
          <div className="acv2-create-row"><input id="acv2-name" value={name} onChange={e=>setName(e.target.value)} minLength={3} maxLength={120} placeholder="Example: Quotation processing audit" required disabled={busy}/><button type="submit" className="acv2-primary" disabled={busy||name.trim().length<3}><Plus size={15}/> Create</button></div>
          <small>Trigger: manual · Action: internal audit event · Human approval: required · Initial state: disabled</small>
        </form>
        {snapshot.workflows.length===0&&<div className="acv2-empty">No V17 workflows yet. Create your first internal test workflow above.</div>}
        <div className="acv2-list">{snapshot.workflows.map(w=><article className="acv2-item" key={w.id}>
          <div className="acv2-item-header"><div><h3>{w.name}</h3><small>Manual trigger · Audit event · {w.max_attempts} attempts · Created {when(w.created_at)}</small></div><span className={`acv2-status ${w.enabled?'acv2-status-good':''}`}>{w.enabled?'Enabled':'Disabled'}</span></div>
          <div className="acv2-item-actions"><button type="button" disabled={busy} onClick={()=>void toggle(w)}>{w.enabled?<Pause size={14}/>:<Play size={14}/>} {w.enabled?'Disable':'Enable'}</button><button type="button" disabled={busy||!w.enabled} onClick={()=>void queue(w)} className="acv2-primary"><Plus size={14}/> Queue test run</button></div>
        </article>)}</div>
      </div>}
      {tab==='approvals'&&<div className="acv2-section">
        {pending.length===0&&<div className="acv2-empty">No workflow runs are awaiting approval.</div>}
        <div className="acv2-list">{pending.map(r=><article className="acv2-item" key={r.id}>
          <div className="acv2-item-header"><div><h3>{workflowName(r.workflow_id)}</h3><small>Requested {when(r.created_at)} · Run {r.id.slice(0,8)}</small></div><span className="acv2-status">Awaiting approval</span></div>
          <p className="acv2-muted">Review: this run records only an internal audit receipt. No external messages or customer updates.</p>
          <div className="acv2-item-actions"><button type="button" disabled={busy} className="acv2-primary" onClick={()=>void confirm('approve',r)}><CheckCircle2 size={14}/> Approve</button><button type="button" disabled={busy} onClick={()=>void confirm('cancel',r)}><XCircle size={14}/> Cancel</button></div>
        </article>)}</div>
      </div>}
      {tab==='history'&&<div className="acv2-section">
        {snapshot.runs.length===0&&<div className="acv2-empty">No V17 execution history yet. Enable a workflow and queue a test run.</div>}
        <div className="acv2-list">{snapshot.runs.map(r=>{
          const events=snapshot.events.filter(e=>e.run_id===r.id);
          return <article className="acv2-item" key={r.id}>
            <div className="acv2-item-header"><div><h3>{workflowName(r.workflow_id)}</h3><small>{when(r.created_at)} · Run {r.id.slice(0,8)}</small></div><span className={`acv2-status ${r.status==='succeeded'?'acv2-status-good':r.status==='dead_letter'?'acv2-status-bad':''}`}>{STATUS[r.status]||r.status}</span></div>
            <p className="acv2-muted">Attempts: {r.attempts}/{r.max_attempts} · Approved: {r.approved_at?when(r.approved_at):'No'} {r.status==='retry_wait'?` · Next attempt: ${when(r.available_at)}`:''}</p>
            {r.last_error&&<p className="acv2-error">Last error: {r.last_error}</p>}
            {r.status==='succeeded'&&<p className="acv2-success"><CheckCircle2 size={14}/> Internal receipt completed (no external actions).</p>}
            <div className="acv2-item-actions">
              {r.status==='dead_letter'&&<button type="button" disabled={busy||!r.approved_at} onClick={()=>void confirm('retry',r)}><RotateCcw size={14}/> Retry safely</button>}
              {['awaiting_approval','queued','retry_wait'].includes(r.status)&&<button type="button" disabled={busy} onClick={()=>void confirm('cancel',r)}><XCircle size={14}/> Cancel</button>}
              <button type="button" onClick={()=>setExpandedRun(x=>x===r.id?null:r.id)}><Clock3 size={14}/> {expandedRun===r.id?'Hide events':'View events'} ({events.length})</button>
            </div>
            {expandedRun===r.id&&<ol className="acv2-events">{events.length?events.map(e=><li key={e.id}><strong>{e.event_type.replaceAll('_',' ')}</strong><span>{when(e.created_at)}</span></li>):<li>No audit events found in the current 150-event window.</li>}</ol>}
          </article>;
        })}</div>
      </div>}
    </>}
    <p className="acv2-foot">This dashboard is backed by the V17 workflow tables. Existing V11 jobs are preserved below. A disabled workflow accepts no new test runs; previously queued runs still require review or completion.</p>
  </section>;
}
