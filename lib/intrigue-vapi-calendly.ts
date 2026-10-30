import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { exchangeTokens, seal, unseal } from "@/lib/intrigue-calendar-server";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const txt = (v: unknown): string => typeof v === "string" ? v.trim() : "";
const eventUri = /^https:\/\/api\.calendly\.com\/event_types\/[A-Za-z0-9_-]{8,100}$/;

type CalendarContext = {
  authorized?: boolean;
  configured?: boolean;
  enabled?: boolean;
  workspace_id?: string;
  event_type_uri?: string;
  encrypted_tokens?: string;
};
type ToolResult = {result: string} | {error: string};
const success = (data: unknown): ToolResult => ({result: JSON.stringify(data)});
const failure = (message: string): ToolResult => ({error: message});
function signingKey(): Buffer {
  const value = process.env.INTRIGUE_CALENDAR_ENCRYPTION_KEY || "";
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw Error("Calendar encryption key is not configured");
  return createHmac("sha256", Buffer.from(value,"hex")).update("INTRIGUE-V156-SLOT-SIGNATURE").digest();
}
function signature(workspaceId: string,callId: string,event: string,start:string,expiry:number) {
  return createHmac("sha256",signingKey()).update([workspaceId,callId,event,start,String(expiry)].join("|")).digest("base64url");
}
function slotToken(workspaceId:string,callId:string,event:string,start:string) {
  const expiry=Math.floor(Date.now()/1000)+600;
  return `v1.${expiry}.${signature(workspaceId,callId,event,start,expiry)}`;
}
function verifySlotToken(token:string,workspaceId:string,callId:string,event:string,start:string) {
  const match=/^v1\.([0-9]{10})\.([a-zA-Z0-9_-]{43})$/.exec(token);
  if(!match)return false;
  const expiry=Number(match[1]);
  if(expiry < Math.floor(Date.now()/1000) || expiry > Math.floor(Date.now()/1000)+650)return false;
  const actual=Buffer.from(match[2]);const expected=Buffer.from(signature(workspaceId,callId,event,start,expiry));
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
function validZone(timeZone:string) {
  try { new Intl.DateTimeFormat("en-US",{timeZone}).format(new Date());return true; }catch{return false;}
}
function localDate(iso:string,zone:string) {
  return new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(iso));
}
function dateString(input: string) {
  const match=/^(20\d\d)-(\d\d)-(\d\d)$/.exec(input);
  if(!match)return false;
  return new Date(`${input}T12:00:00.000Z`).toISOString().slice(0,10)===input;
}
function parseArgs(raw:unknown):Obj {
  if(typeof raw==="string") { try{return obj(JSON.parse(raw));}catch{return {};} }
  return obj(raw);
}

async function context(supabase: SupabaseClient,token:string,assistantId:string):Promise<CalendarContext> {
  const {data,error}=await supabase.rpc("intrigue_v156_voice_calendar_context",{p_token:token,p_assistant_id:assistantId});
  if(error)throw Error("V15.6 calendar authorization is not installed");
  return obj(data) as CalendarContext;
}

