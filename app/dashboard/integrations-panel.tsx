'use client';
import {useCallback,useEffect,useMemo,useState,type FormEvent} from 'react';
import {createClient} from '@/lib/supabase/client';
import VapiReceptionist from './vapi-receptionist';
import BusinessEmailConnections from './integrations/BusinessEmailConnections';
import CalendarProviderConnections from './integrations/CalendarProviderConnections';
import CrmConnections from './integrations/CrmConnections';

type Scheduler='none'|'cal'|'calendly';
type MailProvider='none'|'gmail'|'outlook';
type Preferences={scheduling_provider:Scheduler;booking_url:string;vapi_assistant_id:string;preferred_email_provider:MailProvider};
const EMPTY:Preferences={scheduling_provider:'none',booking_url:'',vapi_assistant_id:'',preferred_email_provider:'none'};
const box='rounded-2xl border border-[#35485d] bg-[#142539] p-5 md:p-6';
const field='w-full rounded-xl border border-[#41556b] bg-[#0d1e30] px-3 py-2.5 text-sm text-[#f4efe5] focus:border-[#d5b362] outline-none';
function validBooking(provider:Scheduler,value:string){
  if(provider==='none')return !value.trim();
  try{const url=new URL(value);const host=provider==='cal'?'cal.com':'calendly.com';
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.pathname.length>1&&(url.hostname===host||url.hostname.endsWith('.'+host));
  }catch{return false;}
}
export default function IntegrationsPanel({workspaceId,onImported,onOpenCalendar,onOpenReceptionist}:{workspaceId:string;onImported:()=>void;onOpenCalendar?:()=>void;onOpenReceptionist?:()=>void}){
  const supabase=useMemo(()=>createClient(),[]);
  const [pref,setPref]=useState<Preferences>(EMPTY);const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);
  const [status,setStatus]=useState('');const [error,setError]=useState('');
  const load=useCallback(async()=>{setLoading(true);
    const {data,error}=await supabase.from('workspace_integration_preferences').select('scheduling_provider,booking_url,vapi_assistant_id,preferred_email_provider').eq('workspace_id',workspaceId).maybeSingle();
    if(error)setError(error.message);else setPref(data as Preferences||EMPTY);
    setLoading(false);
  },[supabase,workspaceId]);
  useEffect(()=>{void load();},[load]);
  async function save(event?:FormEvent<HTMLFormElement>){
    event?.preventDefault();setError('');setStatus('');
    const bookingUrl=pref.scheduling_provider==='none'?'':pref.booking_url.trim();
    if(!validBooking(pref.scheduling_provider,bookingUrl)){setError('Enter a valid HTTPS scheduling URL for your selected provider.');return;}
    setSaving(true);
    const {error}=await supabase.from('workspace_integration_preferences').upsert({workspace_id:workspaceId,scheduling_provider:pref.scheduling_provider,booking_url:bookingUrl,vapi_assistant_id:pref.vapi_assistant_id.trim(),preferred_email_provider:pref.preferred_email_provider,updated_at:new Date().toISOString()},{onConflict:'workspace_id'});
    if(error)setError(error.message);else setStatus('Company integration preferences saved.');
    setSaving(false);
  }
  return <div className="space-y-6">
    <div className={box}>
      <h2 className="text-lg font-semibold">Connected services</h2>
      <p className="mt-2 text-sm leading-6 opacity-80">Manage business integrations in one place. A saved provider preference is not proof of a successful connection.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <button type="button" className="rounded-xl border border-[#9b8351]/60 p-4 text-left" onClick={onOpenCalendar}><strong>Calendar & scheduling</strong><span className="mt-2 block text-xs opacity-70">Manage availability and booking permissions</span></button>
        <button type="button" className="rounded-xl border border-[#9b8351]/60 p-4 text-left" onClick={onOpenReceptionist}><strong>AI Receptionist</strong><span className="mt-2 block text-xs opacity-70">Manage voice configuration and call logs</span></button>
      </div>
    </div>
    <CrmConnections workspaceId={workspaceId} onImported={onImported}/>
    <BusinessEmailConnections workspaceId={workspaceId}/>
    <CalendarProviderConnections workspaceId={workspaceId} onOpenCalendar={onOpenCalendar}
      bookingProvider={pref.scheduling_provider} bookingUrl={pref.booking_url}
      onBookingProviderChange={provider=>setPref(p=>({...p,scheduling_provider:provider,booking_url:''}))}
      onBookingUrlChange={value=>setPref(p=>({...p,booking_url:value}))}
      onSaveBooking={()=>{void save();}} preferenceLoading={loading} preferenceSaving={saving}
      preferenceStatus={status} preferenceError={error}/>
    <details className={box}>
      <summary className="cursor-pointer text-sm font-semibold">Advanced connection settings</summary>
      <form onSubmit={save} className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-xs">Vapi assistant ID (optional)
          <input className={field+' mt-2'} value={pref.vapi_assistant_id} maxLength={100} onChange={e=>setPref(p=>({...p,vapi_assistant_id:e.target.value}))} placeholder="Assistant ID, never API key"/>
        </label>
        <label className="text-xs">Preferred email service
          <select className={field+' mt-2'} value={pref.preferred_email_provider} onChange={e=>setPref(p=>({...p,preferred_email_provider:e.target.value as MailProvider}))}>
            <option value="none">Not selected</option><option value="gmail">Gmail</option><option value="outlook">Outlook</option>
          </select>
        </label>
        <div className="md:col-span-2"><button type="submit" disabled={loading||saving} className="rounded-xl bg-[#c9a552] px-4 py-2.5 text-sm font-semibold text-[#172336]">{saving?'Saving…':'Save preferences'}</button></div>
        {status&&<p role="status" className="text-xs text-emerald-400">{status}</p>}
        {error&&<p role="alert" className="text-xs text-red-400">{error}</p>}
      </form>
      <div className="mt-4"><VapiReceptionist workspaceId={workspaceId}/></div>
    </details>
    <div className="rounded-xl border border-[#9b8351]/40 px-4 py-3 text-xs leading-5 opacity-80">For file imports, use <strong>Customers & CRM → Import contacts</strong>. Zoho, HubSpot and Pipedrive authorization is separate from importing an exported CSV file.</div>
  </div>;
}
