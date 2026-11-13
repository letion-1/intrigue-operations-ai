'use client';
import {useState} from 'react';
import {createClient} from '@/lib/supabase/client';
export default function SummaryRecoveryButton({workspaceId,onRecovered}:{workspaceId:string;onRecovered:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[offset,setOffset]=useState(0),[notice,setNotice]=useState('');
 async function recover(){
  setBusy(true);setNotice('');
  try{
   const {data:{session}}=await createClient().auth.getSession();
   if(!session?.access_token)throw Error('Please sign in again.');
   const r=await fetch('/api/receptionist/summaries',{method:'POST',credentials:'same-origin',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({workspace_id:workspaceId,offset})});
   const b=await r.json();if(!r.ok)throw Error(b.error||'Summary recovery failed.');
   setNotice(`Checked ${b.checked} calls · recovered ${b.recovered} summaries · ${b.without_analysis} unavailable in Vapi · ${b.errors} errors.`);
   setOffset(Number(b.next_offset)||offset+10);await onRecovered();
  }catch(e){setNotice(e instanceof Error?e.message:'Summary recovery failed.');}
  finally{setBusy(false);}
 }
 return <div className="flex flex-wrap items-center gap-2">
  <button type="button" className="rounded-lg border border-[#c5a25b] px-3 py-2 text-xs text-[#efd18e] disabled:opacity-50" disabled={busy||offset>=1000} onClick={()=>void recover()}>
    {busy?'Checking Vapi...':'Recover available summaries (10 calls)'}
  </button>
  <button type="button" className="rounded-lg border border-[#657085] px-2 py-2 text-xs" disabled={busy} onClick={()=>{setOffset(0);setNotice('Restarted at newest calls.');}}>Start from newest</button>
  <span className="text-xs opacity-70">Page {Math.floor(offset/10)+1}</span>
  {notice&&<p role="status" className="w-full text-xs text-[#b6c9d8]">{notice}</p>}
 </div>;
}
