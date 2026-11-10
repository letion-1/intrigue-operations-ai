'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Bell,RefreshCcw,X} from 'lucide-react';
import {createClient} from '@/lib/supabase/client';
import {createPlatformClient} from '@/lib/intrigue-platform-auth-client';

type Notice={id:string;ticket_id:string;workspace_id:string;subject:string;workspace_name:string;event_type:string;created_at:string;is_read:boolean};
type Result={items:Notice[];unread_count:number};
type Props={audience:'client'|'operator';workspaceId?:string|null};
const label:Record<string,string>={
 new_ticket:'New support request',
 client_reply:'Client replied to a ticket',
 support_reply:'INTRIGUE Support replied',
 status_resolved:'Support request resolved',
 status_closed:'Support request closed',
};

export default function SupportNotifications({audience,workspaceId}:Props){
 const client=useMemo(()=>audience==='operator'?createPlatformClient():createClient(),[audience]);
 const [items,setItems]=useState<Notice[]>([]),[unread,setUnread]=useState(0);
 const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const guard=useRef(false);
 const url=useMemo(()=>'/api/support-notifications?audience='+audience+(audience==='client'?'&workspace_id='+encodeURIComponent(workspaceId||''):''),[audience,workspaceId]);
 const enabled=audience==='operator'||!!workspaceId;
 const request=useCallback(async(method:'GET'|'POST',body?:object)=>{
  const {data:{session}}=await client.auth.getSession();
  if(!session?.access_token)throw new Error('Please sign in to view notifications.');
  const response=await fetch(url,{method,cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||`Notification service returned ${response.status}`);
  return result;
 },[client,url]);
 const load=useCallback(async()=>{
  if(!enabled||guard.current)return;
  guard.current=true;setLoading(true);
  try{
   const data=await request('GET') as Result;
   setItems(Array.isArray(data.items)?data.items:[]);
   setUnread(Number(data.unread_count)||0);setError('');
  }catch(e){setError(e instanceof Error?e.message:'Notifications unavailable.');}
  finally{guard.current=false;setLoading(false);}
 },[enabled,request]);
 useEffect(()=>{
  if(!enabled){setItems([]);setUnread(0);return;}
  void load();
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},30000);
  const focus=()=>void load();
  window.addEventListener('focus',focus);
  return()=>{clearInterval(timer);window.removeEventListener('focus',focus);};
 },[enabled,load]);
 async function visit(item:Notice){
  try{if(!item.is_read)await request('POST',{action:'mark_read',notification_id:item.id});}
  catch{ /* Navigation still works; reading is retried on next open. */ }
  window.location.assign(audience==='operator'?'/platform?ticket='+encodeURIComponent(item.ticket_id):'/help-center?ticket='+encodeURIComponent(item.ticket_id)+'&workspace='+encodeURIComponent(item.workspace_id));
 }
 return <div className="relative">
  <button type="button" aria-label={unread?`Support notifications, ${unread} unread`:'Support notifications'} aria-expanded={open}
   onClick={()=>{setOpen(o=>!o);if(!open)void load();}}
   className="relative inline-flex items-center justify-center rounded-xl border border-[#415064] p-2 text-[#d9c18b] transition hover:bg-[#26384d]">
   <Bell size={18}/>{unread>0&&<span className="absolute -right-2 -top-2 min-w-[19px] rounded-full bg-[#c49a4e] px-1 text-center text-[10px] font-bold leading-[19px] text-[#0b1827]">{unread>99?'99+':unread}</span>}
  </button>
  {open&&<div role="dialog" aria-label="Support notifications" className="absolute right-0 top-12 z-50 w-[min(360px,85vw)] rounded-2xl border border-[#4a5e73] bg-[#13263b] p-3 text-[#f2eee6] shadow-2xl">
   <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-[#f1d189]">Support notifications</h3>
    <div className="flex gap-2"><button type="button" aria-label="Refresh notifications" onClick={()=>void load()} className="rounded-lg p-1 hover:bg-[#26384d]"><RefreshCcw size={16}/></button><button type="button" aria-label="Close notifications" onClick={()=>setOpen(false)} className="rounded-lg p-1 hover:bg-[#26384d]"><X size={16}/></button></div>
   </div>
   {error&&<p className="mt-3 text-xs text-[#ffb5ae]" role="alert">{error}</p>}
   {!error&&loading&&items.length===0&&<p className="mt-3 text-xs text-[#b6c5d5]">Loading…</p>}
   {!error&&!loading&&items.length===0&&<p className="mt-3 text-xs text-[#b6c5d5]">No support updates yet.</p>}
   <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto">
    {items.map(n=><button key={n.id} type="button" onClick={()=>void visit(n)} className={`w-full rounded-xl border p-3 text-left hover:bg-[#26384d] ${n.is_read?'border-[#364a5e]':'border-[#c49a4e]/70 bg-[#1c3449]'}`}>
      <span className="block text-xs font-semibold text-[#f0ce88]">{label[n.event_type]||'Support update'}{audience==='operator'?` · ${n.workspace_name}`:''}{!n.is_read?' · New':''}</span>
      <span className="mt-1 block truncate text-xs text-[#e3e8ee]">{n.subject}</span>
      <span className="mt-1 block text-[10px] text-[#aab8c7]">{new Date(n.created_at).toLocaleString()}</span>
     </button>)}
   </div>
  </div>}
 </div>;
}
