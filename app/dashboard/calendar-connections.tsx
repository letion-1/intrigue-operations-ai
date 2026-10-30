"use client";
import {useCallback,useEffect,useState} from "react";

type Provider="cal"|"calendly";
type Status={cal:{connected:boolean;connected_at:string|null};calendly:{connected:boolean;connected_at:string|null}};
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
    <p className="mt-4 text-xs leading-5 text-[#96a9ba]">Only the signed-in company owner may connect or read calendar bookings. Live write booking, Vapi receptionist tools, webhook synchronization and email remain separate upgrades.</p>
  </section>;
}
