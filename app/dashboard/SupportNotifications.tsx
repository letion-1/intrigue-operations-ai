'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Bell,RefreshCcw,X} from 'lucide-react';
import {createClient} from '@/lib/supabase/client';
import {createPlatformClient} from '@/lib/intrigue-platform-auth-client';
import styles from './SupportNotifications.module.css';

type Notice={id:string;ticket_id:string|null;workspace_id:string;subject:string;workspace_name:string;event_type:string;created_at:string;is_read:boolean;source:'support'|'usage'};
type Result={items:Notice[];unread_count:number};
type Props={audience:'client'|'operator';workspaceId?:string|null};
const label:Record<string,string>={
 new_ticket:'New support request',
 client_reply:'Client replied to a ticket',
 support_reply:'INTRIGUE Support replied',
 status_resolved:'Support request resolved',
 status_closed:'Support request closed',
 ai_allowance_reached:'Monthly AI allowance reached',
};

export default function SupportNotifications({audience,workspaceId}:Props){
 const client=useMemo(()=>audience==='operator'?createPlatformClient():createClient(),[audience]);
 const [items,setItems]=useState<Notice[]>([]),[unread,setUnread]=useState(0);
 const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const guard=useRef(false);
 const root=useRef<HTMLDivElement>(null);
 const url=useMemo(()=>'/api/support-notifications?audience='+audience+(audience==='client'?'&workspace_id='+encodeURIComponent(workspaceId||''):''),[audience,workspaceId]);
 const enabled=audience==='operator'||!!workspaceId;
 const request=useCallback(async(method:'GET'|'POST',body?:object)=>{
  const {data:{session}}=await client.auth.getSession();
  if(!session?.access_token)throw new Error('Please sign in to view notifications.');
  const response=await fetch(url,{method,cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Notifications are temporarily unavailable.');
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
 useEffect(()=>{
  if(!open)return;
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};
  const outside=(e:PointerEvent)=>{if(root.current&&!root.current.contains(e.target as Node))setOpen(false);};
  document.addEventListener('keydown',key);document.addEventListener('pointerdown',outside);
  return()=>{document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside);};
 },[open]);
 async function visit(item:Notice){
  try{if(!item.is_read)await request('POST',{action:'mark_read',notification_id:item.id,source:item.source});}
  catch{/* Navigation remains available; read receipt can be retried later. */}
  if(item.source==='usage'){
   window.location.assign(audience==='operator'?'/platform/ai-usage?workspace_id='+encodeURIComponent(item.workspace_id):'/dashboard?usage=1');
   return;
  }
  if(!item.ticket_id)return;
  window.location.assign(audience==='operator'?'/platform?ticket='+encodeURIComponent(item.ticket_id):'/help-center?ticket='+encodeURIComponent(item.ticket_id)+'&workspace='+encodeURIComponent(item.workspace_id));
 }
 return <div className={styles.root} ref={root}>
  <button type="button" aria-label={unread?`Notifications, ${unread} unread`:'Notifications'} aria-expanded={open} aria-haspopup="dialog"
   onClick={()=>{setOpen(o=>!o);if(!open)void load();}} className={styles.trigger}>
   <Bell size={18}/>{unread>0&&<span className={styles.counter}>{unread>99?'99+':unread}</span>}
  </button>
  {open&&<div role="dialog" aria-label="Notifications" className={styles.panel}>
   <div className={styles.heading}><h3>Notifications</h3>
    <div className={styles.actions}>
     <button type="button" aria-label="Refresh notifications" onClick={()=>void load()}><RefreshCcw size={16}/></button>
     <button type="button" aria-label="Close notifications" onClick={()=>setOpen(false)}><X size={16}/></button>
    </div>
   </div>
   {error&&<p className={styles.error} role="alert">{error}</p>}
   {!error&&loading&&items.length===0&&<p className={styles.muted}>Loading…</p>}
   {!error&&!loading&&items.length===0&&<p className={styles.muted}>No updates yet.</p>}
   <div className={styles.list}>
    {items.map(n=><button key={`${n.source}:${n.id}`} type="button" onClick={()=>void visit(n)}
      className={`${styles.notice} ${n.is_read?styles.read:styles.unread}`}>
      <span className={styles.label}>{label[n.event_type]||'Notification update'}{audience==='operator'?` · ${n.workspace_name}`:''}{!n.is_read?' · New':''}</span>
      <span className={styles.subject}>{n.subject}</span>
      <span className={styles.date}>{new Date(n.created_at).toLocaleString()}</span>
     </button>)}
   </div>
  </div>}
 </div>;
}
