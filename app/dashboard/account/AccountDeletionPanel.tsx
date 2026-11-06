'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {createClient} from '@/lib/supabase/client';
import {Download,ShieldCheck,AlertTriangle,Building2,UserRoundX,RefreshCw,ArrowRightLeft} from 'lucide-react';
import './account-deletion.css';

type Dependency={resource:string;count:number;rule?:string};
type Preview={email:string;owned_workspaces:number;workspace:{id:string;name:string;members:number}|null;
 account_blockers:Dependency[];storage_owned:number;workspace_references:Dependency[];
 empty_workspace_eligible:boolean;account_deletion_eligible:boolean};
type RecordRequest={id:string;kind:string;status:string;requested_at:string;response_due_at:string;workspace_label:string|null};
type Transfer={id:string;status:string;workspace_id:string;from_user:string;to_user:string;expires_at:string};
type TeamMember={member_user_id:string;email:string;role:string};
type Snapshot={enabled:boolean;preview:Preview;requests:RecordRequest[];transfers:Transfer[]};
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
 const [typed,setTyped]=useState('');
 const [ack,setAck]=useState(false);
 const p=snapshot?.preview;
 const enabled=snapshot?.enabled===true;

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
     else if(json.requested) setNotice(`Deletion request received. Reference: ${json.request_id}. This is a reviewed request, not an immediate deletion.`);
     setTyped('');setAck(false);setActive(null);
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
 const blocked=Boolean(p?.workspace && !p.empty_workspace_eligible);

 return <section className="intrigue-account-panel" aria-labelledby="intrigue-delete-account-heading">
  <div className="intrigue-account-heading"><ShieldCheck size={19}/><h3 id="intrigue-delete-account-heading">Privacy, ownership & account deletion</h3></div>
  <p className="intrigue-account-description">Control your INTRIGUE account and company data. Protected business information is never silently erased. A company with active records requires a reviewed deletion request.</p>
  {loading&&<p role="status" className="intrigue-account-muted">Checking company ownership, linked records and Storage…</p>}
  {p&&!loading&&<>
    {!enabled&&<p className="intrigue-account-error">Deletion actions are in restricted testing mode. Account exports remain available. Ask the operator when RC2 is approved.</p>}
    <p className="intrigue-account-muted">Signed in as <strong>{p.email}</strong></p>
    <div className="intrigue-rc2-grid">
      <div className="intrigue-rc2-tile">
        <Download size={19}/><strong>Export personal account data</strong>
        <p>Download your login profile and membership information as JSON. For company customers, quotes and documents, use the owner-only Data Management export separately.</p>
        <button type="button" className="intrigue-account-secondary" disabled={busy} onClick={()=>void exportPersonal()}>Download my data</button>
      </div>
      <div className="intrigue-rc2-tile">
        <UserRoundX size={19}/><strong>Delete my login</strong>
        <p>{p.account_deletion_eligible?'Your account currently has no blocking ownership references.':'Company ownership or protected records must be resolved before automatic login deletion.'}</p>
        {p.account_deletion_eligible
          ?<button type="button" className="intrigue-account-danger" disabled={busy||!enabled} onClick={()=>{setActive('delete_account');setTyped('');setAck(false);}}>Delete my account</button>
          :<button type="button" className="intrigue-account-secondary" disabled={busy||!enabled} onClick={()=>void act({action:'request',kind:'account'})}>Request account erasure review</button>}
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
        {p.empty_workspace_eligible&&<button type="button" className="intrigue-account-danger" disabled={busy||!enabled} onClick={()=>{setActive('delete_empty_workspace');setTyped('');setAck(false);}}>Delete empty company</button>}
        <button type="button" className="intrigue-account-secondary" disabled={busy||!enabled} onClick={()=>void act({action:'request',kind:'workspace_and_account'})}>Request company + account deletion</button>
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
      <ul>{snapshot.requests.map(r=><li key={r.id}><span>{r.kind.replace(/_/g,' + ')} · {r.status.replace(/_/g,' ')}</span><small>Ref {r.id} · Submitted {new Date(r.requested_at).toLocaleDateString()} · Response target {new Date(r.response_due_at).toLocaleDateString()}</small></li>)}</ul>
      <p className="intrigue-account-muted">A request receipt is not confirmation that data has been erased. Requests needing review must be handled by an authorized operator.</p>
    </div>}
    <div className="intrigue-account-actions"><button type="button" className="intrigue-account-secondary" disabled={busy} onClick={()=>void load()}><RefreshCw size={15}/> Refresh safety check</button></div>
  </>}
  {notice&&<p className="intrigue-rc2-success" role="status">{notice}</p>}
  {error&&<p className="intrigue-account-error" role="alert">{error}</p>}
  <p className="intrigue-account-muted">Erasure is subject to applicable retention duties and the company's role as data controller. After leaving a company, you can access this page at /account/privacy. This feature does not guarantee immediate deletion from backups or third-party providers.</p>
 </section>;
}
