"use client";
import {useCallback,useEffect,useState} from "react";
type Settings={time_zone:string;start_hour:number;end_hour:number;duration_minutes:number;booking_enabled:boolean};
type Event={id:string;title:string;start:string};
const button="rounded-lg border border-[#c6a455] px-3 py-2 text-xs font-semibold text-[#f1d28c] disabled:opacity-40";
const field="rounded-lg border border-[#41556b] bg-[#0d1e30] px-3 py-2 text-sm text-[#f4efe5]";
export default function GoogleCalendarVoice(){
  const [connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState(""),[error,setError]=useState("");
  const [settings,setSettings]=useState<Settings>({time_zone:"Europe/Berlin",start_hour:9,end_hour:17,duration_minutes:30,booking_enabled:false});
  const [events,setEvents]=useState<Event[]>([]);
  const refresh=useCallback(async()=>{setBusy(true);setError("");try{
    const resp=await fetch("/api/integrations/google-calendar/settings",{cache:"no-store"});const data=await resp.json();
    if(!resp.ok)throw Error(data.error||"Google Calendar unavailable");setConnected(!!data.connected);setSettings(data.settings);setEvents(data.events||[]);
    if(data.warning)setError(data.warning);
  }catch(e){setError(e instanceof Error?e.message:"Could not load Google Calendar");}finally{setBusy(false);}},[]);
  useEffect(()=>{void refresh();const params=new URLSearchParams(window.location.search);const next=params.get("google_calendar");
    if(next)setStatus(next==="connected"?"Google Calendar authorized. Configure business hours below.":"Google authorization failed. Check OAuth settings and test-user access.");},[refresh]);
  async function save(){if(settings.booking_enabled&&!window.confirm("Enable REAL Google Calendar invitations from Ava after explicit caller confirmation?"))return;
    setBusy(true);setError("");setStatus("");try{const r=await fetch("/api/integrations/google-calendar/settings",{
      method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(settings)});const d=await r.json();if(!r.ok)throw Error(d.error||"Could not save settings");
      setStatus(settings.booking_enabled?"Live Google booking ENABLED for this company.":"Settings saved. Live booking remains disabled.");await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Save failed");}finally{setBusy(false);}}
  async function disconnect(){if(!window.confirm("Disconnect Google Calendar? Future Ava bookings will be disabled, existing meetings will remain."))return;
    setBusy(true);try{const r=await fetch("/api/integrations/google-calendar/settings",{method:"DELETE"});const d=await r.json();if(!r.ok)throw Error(d.error||"Disconnect failed");
      setStatus("Google Calendar disconnected. Previously created meetings remain.");await refresh();}catch(e){setError(e instanceof Error?e.message:"Disconnect failed");}finally{setBusy(false);}}
  const update=<K extends keyof Settings>(name:K,value:Settings[K])=>setSettings(s=>({...s,[name]:value}));
  return <section className="mt-5 rounded-xl border border-[#baa05f]/60 bg-[#101f32] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-[#f2dfb6]">V15.7 · Google Calendar direct booking</h3><span className="text-xs text-[#b8d3e2]">{connected?"Connected":"Not connected"} · {settings.booking_enabled?"LIVE booking enabled":"Booking disabled"}</span></div>
    <p className="mt-2 text-xs leading-5 text-[#b8c7d4]">Free/busy checking and appointment invitations from Ava. Uses Google Calendar, not Calendly. Only your company owner can authorize it. Available Monday–Friday during the hours set below.</p>
    <div className="mt-3 flex flex-wrap gap-2"><a className={button} href="/api/integrations/google-calendar/start">{connected?"Reconnect Google Calendar":"Connect Google Calendar"}</a>
      <button className={button} disabled={busy} type="button" onClick={()=>void refresh()}>Refresh Google events</button>
      {connected&&<button className={button} disabled={busy} type="button" onClick={()=>void disconnect()}>Disconnect</button>}</div>
    {connected&&<>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="text-xs text-[#efd5a1]">Business timezone<input className={`${field} mt-1 w-full`} value={settings.time_zone} maxLength={80} onChange={e=>update("time_zone",e.target.value)}/></label>
        <label className="text-xs text-[#efd5a1]">Open hour (24h)<select className={`${field} mt-1 w-full`} value={settings.start_hour} onChange={e=>update("start_hour",Number(e.target.value))}>{Array.from({length:23},(_,i)=><option key={i} value={i}>{i}:00</option>)}</select></label>
        <label className="text-xs text-[#efd5a1]">Close hour (24h)<select className={`${field} mt-1 w-full`} value={settings.end_hour} onChange={e=>update("end_hour",Number(e.target.value))}>{Array.from({length:23},(_,i)=><option key={i} value={i+1}>{i+1}:00</option>)}</select></label>
        <label className="text-xs text-[#efd5a1]">Meeting duration<select className={`${field} mt-1 w-full`} value={settings.duration_minutes} onChange={e=>update("duration_minutes",Number(e.target.value))}><option value={30}>30 minutes</option><option value={60}>60 minutes</option></select></label>
      </div>
      <label className="mt-4 flex items-start gap-2 text-sm text-[#f4efe5]"><input className="mt-1" type="checkbox" checked={settings.booking_enabled} onChange={e=>update("booking_enabled",e.target.checked)}/>Enable real Google Calendar event creation and invitee email invitations by Ava after confirmed details</label>
      <button className={`${button} mt-3`} type="button" disabled={busy} onClick={()=>void save()}>{busy?"Saving...":"Save Google booking settings"}</button>
      <div className="mt-4"><strong className="text-xs text-[#f1d28c]">Upcoming Google events</strong>{events.length?events.map(e=><div key={e.id} className="mt-2 flex justify-between gap-2 rounded-lg border border-[#40536a] p-2 text-xs text-[#e9eef0]"><span>{e.title}</span><span>{new Date(e.start).toLocaleString()}</span></div>):<p className="mt-2 text-xs text-[#9db5c5]">No upcoming timed events found.</p>}</div>
    </>}
    {status&&<p role="status" className="mt-3 text-xs text-[#abe7c1]">{status}</p>}{error&&<p role="alert" className="mt-3 text-xs text-[#ffc0b6]">{error}</p>}
    <p className="mt-3 text-xs leading-5 text-[#a7b9c9]">Vapi tools: google_check_availability, google_book_appointment. The existing Vapi webhook URL and Bearer credential stay unchanged. Google OAuth in Testing mode may require a test-user allowlist and has short-lived refresh tokens.</p>
  </section>;
}
