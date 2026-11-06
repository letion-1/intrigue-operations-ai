'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {createClient} from '@/lib/supabase/client';
import {Download,ShieldCheck,AlertTriangle,Building2,UserRoundX,RefreshCw,ArrowRightLeft} from 'lucide-react';
import './account-deletion.css';

type Dependency={resource:string;count:number;rule?:string};
type Preview={email:string;owned_workspaces:number;workspace:{id:string;name:string;members:number}|null;
 account_blockers:Dependency[];storage_owned:number;workspace_references:Dependency[];
 empty_workspace_eligible:boolean;account_deletion_eligible:boolean};
type RecordRequest={id:string;kind:string;status:string;requested_at:string;response_due_at:string;workspace_label:string|null;public_message?:string|null;status_updated_at?:string|null};
type Transfer={id:string;status:string;workspace_id:string;from_user:string;to_user:string;expires_at:string};
type TeamMember={member_user_id:string;email:string;role:string};
type Snapshot={enabled:boolean;requestEnabled?:boolean;preview:Preview;requests:RecordRequest[];transfers:Transfer[]};
type ReviewKind='account'|'workspace'|'workspace_and_account';
type Action='delete_account'|'delete_empty_workspace'|null;

function friendly(name:string){
 const words:Record<string,string>={workspaces:'Company workspace',action_proposals:'Pending approvals',
  automation_jobs:'Automation jobs',automation_job_events:'Automation history',
  intrigue_dm_audit:'Data management audit records',intrigue_dm_backups:'Workspace backups',
  intrigue_crm_connections:'CRM connections',customers:'Customer records',quotations:'Quotations',
  knowledge_entries:'Knowledge entries',workspace_memberships:'Team membership'};
 const key=name.split('.').pop()||name;
 return words[key]||key.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
}

