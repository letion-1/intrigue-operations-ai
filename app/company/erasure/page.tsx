'use client';
import {useCallback,useEffect,useMemo,useState,type CSSProperties} from 'react';
import {createClient} from '@/lib/supabase/client';
import {AlertTriangle,ArrowLeft,Download,RefreshCw,Trash2} from 'lucide-react';

type Preflight={company_name:string;workspace_id:string;state:'active'|'closing';pending_case_id:string|null;tables:Record<string,number>;
 total_records:number;storage_objects_owned_by_actor:number;legal_holds:number;in_flight_ai_jobs:number;can_stage:boolean;important:string};
const panel:CSSProperties={padding:22,border:'1px solid #465469',borderRadius:16,background:'#15273b',marginTop:20};
const button:CSSProperties={display:'inline-flex',alignItems:'center',gap:8,padding:'11px 17px',borderRadius:9,
 border:'1px solid #b99a63',color:'#f7e1ae',background:'#172a3e',cursor:'pointer',fontWeight:600};
export default function CompanyErasure(){
 const db=useMemo(()=>createClient(),[]);
 const [data,setData]=useState<Preflight|null>(null),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[result,setResult]=useState('');
 const [downloaded,setDownloaded]=useState(false),[exportNote,setExportNote]=useState(''),[ack,setAck]=useState(false),[typed,setTyped]=useState('');
 const [deleteLogin,setDeleteLogin]=useState(false),[caseId,setCaseId]=useState('');
 const bearer=useCallback(async()=>{
  const {data:{session}}=await db.auth.getSession();
  if(!session?.access_token)throw Error('Sign in again before managing company data.');
  return {Authorization:`Bearer ${session.access_token}`};
 },[db]);
 const load=useCallback(async()=>{
  setBusy(true);setError('');setDownloaded(false);setExportNote('');
  try{
   const res=await fetch('/api/company/erasure',{headers:await bearer(),cache:'no-store'});
   const j=await res.json();if(!res.ok)throw Error(j.error||'Unable to load owner preflight.');setData(j);setCaseId(j.pending_case_id||'');
  }catch(e){setData(null);setError(e instanceof Error?e.message:'Preflight failed');}
  finally{setBusy(false);}
 },[bearer]);
 useEffect(()=>{void load();},[load]);
 async function exportData(){
  setBusy(true);setError('');setDownloaded(false);setExportNote('');
  try{
   const res=await fetch('/api/company/erasure?mode=export',{headers:await bearer(),cache:'no-store'});
   if(!res.ok){const j=await res.json();throw Error(j.error||'Export failed');}
   const blob=await res.blob();const url=URL.createObjectURL(blob);
   const a=document.createElement('a');a.href=url;a.download='INTRIGUE-company-business-export.json';
   document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
   setDownloaded(true);setExportNote('The business export was prepared for download. Check your Downloads folder and save the file before continuing.');
  }catch(e){setError(e instanceof Error?e.message:'Export failed');}finally{setBusy(false);}
 }
 async function erase(){
  if(!data||busy||!downloaded||!ack||typed!==`DELETE COMPANY ${data.company_name}`)return;
  setBusy(true);setError('');setResult('');
  try{
   const res=await fetch('/api/company/erasure',{method:'POST',headers:{...await bearer(),'Content-Type':'application/json'},
    body:JSON.stringify({action:'erase',exported:true,acknowledged:true,confirmation:typed,delete_personal_login:deleteLogin})});
   const j=await res.json();
   if(!res.ok){if(j.case_id){setCaseId(j.case_id);await load();}throw Error(j.message||j.error||'Company erasure failed.');}
   if(!j.database_erased)throw Error('Deletion was not confirmed.');
   setResult(`Live company database erased. ${j.deleted_rows} records removed. Case ${j.case_id}. ${j.personal_login_status} Historical backups and external providers have separate retention schedules.`);
   setData(null);setTyped('');setDownloaded(false);
   if(j.account_deleted){await db.auth.signOut({scope:'local'}).catch(()=>undefined);}
  }catch(e){setError(e instanceof Error?e.message:'Deletion failed.');}
  finally{setBusy(false);}
 }
 // Explicit readiness checklist: never leave a disabled destructive button unexplained.
 const expectedConfirmation=data?`DELETE COMPANY ${data.company_name}`:'';
 const missing:string[]=[];
 if(data){
  if(data.legal_holds>0)missing.push(`${data.legal_holds} legal-retention hold(s) must be resolved.`);
  if(data.in_flight_ai_jobs>0)missing.push(`${data.in_flight_ai_jobs} AI job(s) are still processing.`);
  if(data.storage_objects_owned_by_actor>0)missing.push(`${data.storage_objects_owned_by_actor} Storage object(s) require ownership review.`);
  if(!data.can_stage && data.legal_holds===0 && data.in_flight_ai_jobs===0 && data.storage_objects_owned_by_actor===0)
   missing.push('Database preflight is not ready. Refresh the counts to investigate.');
  if(!downloaded)missing.push('Use “Download company export” in step 1 and check that it saved.');
  if(!ack)missing.push('Tick the confirmation that you understand the permanent deletion.');
  if(typed!==expectedConfirmation)missing.push('Enter the exact company confirmation phrase.');
 }
 const readyToErase=Boolean(data&&!busy&&missing.length===0);
 async function cancel(){
  if(!data||!caseId||busy)return;
  setBusy(true);setError('');
  try{
   const res=await fetch('/api/company/erasure',{method:'POST',headers:{...await bearer(),'Content-Type':'application/json'},
    body:JSON.stringify({action:'cancel',case_id:caseId,confirmation:`CANCEL ${caseId}`})});
   const j=await res.json();if(!res.ok)throw Error(j.error||'Unable to cancel closure');
   setCaseId('');setResult('Workspace unlocked. No company data was erased.');await load();
  }catch(e){setError(e instanceof Error?e.message:'Unable to cancel');}finally{setBusy(false);}
 }
 return <main style={{background:'#0b1827',color:'#f5f0e8',minHeight:'100vh',padding:'clamp(20px,4vw,50px)'}}>
  <div style={{maxWidth:960,margin:'0 auto'}}>
   <a href="/dashboard" style={{color:'#d7b778',display:'inline-flex',alignItems:'center',gap:8}}><ArrowLeft size={17}/> Back to dashboard</a>
   <h1 style={{fontSize:'clamp(27px,4vw,42px)',fontWeight:700,marginTop:20}}>Company data deletion</h1>
   <p style={{color:'#bdc9d4',marginTop:10}}>Only the verified company owner can permanently remove this company. Export before deleting.</p>
   {error&&<p role="alert" style={{...panel,borderColor:'#c76f68',color:'#ffd3d0'}}>{error}</p>}
   {result&&<p role="status" style={{...panel,borderColor:'#7eae8d',color:'#c3f4d2'}}>{result}</p>}
   {data&&<>
    <section style={panel}>
     <h2 style={{fontSize:21,fontWeight:650}}>{data.company_name}</h2>
     <p style={{marginTop:8,color:'#bdc9d4'}}>Records found: {data.total_records} · AI jobs in flight: {data.in_flight_ai_jobs} · Storage objects owned by you: {data.storage_objects_owned_by_actor} · Legal holds: {data.legal_holds}</p>
     <button type="button" style={{...button,marginTop:14}} disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/> Refresh counts</button>
     <details style={{marginTop:12}}><summary>Show affected database tables</summary><div style={{maxHeight:320,overflowY:'auto',marginTop:8}}>{Object.entries(data.tables).filter(x=>x[1]>0).map(([k,v])=><div key={k} style={{display:'flex',justifyContent:'space-between',gap:12,padding:'6px 0',borderBottom:'1px solid #344457'}}><span>{k}</span><b>{v}</b></div>)}</div></details>
    </section>
    <section style={panel}>
     <h2 style={{fontSize:19,fontWeight:650}}>1. Download your business data</h2>
     <p style={{color:'#bdc9d4',margin:'8px 0 16px'}}>Export includes business tables, not passwords, OAuth secrets, provider-owned records or historical backups. Large datasets must use a paginated export before erasure.</p>
     <button type="button" style={{...button,opacity:busy?0.65:1}} disabled={busy} onClick={()=>void exportData()}><Download size={16}/>{downloaded?'Download again':'Download company export'}</button>
     {exportNote&&<p role="status" style={{color:'#c9e9d6',marginTop:12}}>{exportNote}</p>}
    </section>
    <section style={{...panel,borderColor:'#97714e'}}>
     <h2 style={{fontSize:19,fontWeight:650,display:'flex',alignItems:'center',gap:8}}><AlertTriangle size={20}/> 2. Permanently erase this company</h2>
     <p style={{color:'#bdc9d4',margin:'12px 0'}}>This removes eligible live database records and the company workspace, including CRM imports, quotations, AI activity, connected-service credentials and internal backups. The action cannot be undone.</p>
     <p style={{color:'#f0cc94'}}>Supabase point-in-time backups, any downloaded exports and provider-held copies are subject to separate retention or removal. This operation cannot claim those copies were erased.</p>
     <label style={{display:'flex',gap:10,margin:'18px 0'}}><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> I understand the deletion is permanent and have safely stored the export.</label>
     <label style={{display:'flex',gap:10,margin:'18px 0'}}><input type="checkbox" checked={deleteLogin} onChange={e=>setDeleteLogin(e.target.checked)}/> Delete my personal login too, if it has no other company access or blockers.</label>
     <label style={{display:'block'}}>Type <strong>DELETE COMPANY {data.company_name}</strong> exactly
      <input value={typed} onChange={e=>setTyped(e.target.value)} autoComplete="off" spellCheck={false} style={{display:'block',width:'100%',marginTop:10,padding:12,borderRadius:9,color:'#102030',background:'#f7f4ed'}}/>
     </label>
     <button type="button" style={{...button,background:'#8e3031',borderColor:'#e19b92',marginTop:18,opacity:readyToErase?1:0.5,cursor:readyToErase?'pointer':'not-allowed'}} disabled={!readyToErase} aria-describedby="v21-erasure-readiness" onClick={()=>void erase()}><Trash2 size={17}/>{busy?'Processing…':'Permanently delete company'}</button>
     <div id="v21-erasure-readiness" role="status" aria-live="polite" style={{marginTop:14,padding:14,border:'1px solid #8b785c',borderRadius:9,background:'#0f2134'}}>
      <strong style={{color:readyToErase?'#b8ebc6':'#f3cc89'}}>{busy?'Processing request…':readyToErase?'Ready for irreversible deletion.':'Deletion is not ready yet:'}</strong>
      {missing.length>0&&<ul style={{margin:'9px 0 0 20px',listStyle:'disc',color:'#e5e8ef'}}>{missing.map((why,i)=><li key={i} style={{padding:'3px 0'}}>{why}</li>)}</ul>}
     </div>
     {data.state==='closing'&&caseId&&<button type="button" style={{...button,marginTop:15,marginLeft:10}} disabled={busy} onClick={()=>void cancel()}>Cancel staged closure and unlock</button>}
    </section>
   </>}
  </div>
 </main>;
}
