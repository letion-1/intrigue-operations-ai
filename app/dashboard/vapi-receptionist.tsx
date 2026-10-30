"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type State = {configured:boolean;assistant_id?:string;last_verified_at?:string|null;configured_at?:string};
type CallRow = {id:number;call_id:string;ended_reason:string;received_at:string};
const panel="rounded-2xl border border-[#35485d] bg-[#142539] p-5 md:p-6";
const field="w-full rounded-xl border border-[#41556b] bg-[#0d1e30] px-3 py-2.5 text-sm text-[#f4efe5] focus:border-[#d5b362] outline-none";
const button="rounded-lg border border-[#baa05f] px-3 py-2.5 text-xs font-semibold text-[#e9c881] disabled:opacity-40";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function VapiReceptionist({workspaceId}:{workspaceId:string}){
  const supabase=useMemo(()=>createClient(),[]);
  const [state,setState]=useState<State|null>(null);
  const [assistantId,setAssistantId]=useState("");
  const [token,setToken]=useState("");
  const [calls,setCalls]=useState<CallRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const webhook="https://intrigue-operations-ai-5ywh.vercel.app/api/integrations/vapi/webhook";

  const refresh=useCallback(async()=>{
    setLoading(true);
    try{
      const [connection,events]=await Promise.all([
        supabase.rpc("intrigue_vapi_manage",{p_workspace_id:workspaceId,p_operation:"status"}),
        supabase.from("intrigue_vapi_call_events")
          .select("id,call_id,ended_reason,received_at")
          .eq("workspace_id",workspaceId).order("received_at",{ascending:false}).limit(15),
      ]);
      if(connection.error)throw new Error(connection.error.message);
      if(events.error)throw new Error(events.error.message);
      const s=connection.data as State;
      setState(s);
      if(s.assistant_id)setAssistantId(s.assistant_id);
      setCalls((events.data||[]) as CallRow[]);
      setError("");
    }catch(e){setError(e instanceof Error?e.message:"Could not load Vapi status");}
    finally{setLoading(false);}
  },[supabase,workspaceId]);
  useEffect(()=>{void refresh();},[refresh]);

  async function issue(){
    if(!uuid.test(assistantId.trim())){setError("Paste your saved Vapi Assistant UUID (not your API key).");return;}
    if(state?.configured && !window.confirm("Rotate the webhook credential? Existing Vapi calls will stop reporting until you update the credential in Vapi."))return;
    setBusy(true);setError("");setNotice("");setToken("");
    try{
      const {data,error:e}=await supabase.rpc("intrigue_vapi_manage",{
        p_workspace_id:workspaceId,p_operation:"issue",p_assistant_id:assistantId.trim(),
      });
      if(e)throw new Error(e.message);
      const issued=(data as {credential?:string}).credential||"";
      if(!issued)throw new Error("No credential returned");
      setToken(issued);
      setNotice("Credential generated. Copy it into a Vapi Custom Credential now. It will not be shown again after leaving this page.");
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Could not configure Vapi");}
    finally{setBusy(false);}
  }
  async function disconnect(){
    if(!window.confirm("Disconnect Vapi from this company? The current webhook credential will stop working immediately."))return;
    setBusy(true);setError("");setToken("");
    try{
      const {error:e}=await supabase.rpc("intrigue_vapi_manage",{
        p_workspace_id:workspaceId,p_operation:"disconnect",
      });
      if(e)throw new Error(e.message);
      setNotice("Vapi disconnected here. Also remove the webhook URL and credential from your Vapi assistant.");
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Could not disconnect Vapi");}
    finally{setBusy(false);}
  }
  async function copy(value:string){
    try{await navigator.clipboard.writeText(value);setNotice("Copied to clipboard.");}
    catch{setError("Clipboard unavailable. Select and copy the text manually.");}
  }
  return <section className={panel}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-[#f4efe5]">Vapi AI receptionist · secure webhook</h2>
      <span className={"text-xs "+(state?.last_verified_at?"text-[#a7ebca]":"text-[#dbca9e]")}>{loading?"Checking...":state?.last_verified_at?"Webhook verified":state?.configured?"Configured · awaiting test":"Not configured"}</span>
    </div>
    <p className="mt-2 text-sm leading-6 text-[#b8c7d4]">Connect a saved Vapi assistant to this company. Incoming call completion events appear here, with no recordings, transcripts or caller contact details stored. No calls are initiated and no appointments or emails are created.</p>
    <div className="mt-5 grid gap-3 md:grid-cols-2">
      <div><label htmlFor="v155-assistant" className="text-xs text-[#e7c37c]">Saved Vapi Assistant ID</label>
        <input id="v155-assistant" className={field+" mt-1"} value={assistantId} onChange={e=>setAssistantId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off"/>
      </div>
      <div><label htmlFor="v155-webhook" className="text-xs text-[#e7c37c]">INTRIGUE webhook URL</label>
        <div className="mt-1 flex items-center gap-2"><input id="v155-webhook" className={field} value={webhook} readOnly/><button type="button" className={button} onClick={()=>void copy(webhook)}>Copy</button></div>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      <button className={button} type="button" onClick={()=>void issue()} disabled={loading||busy}>{state?.configured?"Rotate credential":"Generate Vapi credential"}</button>
      {state?.configured&&<button className={button} type="button" onClick={()=>void disconnect()} disabled={busy}>Disconnect</button>}
      <button className={button} type="button" onClick={()=>void refresh()} disabled={loading||busy}>Refresh Vapi status & calls</button>
    </div>
    {token&&<div className="mt-4 rounded-xl border border-[#d2a655] bg-[#213042] p-4">
      <p className="text-xs font-semibold text-[#f1d28b]">Secret credential · shown once. Never paste into chat, screenshots or Git.</p>
      <div className="mt-2 flex items-center gap-2"><input className={field+" font-mono text-xs"} type="password" value={token} readOnly aria-label="Vapi webhook secret"/><button className={button} type="button" onClick={()=>void copy(token)}>Copy secret</button></div>
      <p className="mt-2 text-xs text-[#c5d2df]">Vapi Dashboard → Integrations → Server Configuration → Custom Credential → Bearer Token, Authorization header, Bearer prefix enabled. Paste this secret, save, and select the credential on the saved assistant’s Server URL.</p>
    </div>}
    {state?.configured&&<p className="mt-3 text-xs text-[#b8c7d4]">Assistant: {state.assistant_id}. {state.last_verified_at?`Last verified webhook: ${new Date(state.last_verified_at).toLocaleString()}`:"Waiting for a verified event from Vapi."}</p>}
    <div className="mt-4 rounded-xl border border-[#41556b] p-4 text-xs leading-6 text-[#bdcbd7]">
      <strong className="text-[#e8d095]">Vapi settings:</strong> Set the saved assistant’s Server URL to the webhook above, assign your new Custom Credential, enable <code>end-of-call-report</code> and <code>tool-calls</code> server messages, then publish the assistant. An optional Function Tool named <code>get_booking_link</code> can use the same URL and credential. That tool returns a booking link only; no appointment is created.
    </div>
    {error&&<p role="alert" className="mt-3 text-sm text-[#ffbbb1]">{error}</p>}
    {notice&&<p role="status" className="mt-3 text-sm text-[#afe3c8]">{notice}</p>}
    <h3 className="mt-5 font-semibold text-[#efd5a1]">Recent completed calls (metadata only)</h3>
    {calls.length===0?<p className="mt-2 text-sm text-[#aebdce]">No verified call reports yet. Make a fictional test call after configuring Vapi.</p>:
      <div className="mt-3 space-y-2">{calls.map(c=><div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#41556b] p-3 text-xs text-[#dbe4ec]">
        <span className="font-mono">{c.call_id.slice(0,24)}</span><span>{c.ended_reason||"Call completed"}</span><time dateTime={c.received_at}>{new Date(c.received_at).toLocaleString()}</time>
      </div>)}</div>}
  </section>;
}