export default function AccountDeletionPanel(){
 const db=useMemo(()=>createClient(),[]);
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [team,setTeam]=useState<TeamMember[]>([]);
 const [target,setTarget]=useState('');
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [active,setActive]=useState<Action>(null);
 const [reviewKind,setReviewKind]=useState<ReviewKind|null>(null);
 const [reviewTyped,setReviewTyped]=useState('');
 const [reviewAck,setReviewAck]=useState(false);
 const [withdrawTarget,setWithdrawTarget]=useState<RecordRequest|null>(null);
 const [withdrawTyped,setWithdrawTyped]=useState('');
 const [withdrawAck,setWithdrawAck]=useState(false);
 const reviewRef=useRef<HTMLDivElement>(null);
 const [typed,setTyped]=useState('');
 const [ack,setAck]=useState(false);
 const p=snapshot?.preview;
 const enabled=snapshot?.enabled===true;
 const requestEnabled=snapshot?.requestEnabled===true;
 const activeRequests=(snapshot?.requests||[]).filter(r=>
   ['needs_review','reviewing','processing','workspace_deleted'].includes(r.status));
 const existingActive=activeRequests[0]||null;
 const canStartRequest=requestEnabled&&!existingActive;

 const auth=useCallback(async()=>{
   const {data:{session},error:e}=await db.auth.getSession();
   if(e||!session?.access_token)throw new Error('Sign in again to manage your account.');
   return {Authorization:`Bearer ${session.access_token}`};
 },[db]);
 const load=useCallback(async()=>{
   setLoading(true);setError('');
   try{
     const res=await fetch('/api/account/lifecycle',{headers:await auth(),cache:'no-store'});
     const json=await res.json();
     if(!res.ok)throw new Error(json.error||'Unable to load account protections.');
     setSnapshot(json as Snapshot);
     if(json.preview?.workspace?.id){
       const {data}=await db.rpc('list_intrigue_team',{p_workspace_id:json.preview.workspace.id});
       setTeam((data||[]).filter((m:TeamMember)=>m.role!=='owner'));
     }else setTeam([]);
   }catch(e){setError(e instanceof Error?e.message:'Safety check failed.');setSnapshot(null);}
   finally{setLoading(false);}
 },[db,auth]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{if(reviewKind)reviewRef.current?.scrollIntoView({behavior:'smooth',block:'center'});},[reviewKind]);
 const openReview=(kind:ReviewKind)=>{
   if(existingActive){setError('You already have an active privacy request. Review or withdraw it before creating another.');return;}
   setReviewKind(kind);setReviewTyped('');setReviewAck(false);setWithdrawTarget(null);setActive(null);setError('');setNotice('');
 };

 const act=async(body:Record<string,unknown>)=>{
   setBusy(true);setError('');setNotice('');
   try{
     const res=await fetch('/api/account/lifecycle',{
       method:'POST',headers:{...await auth(),'Content-Type':'application/json'},body:JSON.stringify(body)});
     const json=await res.json();
     if(!res.ok)throw new Error(json.error||`Request failed (${res.status}).`);
     if(json.account_deleted){
       await db.auth.signOut({scope:'local'}).catch(()=>undefined);
       window.location.replace('/auth/login?account_deleted=1');return;
     }
     if(json.transferred) setNotice('Ownership transfer accepted. Refresh to update your access.');
     else if(json.offered) setNotice(`Transfer offered. Ask the recipient to open the ownership transfer page and sign in. Reference: ${json.transfer_id}`);
     else if(json.workspace_deleted) setNotice(json.message||'Empty company workspace deleted. Your login remains active.');
     else if(json.requested) setNotice(`Privacy request received. Reference: ${json.request_id}. No data has been deleted. Track your request below.`);
     else if(json.withdrawn) setNotice(`Request ${json.request_id} withdrawn successfully. No data was erased.`);
     setTyped('');setAck(false);setActive(null);setReviewKind(null);setReviewTyped('');setReviewAck(false);
     setWithdrawTarget(null);setWithdrawTyped('');setWithdrawAck(false);
     await load();
   }catch(e){setError(e instanceof Error?e.message:'Action failed.');}
   finally{setBusy(false);}
 };
 const exportPersonal=async()=>{
   setBusy(true);setError('');
   try{
     const res=await fetch('/api/account/lifecycle/export',{headers:await auth(),cache:'no-store'});
     if(!res.ok){const j=await res.json();throw new Error(j.error||'Export failed');}
     const blob=await res.blob();const url=URL.createObjectURL(blob);
     const link=document.createElement('a');link.href=url;link.download='INTRIGUE-personal-account-export.json';
     document.body.appendChild(link);link.click();link.remove();
     window.setTimeout(()=>URL.revokeObjectURL(url),5000);
   }catch(e){setError(e instanceof Error?e.message:'Export failed.');}
   finally{setBusy(false);}
 };
 const confirmation=active==='delete_account'?`DELETE ${p?.email||''}`:`DELETE ${p?.workspace?.name||''}`;
 const reviewPhrase=reviewKind==='account'?`REQUEST ACCOUNT ${p?.email||''}`
  :reviewKind==='workspace'?`REQUEST COMPANY ${p?.workspace?.name||''}`
  :`REQUEST COMPANY AND ACCOUNT ${p?.workspace?.name||''}`;

 return <section className="intrigue-account-panel" aria-labelledby="intrigue-delete-account-heading">
  <div className="intrigue-account-heading"><ShieldCheck size={19}/><h3 id="intrigue-delete-account-heading">Privacy, ownership & account deletion</h3></div>
  <p className="intrigue-account-description">Control your INTRIGUE account and company data. Protected business information is never silently erased. A company with active records requires a reviewed deletion request.</p>
  {loading&&<p role="status" className="intrigue-account-muted">Checking company ownership, linked records and Storage…</p>}
  {p&&!loading&&<>
    {!enabled&&<p className="intrigue-rc21-info">Direct deletion is disabled during testing. You can still request account or company erasure for manual review. Nothing is deleted when you submit a request.</p>}
    <p className="intrigue-account-muted">Signed in as <strong>{p.email}</strong></p>
    {existingActive&&<div className="intrigue-rc22-existing" role="status">
      <strong>A privacy request is already open.</strong>
      <p>Reference <code>{existingActive.id}</code> is {existingActive.status.replace(/_/g,' ')}.
        To prevent conflicting instructions, new requests are paused until this one is resolved.
        You can withdraw it below while it is awaiting review.</p>
    </div>}
    <div className="intrigue-rc2-grid">
      <div className="intrigue-rc2-tile">
        <Download size={19}/><strong>Export personal account data</strong>
        <p>Download your login profile and membership information as JSON. For company customers, quotes and documents, use the owner-only Data Management export separately.</p>
        <button type="button" className="intrigue-account-secondary" disabled={busy} onClick={()=>void exportPersonal()}>Download my data</button>
      </div>
      <div className="intrigue-rc2-tile">
        <UserRoundX size={19}/><strong>Delete my login</strong>
        <p>{p.account_deletion_eligible?'Your account currently has no blocking ownership references.':'Company ownership or protected records must be resolved before automatic login deletion.'}</p>
        <button type="button" className="intrigue-account-secondary" disabled={busy||!canStartRequest}
          onClick={()=>openReview('account')}>Request account erasure review</button>
        {p.account_deletion_eligible&&enabled&&<button type="button" className="intrigue-account-danger" disabled={busy}
          onClick={()=>{setActive('delete_account');setReviewKind(null);setTyped('');setAck(false);}}>Delete my account now</button>}
      </div>
    </div>
    {p.workspace&&<div className="intrigue-rc2-company">
      <div className="intrigue-account-heading"><Building2 size={18}/><strong>Company: {p.workspace.name}</strong></div>
      <p className="intrigue-account-description">{p.workspace.members} workspace member(s). {p.storage_owned} Storage object(s) owned by this account.</p>
      {p.workspace_references.length>0&&<details className="intrigue-rc2-details"><summary>Review data affected by company deletion</summary>
        <ul>{p.workspace_references.map((r,i)=><li key={i}>{friendly(r.resource)}: {r.count} ({r.rule||'linked'})</li>)}</ul>
      </details>}
      <p className="intrigue-account-description">{p.empty_workspace_eligible
        ?'This company passes the strict empty-workspace check. You may delete it after verifying there is nothing to retain.'
        :'This company has protected data, other members or active dependencies. Automatic removal is disabled. Submit a reviewed deletion request.'}</p>
      <div className="intrigue-account-actions">
        <button type="button" className="intrigue-account-secondary" disabled={busy||!canStartRequest}
          onClick={()=>openReview('workspace')}>Request company deletion review</button>
        <button type="button" className="intrigue-account-secondary" disabled={busy||!canStartRequest}
          onClick={()=>openReview('workspace_and_account')}>Request company + account deletion</button>
        {p.empty_workspace_eligible&&enabled&&<button type="button" className="intrigue-account-danger" disabled={busy}
          onClick={()=>{setActive('delete_empty_workspace');setReviewKind(null);setTyped('');setAck(false);}}>Delete empty company</button>}
      </div>
      {team.length>0&&<div className="intrigue-rc2-transfer">
        <div className="intrigue-account-heading"><ArrowRightLeft size={17}/><strong>Transfer company ownership</strong></div>
        <p>Choose an existing team member. They must sign in and accept the transfer. Existing company data will be preserved.</p>
        <select value={target} onChange={e=>setTarget(e.target.value)} aria-label="Choose new company owner">
          <option value="">Select a team member</option>
          {team.map(m=><option value={m.member_user_id} key={m.member_user_id}>{m.email} ({m.role})</option>)}
        </select>
        <button type="button" className="intrigue-account-secondary" disabled={busy||!enabled||!target} onClick={()=>void act({action:'offer_transfer',to_user:target})}>Offer ownership transfer</button>
        <p className="intrigue-account-muted">Recipient link: <a href="/transfer-ownership">/transfer-ownership</a></p>
      </div>}
    </div>}
    {p.account_blockers.length>0&&<details className="intrigue-rc2-details"><summary>Why immediate account deletion is unavailable</summary>
      <ul>{p.account_blockers.map((r,i)=><li key={i}>{friendly(r.resource)}: {r.count}</li>)}</ul>
      <p>These linked records cannot be erased automatically without checking ownership or legal retention.</p>
    </details>}
    {reviewKind&&<div className="intrigue-rc21-request" ref={reviewRef} role="region" aria-label="Confirm privacy request">
      <div className="intrigue-account-heading"><ShieldCheck size={19}/><strong>Confirm your privacy request</strong></div>
      <p><strong>{reviewKind==='account'?'Personal account erasure review':reviewKind==='workspace'?'Company workspace erasure review':'Company and account erasure review'}</strong></p>
      <p>Submitting this request does <strong>not</strong> delete your login, company, customer records, backups or third-party data. It creates a reference for an authorized operator to review ownership, legal retention, and next steps.</p>
      <p>We will record a response target. The current release does not automatically email you or complete the request. Check the request history below or contact the operator with your reference.</p>
      <label className="intrigue-account-ack"><input type="checkbox" checked={reviewAck} onChange={e=>setReviewAck(e.target.checked)}/>
        I understand this is a review request, not immediate deletion, and some information may need to be retained.</label>
      <label className="intrigue-account-label">Type <strong>{reviewPhrase}</strong> exactly to submit
        <input type="text" value={reviewTyped} autoComplete="off" spellCheck={false}
          onChange={e=>setReviewTyped(e.target.value)}/>
      </label>
      <div className="intrigue-account-actions">
        <button type="button" className="intrigue-account-secondary" disabled={busy} onClick={()=>setReviewKind(null)}>Cancel</button>
        <button type="button" className="intrigue-account-secondary intrigue-rc21-submit"
          disabled={busy||!canStartRequest||!reviewAck||reviewTyped!==reviewPhrase}
          onClick={()=>void act({action:'request',kind:reviewKind,confirmation:reviewTyped,acknowledged:reviewAck})}>
          {busy?'Submitting…':'Submit reviewed erasure request'}</button>
      </div>
    </div>}
    {active&&<div className="intrigue-account-confirmation">
      <div className="intrigue-account-heading"><AlertTriangle size={19}/><strong>Confirm permanent deletion</strong></div>
      <p>Download the relevant exports first. This operation cannot be undone. You must have signed in within the last 10 minutes.</p>
      {active==='delete_empty_workspace'&&<p>This removes the company and its default settings; use a reviewed request for any company with business data.</p>}
      <label className="intrigue-account-ack"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> I understand this is permanent and have saved the information I need.</label>
      <label className="intrigue-account-label">Type <strong>{confirmation}</strong> exactly to confirm
        <input type="text" value={typed} autoComplete="off" spellCheck={false} onChange={e=>setTyped(e.target.value)}/>
      </label>
      <div className="intrigue-account-actions">
        <button type="button" className="intrigue-account-secondary" onClick={()=>setActive(null)} disabled={busy}>Cancel</button>
        <button type="button" className="intrigue-account-danger" disabled={busy||!enabled||!ack||typed!==confirmation}
          onClick={()=>void act({action:active,confirmation:typed,acknowledged:ack,also_delete_account:false})}>Permanently {active==='delete_account'?'delete account':'delete empty company'}</button>
      </div>
    </div>}
    {snapshot?.requests?.length>0&&<div className="intrigue-rc2-history">
      <strong>Privacy request history</strong>
      <ul>{snapshot.requests.map(r=><li key={r.id}>
        <span><strong>{r.kind.replace(/_/g,' + ')}</strong> · {r.status.replace(/_/g,' ')}</span>
        <small>Ref {r.id} · Submitted {new Date(r.requested_at).toLocaleDateString()} · Response target {new Date(r.response_due_at).toLocaleDateString()}</small>
        {r.public_message&&<p className="intrigue-rc22-request-message">{r.public_message}</p>}
        {r.status==='needs_review'&&<button type="button" className="intrigue-account-secondary intrigue-rc22-withdraw-button"
          disabled={busy} onClick={()=>{setWithdrawTarget(r);setWithdrawTyped('');setWithdrawAck(false);setError('');setNotice('');setReviewKind(null);}}>
          Withdraw this request
        </button>}
      </li>)}</ul>
      <p className="intrigue-account-muted">A request receipt is not confirmation that data has been erased. Requests needing review must be handled by an authorized operator.</p>
    </div>}
    {withdrawTarget&&<div className="intrigue-rc22-withdraw-panel" role="region" aria-label="Confirm privacy request withdrawal">
      <div className="intrigue-account-heading"><AlertTriangle size={18}/><strong>Withdraw pending privacy request</strong></div>
      <p>Reference <code>{withdrawTarget.id}</code>. This only cancels your pending request for review.
        It does not erase any account or company data, and cannot undo deletion already in progress.</p>
      <label className="intrigue-account-ack"><input type="checkbox" checked={withdrawAck}
        onChange={e=>setWithdrawAck(e.target.checked)}/>
        I understand I am withdrawing this pending request and can submit a new request later.</label>
      <label className="intrigue-account-label">Type <strong>{`WITHDRAW ${withdrawTarget.id}`}</strong> exactly to confirm
        <input type="text" value={withdrawTyped} autoComplete="off" spellCheck={false}
          onChange={e=>setWithdrawTyped(e.target.value)}/></label>
      <div className="intrigue-account-actions">
        <button type="button" className="intrigue-account-secondary" disabled={busy}
          onClick={()=>{setWithdrawTarget(null);setWithdrawTyped('');setWithdrawAck(false);}}>Cancel</button>
        <button type="button" className="intrigue-account-secondary intrigue-rc22-confirm-withdraw"
          disabled={busy||!withdrawAck||withdrawTyped!==`WITHDRAW ${withdrawTarget.id}`}
          onClick={()=>void act({action:'withdraw_request',request_id:withdrawTarget.id,
            confirmation:withdrawTyped,acknowledged:withdrawAck})}>Confirm withdrawal</button>
      </div>
    </div>}
    <div className="intrigue-account-actions"><button type="button" className="intrigue-account-secondary" disabled={busy} onClick={()=>void load()}><RefreshCw size={15}/> Refresh safety check</button></div>
  </>}
  {notice&&<p className="intrigue-rc2-success" role="status">{notice}</p>}
  {error&&<p className="intrigue-account-error" role="alert">{error}</p>}
  <p className="intrigue-account-muted">Erasure is subject to applicable retention duties and the company's role as data controller. After leaving a company, you can access this page at /account/privacy. This feature does not guarantee immediate deletion from backups or third-party providers.</p>
 </section>;
}
