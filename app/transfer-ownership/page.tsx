'use client';
import {useMemo,useState} from 'react';
import {createClient} from '@/lib/supabase/client';

export default function OwnershipTransferPage(){
 const db=useMemo(()=>createClient(),[]);
 const [transferId,setTransferId]=useState('');const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 async function accept(){
   setBusy(true);setMessage('');
   try{
     const {data:{session}}=await db.auth.getSession();
     if(!session?.access_token)throw new Error('Sign in to the recipient account first.');
     const res=await fetch('/api/account/lifecycle',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action:'accept_transfer',transfer_id:transferId.trim()})});
     const data=await res.json();if(!res.ok)throw new Error(data.error||'Transfer not accepted.');
     setMessage('Ownership transfer accepted. Your team membership is now owner. Open the dashboard to continue.');
   }catch(e){setMessage(e instanceof Error?e.message:'Transfer failed.');}
   finally{setBusy(false);}
 }
 return <main style={{maxWidth:620,margin:'60px auto',padding:28,fontFamily:'system-ui',lineHeight:1.6}}>
   <h1>INTRIGUE · Accept company ownership</h1>
   <p>Sign in as the nominated team member. Accept only transfers you expect. You will become responsible for the company's data and integrations.</p>
   <label htmlFor="transfer-id">Transfer reference</label>
   <input id="transfer-id" style={{display:'block',width:'100%',padding:12,margin:'10px 0'}} value={transferId} onChange={e=>setTransferId(e.target.value)} placeholder="Paste transfer reference" />
   <button type="button" disabled={busy||!transferId.trim()} onClick={()=>void accept()} style={{padding:'11px 17px',borderRadius:8,background:'#cba65b',color:'#102137'}}>{busy?'Checking…':'Accept transfer'}</button>
   {message&&<p role="status">{message}</p>}
   <p><a href="/dashboard">Return to dashboard</a></p>
 </main>;
}
