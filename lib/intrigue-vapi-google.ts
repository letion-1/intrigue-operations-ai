import "server-only";
import {createHmac} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {availableDay,defaultSettings,fmt,freebusy,isOpen,localParts,offerToken,overlaps,validateZone,verifyOffer,vapiContext,vapiAccess,isoDay,type GoogleSettings} from "@/lib/intrigue-google-calendar";

type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj=>v&&typeof v==="object"&&!Array.isArray(v)?v as Obj:{};
const text=(v:unknown):string=>typeof v==="string"?v.trim():"";
const fail=(error:string)=>({error});
const good=(data:unknown)=>({result:JSON.stringify(data)});
function parse(v:unknown):Obj{if(typeof v==="string"){try{return obj(JSON.parse(v));}catch{return {};}}return obj(v);}
function digest(email:string){const key=process.env.INTRIGUE_CALENDAR_ENCRYPTION_KEY||"";if(!/^[0-9a-fA-F]{64}$/.test(key))throw Error("Server encryption key is missing");
  return createHmac("sha256",Buffer.from(key,"hex")).update("google-booking-email:"+email).digest("hex");}
const validId=(s:string)=>s.length>=8&&s.length<=128;
const settingsFrom=(c:Record<string,unknown>):GoogleSettings=>({
  time_zone:text(c.time_zone)||defaultSettings.time_zone,
  duration_minutes:Number(c.duration_minutes)||30,
  start_hour:Number(c.start_hour??9),end_hour:Number(c.end_hour??17),booking_enabled:c.enabled===true
});
export async function handleGoogleTool(args:{db:SupabaseClient;token:string;assistantId:string;callId:string;toolCallId:string;name:string;arguments:unknown}){
  const {db,token,assistantId,callId,toolCallId,name}=args;
  if(!validId(callId)||toolCallId.length<6||toolCallId.length>128)return fail("Valid Vapi call identifiers are required");
  try{
    const ctx=await vapiContext(db,token,assistantId);
    if(!ctx.authorized||!ctx.connected||!ctx.workspace_id)return fail("Google Calendar is not connected for this company");
    const settings=settingsFrom({time_zone:ctx.time_zone,duration_minutes:ctx.duration_minutes,start_hour:ctx.start_hour,end_hour:ctx.end_hour,enabled:ctx.enabled});
    const q=parse(args.arguments);const access=await vapiAccess(db,token,assistantId,ctx);
    if(name==="google_check_availability"){
      const day=text(q.date),zone=text(q.timezone)||settings.time_zone,requested=text(q.requested_time);
      if(!isoDay(day)||!validateZone(zone))return fail("Provide a valid YYYY-MM-DD date and IANA timezone");
      const dayMs=Date.parse(`${day}T12:00:00Z`);
      if(dayMs<Date.now()-86400000||dayMs>Date.now()+30*86400000)return fail("Select a date within the next 30 days");
      if(requested&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(requested))return fail("requested_time must be HH:MM (24-hour format)");
      const slots=await availableDay(access,day,settings,zone);
      const matched=requested?slots.find(ms=>{
        const p=localParts(new Date(ms),zone);return p.hour*60+p.minute===Number(requested.slice(0,2))*60+Number(requested.slice(3));
      }):undefined;
      const results=slots.slice(0,24).map(ms=>({start_time:new Date(ms).toISOString(),local_time:fmt(ms,zone),slot_token:offerToken(ctx.workspace_id!,callId,new Date(ms).toISOString(),settings.duration_minutes)}));
      return good({provider:"google_calendar",date:day,timezone:zone,calendar_timezone:settings.time_zone,duration_minutes:settings.duration_minutes,
        booking_enabled:settings.booking_enabled,requested_time:requested||null,requested_available:requested?Boolean(matched):null,
        slots:results,instruction:"Offer only returned slots. Never claim a booking until google_book_appointment returns booked:true. Do not read slot_token aloud."});
    }
    if(name!=="google_book_appointment")return fail("Unknown Google Calendar scheduling tool");
    if(!settings.booking_enabled)return fail("Google Calendar live booking is disabled by the company owner");
    if(q.confirmed!==true)return fail("Ask caller to confirm name, email, time and timezone before booking");
    const caller=text(q.name),email=text(q.email).toLowerCase(),zone=text(q.timezone),start=text(q.start_time),ticket=text(q.slot_token);
    if(caller.length<2||caller.length>100||!/^\S+@\S+\.\S+$/.test(email)||email.length>254||!validateZone(zone))return fail("Invalid caller name, email or timezone");
    if(!/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/.test(start))return fail("Use the exact UTC start_time supplied by Google availability");
    const startMs=Date.parse(start),startIso=Number.isFinite(startMs)?new Date(startMs).toISOString():"";
    if(!Number.isFinite(startMs)||startMs<Date.now()+90000||startMs>Date.now()+31*86400000||!isOpen(startMs,settings))return fail("This selected slot is outside the allowed business hours or date range");
    if(!verifyOffer(ticket,ctx.workspace_id,callId,startIso,settings.duration_minutes))return fail("Slot token expired or does not match this call. Check availability again.");
    const {data:claim,error:claimErr}=await db.rpc("intrigue_v157_google_claim",{p_token:token,p_assistant_id:assistantId,
      p_call_id:callId,p_tool_call_id:toolCallId,p_start_time:startIso,p_email_digest:digest(email)});
    if(claimErr)throw Error("Could not create guarded booking attempt");const claimed=obj(claim);
    if(claimed.claimed!==true)return fail(text(claimed.reason)||"This appointment was already attempted. Verify before retrying.");
    const attempt=text(claimed.attempt_id),eventId=text(claimed.event_id);
    let status:"confirmed"|"failed"|"uncertain"="uncertain",eventLink:string|null=null;
    try{
      const busy=await freebusy(access,new Date(startMs).toISOString(),new Date(startMs+settings.duration_minutes*60000).toISOString());
      if(overlaps(startMs,settings.duration_minutes,busy)){status="failed";return fail("The selected time has become busy. Check availability again.");}
      const payload={id:eventId,summary:"Intrigue Studios consultation",description:"Consultation booked through the INTRIGUE AI receptionist.",
        start:{dateTime:startIso},end:{dateTime:new Date(startMs+settings.duration_minutes*60000).toISOString()},
        attendees:[{email,displayName:caller}],reminders:{useDefault:true}};
      const response=await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",{
        method:"POST",headers:{Authorization:`Bearer ${access}`,"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store",signal:AbortSignal.timeout(16000)});
      if(!response.ok){status=response.status>=500?"uncertain":"failed";
        return fail(`Google Calendar could not create the meeting (${response.status}). Do not claim a confirmed appointment.`);}
      const data=await response.json() as {id?:string;htmlLink?:string;status?:string};
      if(data.id!==eventId||data.status==="cancelled")return fail("Google returned an unexpected booking receipt. Owner must verify before retrying.");
      eventLink=typeof data.htmlLink==="string" && (data.htmlLink.startsWith("https://calendar.google.com/") || data.htmlLink.startsWith("https://www.google.com/calendar/")) ? data.htmlLink : null;
      status="confirmed";
      return good({booked:true,provider:"google_calendar",booking_reference:eventId,start_time:startIso,timezone:zone,duration_minutes:settings.duration_minutes,
        message:"Google Calendar created the event and requested an attendee invitation. The recipient may need to accept the invitation."});
    }catch{return fail("Google Calendar booking outcome uncertain. Do not retry automatically. Check the Calendar before attempting again.");}
    finally{const {data:complete,error:err}=await db.rpc("intrigue_v157_google_complete",{p_token:token,p_assistant_id:assistantId,p_attempt_id:attempt,p_status:status,p_event_link:eventLink});
      if(err||complete!==true)console.error("INTRIGUE Google booking receipt update failed",attempt);}
  }catch(e){return fail(e instanceof Error?e.message:"Google Calendar tool unavailable");}
}