async function calendarAccessToken(supabase:SupabaseClient,authToken:string,assistantId:string,c:CalendarContext):Promise<string>{
  if(!c.workspace_id||!c.encrypted_tokens)throw Error("Calendly is not connected to this workspace");
  const existing=unseal(c.encrypted_tokens,c.workspace_id,"calendly");
  if(existing.expires_at>Date.now()+90_000)return existing.access_token;
  try {
    const renewed=await exchangeTokens("calendly","refresh_token",existing.refresh_token);
    const newBlob=seal(renewed,c.workspace_id,"calendly");
    const {data,error}=await supabase.rpc("intrigue_v156_voice_refresh_tokens",{
      p_token:authToken,p_assistant_id:assistantId,
      p_expected_encrypted:c.encrypted_tokens,p_new_encrypted:newBlob,
    });
    if(error)throw Error("Could not save refreshed Calendly credentials");
    if(data===true)return renewed.access_token;
  } catch {
    // A concurrent request may already have rotated Calendly's single-use refresh token.
    const updated=await context(supabase,authToken,assistantId);
    if(updated.encrypted_tokens&&updated.encrypted_tokens!==c.encrypted_tokens&&updated.workspace_id){
      return unseal(updated.encrypted_tokens,updated.workspace_id,"calendly").access_token;
    }
    throw Error("Calendly token expired. Reconnect the calendar in INTRIGUE.");
  }
  const updated=await context(supabase,authToken,assistantId);
  if(updated.encrypted_tokens&&updated.workspace_id)return unseal(updated.encrypted_tokens,updated.workspace_id,"calendly").access_token;
  throw Error("Calendar connection changed; try again");
}

async function available(token:string,eventType:string,start:string,end:string) {
  const q=new URLSearchParams({event_type:eventType,start_time:start,end_time:end});
  const r=await fetch(`https://api.calendly.com/event_type_available_times?${q}`,{
    headers:{Authorization:`Bearer ${token}`},cache:"no-store",signal:AbortSignal.timeout(13000),
  });
  if(!r.ok)throw Error(r.status===403?"Calendly permissions are insufficient. Reconnect with availability:read.":`Calendly availability unavailable (${r.status})`);
  const data=await r.json() as {collection?:Array<{start_time?:string;status?:string;invitees_remaining?:number}>};
  return (data.collection||[]).filter(x=>x.status==="available"&&!!x.start_time&&Number(x.invitees_remaining)>0);
}

