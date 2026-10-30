"use client";
import {useCallback,useEffect,useState} from "react";
import GoogleCalendarVoice from "./google-calendar-voice";

type Provider="cal"|"calendly";
type Status={cal:{connected:boolean;connected_at:string|null};calendly:{connected:boolean;connected_at:string|null}};
type VoiceSettings={connected:boolean;event_types:Array<{uri:string;name:string;duration:number|null}>;settings:{event_type_uri:string;booking_enabled:boolean}|null};
type Booking={id:string;title:string;start:string;end:string;status:string;provider:string};
const providers:[Provider,string][]=[["cal","Cal.com"],["calendly","Calendly"]];
const card="rounded-2xl border border-[#35485d] bg-[#142539] p-5 md:p-6";
const button="rounded-lg border border-[#baa05f] px-3 py-2 text-xs font-semibold text-[#e9c881] disabled:opacity-40";
export default function CalendarConnections(){
  const [status,setStatus]=useState<Status|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<Provider|null>(null);
  const [selected,setSelected]=useState<Provider>("cal");
  const [bookings,setBookings]=useState<Booking[]>([]);
  const [message,setMessage]=useState("");
  const [voice,setVoice]=useState<VoiceSettings|null>(null);
  const [voiceEvent,setVoiceEvent]=useState("");
  const [voiceEnabled,setVoiceEnabled]=useState(false);
  const [voiceBusy,setVoiceBusy]=useState(false);
  const [voiceNote,setVoiceNote]=useState("");
  const [error,setError]=useState("");
  const refresh=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const response=await fetch("/api/integrations/calendar/connections",{cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Calendar connection status unavailable");
      setStatus(data as Status);
    }catch(e){setError(e instanceof Error?e.message:"Could not load connections");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();const params=new URLSearchParams(window.location.search);
    const result=params.get("integration");
    if(result==="connected")setMessage("Calendar authorized. You can now read upcoming meetings.");
    if(result==="failed")setError("Calendar authorization failed or expired. Check provider credentials and reconnect.");
    if(result)window.history.replaceState(null,"",window.location.pathname);
  },[refresh]);
  const loadVoice=useCallback(async()=>{
    try{
      const response=await fetch("/api/integrations/calendar/voice-booking",{cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Voice booking configuration unavailable");
      const next=data as VoiceSettings;setVoice(next);
      setVoiceEvent(next.settings?.event_type_uri||next.event_types[0]?.uri||"");
      setVoiceEnabled(next.settings?.booking_enabled||false);
    }catch(e){setVoiceNote(e instanceof Error?e.message:"Could not check voice booking");}
  },[]);
  useEffect(()=>{void loadVoice();},[loadVoice]);
  async function saveVoice(){
    if(voiceEnabled&&!window.confirm("This lets your Vapi receptionist create real Calendly meetings after caller confirmation. Enable live booking for this company?"))return;
    setVoiceBusy(true);setVoiceNote("");
    try{
      const response=await fetch("/api/integrations/calendar/voice-booking",{method:"PUT",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({event_type_uri:voiceEvent,enabled:voiceEnabled})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Could not save voice settings");
      setVoiceNote(voiceEnabled?"Live Vapi booking ENABLED for this meeting type.":"Meeting type saved. Actual booking remains disabled.");
      await loadVoice();
    }catch(e){setVoiceNote(e instanceof Error?e.message:"Voice booking settings unavailable");}
    finally{setVoiceBusy(false);}
  }
  async function disconnect(provider:Provider){
    if(!window.confirm(`Disconnect ${provider==="cal"?"Cal.com":"Calendly"} from this company?`))return;
    setBusy(provider);setError("");setMessage("");
    try{
      const response=await fetch("/api/integrations/calendar/connections",{
        method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider}),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Disconnect failed");
      setBookings([]);setMessage("Local connection removed. You can also revoke INTRIGUE access in the provider's security settings.");
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Could not disconnect");}
    finally{setBusy(null);}
  }
  async function loadBookings(){
    setBusy(selected);setError("");setMessage("");setBookings([]);
    try{
      const response=await fetch(`/api/integrations/calendar/bookings?provider=${selected}`,{cache:"no-store"});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Could not read upcoming meetings");
      setBookings(data.bookings||[]);
      setMessage((data.bookings||[]).length?"Upcoming bookings loaded from your calendar.":"No upcoming bookings found in this connected account.");
    }catch(e){setError(e instanceof Error?e.message:"Cannot load calendar");}
    finally{setBusy(null);}
  }
  return <section className={card}>
    <h2 className="text-lg font-semibold text-[#f4efe5]">Live calendar connections</h2>
    <p className="mt-2 text-sm leading-6 text-[#b8c7d4]">Connect a company calendar using its own OAuth authorization. Tokens are encrypted on the server. V15.4 can read upcoming meetings, but cannot create or cancel bookings.</p>
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      {providers.map(([provider,name])=>{
        const connected=status?.[provider].connected||false;
        return <div className="rounded-xl border border-[#41556b] bg-[#0d1e30] p-4" key={provider}>
          <div className="flex items-center justify-between gap-2"><strong className="text-[#f6eedc]">{name}</strong><span className={"text-xs "+(connected?"text-[#a7ebca]":"text-[#adbccc]")}>{loading?"Checking...":connected?"Connected":"Not connected"}</span></div>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={`/api/integrations/calendar/start?provider=${provider}`} className={button}>{connected?"Reconnect":"Connect account"}</a>
            {connected&&<button className={button} type="button" disabled={busy!==null} onClick={()=>void disconnect(provider)}>Disconnect</button>}
          </div>
        </div>;
      })}
    </div>
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <label className="text-xs text-[#ead098]" htmlFor="v154-provider">Upcoming meetings</label>
      <select id="v154-provider" value={selected} onChange={e=>{setSelected(e.target.value as Provider);setBookings([]);setMessage("");}} className="rounded-lg border border-[#41556b] bg-[#0d1e30] px-3 py-2 text-xs text-[#f6eedc]">
        <option value="cal">Cal.com</option><option value="calendly">Calendly</option>
      </select>
      <button type="button" className={button} disabled={loading||busy!==null||!status?.[selected].connected} onClick={()=>void loadBookings()}>{busy===selected?"Loading...":"Load upcoming meetings"}</button>
      <button type="button" className={button} disabled={loading||busy!==null} onClick={()=>void refresh()}>Refresh connection status</button>
    </div>
    {error&&<p role="alert" className="mt-3 text-sm text-[#ffbbb1]">{error}</p>}
    {message&&<p role="status" className="mt-3 text-sm text-[#afe3c8]">{message}</p>}
    {bookings.length>0&&<div className="mt-4 space-y-2">{bookings.map(b=><div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#41556b] px-3 py-3 text-sm text-[#f3ede2]"><span className="break-words">{b.title}</span><time className="text-xs text-[#bcd0dc]" dateTime={b.start}>{new Date(b.start).toLocaleString()}</time></div>)}</div>}
    <div className="mt-6 rounded-xl border border-[#baa05f]/60 bg-[#101f32] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-[#f2dfb6]">V15.6 · Vapi + Calendly voice scheduling</h3><span className="text-xs text-[#c7d7e2]">{voice?.settings?.booking_enabled?"Live booking enabled":"Booking disabled by default"}</span></div>
      <p className="mt-2 text-xs leading-5 text-[#b8c7d4]">Choose a Calendly meeting type. Ava can check real availability. Booking actual appointments requires a paid Calendly plan, new OAuth scopes and your explicit activation. No meeting is booked just by saving settings.</p>
      {!voice?.connected?<p className="mt-3 text-xs text-[#ffcfaa]">Connect or reconnect Calendly with event_types:read, availability:read and scheduled_events:write permissions first.</p>:<>
        <label htmlFor="v156-event" className="mt-3 block text-xs text-[#efd5a1]">Allowed meeting type</label>
        <select id="v156-event" className="mt-1 w-full rounded-lg border border-[#41556b] bg-[#0d1e30] p-2 text-sm text-[#f4efe5]" value={voiceEvent} onChange={e=>{setVoiceEvent(e.target.value);setVoiceEnabled(false);}}>
          {voice.event_types.map(t=><option key={t.uri} value={t.uri}>{t.name} {t.duration?`(${t.duration} min)`:""}</option>)}
        </select>
        <label className="mt-3 flex items-start gap-2 text-sm text-[#f4efe5]"><input type="checkbox" checked={voiceEnabled} onChange={e=>setVoiceEnabled(e.target.checked)} className="mt-1"/>Enable actual Calendly bookings by Vapi after the caller confirms a slot, name and email</label>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} onClick={()=>void saveVoice()} disabled={voiceBusy||!voiceEvent}>{voiceBusy?"Saving...":"Save voice booking settings"}</button><button type="button" className={button} onClick={()=>void loadVoice()} disabled={voiceBusy}>Refresh meeting types</button></div>
      </>}
      {voiceNote&&<p role="status" className="mt-3 text-xs text-[#ffc9a4]">{voiceNote}</p>}
      <p className="mt-3 text-xs text-[#9db5c5]">Vapi tool names: check_availability, book_appointment. Use your existing authenticated Vapi webhook URL and Bearer credential. Do not enable bookings until test tool calls and consent handling pass.</p>
    </div>
    <GoogleCalendarVoice />
    <p className="mt-4 text-xs leading-5 text-[#96a9ba]">Only the signed-in company owner may manage scheduling. Other calendar integrations and outbound email are unchanged.</p>
  </section>;
}