export async function handleCalendlyVoiceTool(args:{
  supabase:SupabaseClient;token:string;assistantId:string;callId:string;toolCallId:string;
  name:string;arguments:unknown;
}):Promise<ToolResult>{
  const {supabase,token,assistantId,callId,toolCallId,name}=args;
  try {
    if(!callId||callId.length<8||callId.length>128||!toolCallId||toolCallId.length<6||toolCallId.length>128)return failure("Valid call identifiers required");
    const c=await context(supabase,token,assistantId);
    if(!c.authorized||!c.configured||!c.workspace_id||!c.encrypted_tokens||!eventUri.test(c.event_type_uri||""))return failure("Company Calendly voice scheduling is not configured");
    const event=c.event_type_uri!;
    const params=parseArgs(args.arguments);
    const access=await calendarAccessToken(supabase,token,assistantId,c);
    if(name==="check_availability"){
      const day=txt(params.date);const tz=txt(params.timezone);
      if(!dateString(day)||!validZone(tz)||tz.length>80)return failure("Provide a valid YYYY-MM-DD date and IANA timezone");
      const midday=Date.parse(`${day}T12:00:00Z`);
      if(midday<Date.now()-86_400_000||midday>Date.now()+30*86_400_000)return failure("Search dates within the next 30 days");
      const from=new Date(Math.max(Date.now()+60_000,midday-36*3600_000)).toISOString();
      const to=new Date(midday+36*3600_000).toISOString();
      const slots=await available(access,event,from,to);
      const matching=slots.filter(s=>localDate(s.start_time!,tz)===day && Date.parse(s.start_time!)>Date.now()+60_000).slice(0,6);
      return success({date:day,timezone:tz,booking_enabled:!!c.enabled,
        slots:matching.map(s=>({start_time:new Date(s.start_time!).toISOString(),local_time:new Date(s.start_time!).toLocaleString("en-GB",{timeZone:tz,dateStyle:"medium",timeStyle:"short"}),slot_token:slotToken(c.workspace_id!,callId,event,new Date(s.start_time!).toISOString())})),
        instruction:"Offer actual returned times. Keep slot_token for the booking tool; never read it aloud. Ask for explicit caller confirmation before booking."});
    }
    if(name!=="book_appointment")return failure("Unknown scheduling tool");
    if(!c.enabled)return failure("Live appointment booking is disabled by the company owner");
    if(params.confirmed!==true)return failure("Ask for clear confirmation of the slot, name, and email before booking");
    const nameValue=txt(params.name),email=txt(params.email).toLowerCase(),timezone=txt(params.timezone),start=txt(params.start_time),ticket=txt(params.slot_token);
    if(nameValue.length<2||nameValue.length>100||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||!validZone(timezone)||timezone.length>80)return failure("A valid caller name, email, and timezone are required");
    const startMs=Date.parse(start);
    if(!Number.isFinite(startMs)||startMs<Date.now()+60_000||startMs>Date.now()+31*86400_000)return failure("Meeting time must be in the future and within 31 days");
    const startISO=new Date(startMs).toISOString();
    if(!verifySlotToken(ticket,c.workspace_id,callId,event,startISO))return failure("This slot offer is missing or has expired. Check availability again.");
    const {data:claim,error:claimError}=await supabase.rpc("intrigue_v156_voice_claim",{
      p_token:token,p_assistant_id:assistantId,p_call_id:callId,p_tool_call_id:toolCallId,
      p_slot_time:startISO,p_invitee_email_hash:createHash("sha256").update(email).digest("hex"),
    });
    if(claimError)throw Error("Could not reserve booking attempt");
    const result=obj(claim);
    if(!result.claimed)return failure(txt(result.reason)||"This appointment was already attempted. Ask the owner to verify it.");
    const attempt=txt(result.attempt_id);
    let status:"confirmed"|"failed"|"uncertain"="uncertain";
    let inviteeUri:string|null=null;
    try {
      // Re-check availability immediately before creating the booking.
      const found=await available(access,event,
        new Date(Math.max(Date.now()+1000,startMs-60_000)).toISOString(),
        new Date(startMs+60_000).toISOString());
      if(!found.some(s=>Date.parse(s.start_time||"")===startMs)){
        status="failed";
        return failure("That slot is no longer available. Please offer a different time.");
      }
      const r=await fetch("https://api.calendly.com/invitees",{
        method:"POST",headers:{Authorization:`Bearer ${access}`,"Content-Type":"application/json"},
        body:JSON.stringify({event_type:event,start_time:startISO,invitee:{name:nameValue,email,timezone}}),
        cache:"no-store",signal:AbortSignal.timeout(16000),
      });
      if(!r.ok){status=r.status<500?"failed":"uncertain";
        return failure(r.status===403?"Calendly requires a paid plan and scheduled_events:write. Reconnect or contact the owner.":`Calendly could not confirm booking (${r.status}). Do not promise a meeting.`);
      }
      const receipt=await r.json() as {resource?:{uri?:string;event?:string}};
      const uri=receipt.resource?.uri||"";
      if(!/^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9_-]+\/invitees\/[A-Za-z0-9_-]+$/.test(uri)){
        return failure("Calendly returned an unexpected response. Owner must verify the booking before retrying.");
      }
      inviteeUri=uri;status="confirmed";
      return success({booked:true,start_time:startISO,timezone,event_uri:receipt.resource?.event||null,booking_reference:uri,
        message:"Calendly confirmed the meeting. The invitee should receive Calendly's usual confirmation."});
    } catch {
      return failure("Calendly booking outcome is uncertain. Do not retry automatically or claim success; ask the owner to check the calendar.");
    } finally {
      const {data:completed,error:completeError}=await supabase.rpc("intrigue_v156_voice_complete",{
        p_token:token,p_assistant_id:assistantId,p_attempt_id:attempt,p_status:status,p_calendly_invitee_uri:inviteeUri,
      });
      if(completeError||completed!==true)console.error("INTRIGUE V15.6 booking receipt could not be recorded",attempt);
    }
  } catch(error) {
    return failure(error instanceof Error?error.message:"Booking tool unavailable");
  }
}
