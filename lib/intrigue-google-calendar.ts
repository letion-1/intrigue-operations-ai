import "server-only";
import {createCipheriv,createDecipheriv,randomBytes,createHmac,timingSafeEqual} from "node:crypto";
import {createClient} from "@/lib/supabase/server";
import type {SupabaseClient} from "@supabase/supabase-js";

type Tokens={access_token:string;refresh_token:string;expires_at:number};
export type GoogleSettings={time_zone:string;start_hour:number;end_hour:number;duration_minutes:number;booking_enabled:boolean};
const api="https://www.googleapis.com/calendar/v3";
export const defaultSettings:GoogleSettings={time_zone:"Europe/Berlin",start_hour:9,end_hour:17,duration_minutes:30,booking_enabled:false};
function encryptionKey(){const hex=process.env.INTRIGUE_CALENDAR_ENCRYPTION_KEY||"";
  if(!/^[0-9a-fA-F]{64}$/.test(hex))throw Error("Calendar encryption key is not configured");
  return Buffer.from(hex,"hex");}
export function googleOrigin(){const raw=process.env.INTRIGUE_PUBLIC_URL||"";const u=new URL(raw);
  if((u.protocol!=="https:"&&u.hostname!=="localhost")||u.username||u.password||u.search||u.hash||u.pathname!=="/")throw Error("Set INTRIGUE_PUBLIC_URL to the canonical origin");return u.origin;}
export function googleClient(){const id=process.env.GOOGLE_CALENDAR_CLIENT_ID;const secret=process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if(!id||!secret)throw Error("Google Calendar OAuth variables not configured");
  return {id,secret,redirect:`${googleOrigin()}/api/integrations/google-calendar/callback`};}
export function encrypt(tokens:Tokens,workspace:string){const iv=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);
  cipher.setAAD(Buffer.from(`${workspace}:google`));const encrypted=Buffer.concat([cipher.update(JSON.stringify(tokens),"utf8"),cipher.final()]);
  return ["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),encrypted.toString("base64url")].join(".");}
export function decrypt(payload:string,workspace:string):Tokens{const [version,iv,tag,body]=payload.split(".");
  if(version!=="v1"||!iv||!tag||!body)throw Error("Encrypted calendar credential invalid");
  const decipher=createDecipheriv("aes-256-gcm",encryptionKey(),Buffer.from(iv,"base64url"));decipher.setAAD(Buffer.from(`${workspace}:google`));decipher.setAuthTag(Buffer.from(tag,"base64url"));
  const data=JSON.parse(Buffer.concat([decipher.update(Buffer.from(body,"base64url")),decipher.final()]).toString("utf8")) as Tokens;
  if(typeof data.access_token!=="string"||typeof data.refresh_token!=="string"||!Number.isFinite(data.expires_at))throw Error("Calendar credentials invalid");
  return data;}
export async function googleTokenExchange(input:{code?:string;refresh_token?:string}):Promise<Tokens>{const config=googleClient();const params=new URLSearchParams({client_id:config.id,client_secret:config.secret});
  if(input.code){params.set("code",input.code);params.set("redirect_uri",config.redirect);params.set("grant_type","authorization_code");}
  else{params.set("refresh_token",input.refresh_token||"");params.set("grant_type","refresh_token");}
  const resp=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:params.toString(),cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!resp.ok)throw Error(`Google authorization failed (${resp.status}). Reconnect Google Calendar.`);
  const data=await resp.json() as {access_token?:string;refresh_token?:string;expires_in?:number};
  if(!data.access_token || (input.code&&!data.refresh_token))throw Error("Google did not provide offline credentials. Reconnect and consent again.");
  return {access_token:data.access_token,refresh_token:data.refresh_token||input.refresh_token||"",expires_at:Date.now()+Math.max(60,Number(data.expires_in)||3600)*1000};}
export async function owner(){const db=await createClient();const {data:{user},error}=await db.auth.getUser();if(error||!user)return null;
  const {data:w,error:e}=await db.from("workspaces").select("id").eq("owner_id",user.id).maybeSingle();if(e||!w)return null;
  return {db,workspace:String(w.id),userId:user.id};}
export type Owner=NonNullable<Awaited<ReturnType<typeof owner>>>;
export async function ownerBlob(ctx:Owner):Promise<string|null>{const {data,error}=await ctx.db.rpc("intrigue_v157_google_owner_connection",{p_workspace_id:ctx.workspace,p_action:"get"});
  if(error)throw Error("Install V15.7 database SQL first");const d=data as {encrypted_tokens?:string};return d?.encrypted_tokens||null;}
export async function saveOwnerBlob(ctx:Owner,tokens:Tokens){const {error}=await ctx.db.rpc("intrigue_v157_google_owner_connection",{p_workspace_id:ctx.workspace,p_action:"store",p_blob:encrypt(tokens,ctx.workspace)});if(error)throw Error("Could not save Google Calendar credentials");}
export async function ownerAccess(ctx:Owner):Promise<string|null>{const blob=await ownerBlob(ctx);if(!blob)return null;const current=decrypt(blob,ctx.workspace);
  if(current.expires_at>Date.now()+90000)return current.access_token;
  const updated=await googleTokenExchange({refresh_token:current.refresh_token});
  const newer=await ownerBlob(ctx);if(newer!==blob){return decrypt(newer!,ctx.workspace).access_token;}
  await saveOwnerBlob(ctx,updated);return updated.access_token;}
export type VapiContext={authorized?:boolean;workspace_id?:string;encrypted_tokens?:string;connected?:boolean;enabled?:boolean;time_zone?:string;duration_minutes?:number;start_hour?:number;end_hour?:number};
export async function vapiContext(db:SupabaseClient,bearer:string,assistantId:string):Promise<VapiContext>{const {data,error}=await db.rpc("intrigue_v157_google_context",{p_token:bearer,p_assistant_id:assistantId});
  if(error)throw Error("Google Calendar database migration not installed");return data as VapiContext;}
export async function vapiAccess(db:SupabaseClient,bearer:string,assistantId:string,ctx:VapiContext):Promise<string>{
  if(!ctx.workspace_id||!ctx.encrypted_tokens)throw Error("Google Calendar not connected");
  const current=decrypt(ctx.encrypted_tokens,ctx.workspace_id);
  if(current.expires_at>Date.now()+90000)return current.access_token;
  const updated=await googleTokenExchange({refresh_token:current.refresh_token});
  const next=encrypt(updated,ctx.workspace_id);
  const {data,error}=await db.rpc("intrigue_v157_google_refresh",{p_token:bearer,p_assistant_id:assistantId,p_expected:ctx.encrypted_tokens,p_next:next});
  if(error)throw Error("Google token refresh could not be persisted");
  if(data===true)return updated.access_token;
  const recent=await vapiContext(db,bearer,assistantId);if(recent.encrypted_tokens&&recent.workspace_id)return decrypt(recent.encrypted_tokens,recent.workspace_id).access_token;
  throw Error("Google Calendar connection changed. Reconnect Google Calendar.");}
export function validateZone(zone:string){try{new Intl.DateTimeFormat("en-US",{timeZone:zone}).format(new Date());return zone.length<=80&&zone.length>=3;}catch{return false;}}
export function isoDay(s:string){return /^20\d\d-\d\d-\d\d$/.test(s)&&!Number.isNaN(Date.parse(`${s}T12:00:00Z`))&&new Date(`${s}T12:00:00Z`).toISOString().slice(0,10)===s;}
export function localParts(date:Date,zone:string){const parts=new Intl.DateTimeFormat("en-US",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23",weekday:"short"}).formatToParts(date);
  const v=(key:string)=>parts.find(p=>p.type===key)?.value||"";
  return {day:`${v("year")}-${v("month")}-${v("day")}`,hour:Number(v("hour")),minute:Number(v("minute")),weekday:v("weekday")};}
export type Interval={start:string;end:string};
export async function freebusy(access:string,from:string,to:string):Promise<Interval[]>{const r=await fetch(`${api}/freeBusy`,{method:"POST",headers:{Authorization:`Bearer ${access}`,"Content-Type":"application/json"},
  body:JSON.stringify({timeMin:from,timeMax:to,items:[{id:"primary"}]}),cache:"no-store",signal:AbortSignal.timeout(14000)});
  if(!r.ok)throw Error(`Google Calendar availability failed (${r.status}). Check scopes and connection.`);
  const data=await r.json() as {calendars?:Record<string,{busy?:Interval[];errors?:unknown[]}>};
  const result=data.calendars?.primary;if(!result||result.errors?.length||!Array.isArray(result.busy))throw Error("Google Calendar did not confirm availability");return result.busy;}
export function isOpen(start:number,settings:GoogleSettings){const zone=settings.time_zone;
  const a=localParts(new Date(start),zone),b=localParts(new Date(start+settings.duration_minutes*60000),zone);
  if(a.day!==b.day||a.weekday==="Sat"||a.weekday==="Sun"||a.minute%30!==0)return false;
  const begin=a.hour*60+a.minute,end=b.hour*60+b.minute;
  return begin>=settings.start_hour*60&&end<=settings.end_hour*60;}
export function overlaps(start:number,duration:number,busy:Interval[]){const end=start+duration*60000;return busy.some(v=>Date.parse(v.start)<end && Date.parse(v.end)>start);}
export async function availableDay(access:string,day:string,settings:GoogleSettings,requestedZone:string=settings.time_zone):Promise<number[]>{const midday=Date.parse(`${day}T12:00:00Z`);
  const from=midday-36*3600000,to=midday+36*3600000;
  const busy=await freebusy(access,new Date(from).toISOString(),new Date(to).toISOString());const slots:number[]=[];
  for(let t=Math.ceil(from/1800000)*1800000;t<to;t+=1800000){
    if(t<Date.now()+90000||localParts(new Date(t),requestedZone).day!==day||!isOpen(t,settings)||overlaps(t,settings.duration_minutes,busy))continue;
    slots.push(t);
  }return slots;}
function sign(keyParts:string[]){return createHmac("sha256",encryptionKey()).update("INTRIGUE-V157-GOOGLE-SLOT|"+keyParts.join("|")).digest("base64url");}
export function offerToken(workspace:string,call:string,start:string,duration:number){const expires=Math.floor(Date.now()/1000)+600;
  return `g1.${expires}.${sign([workspace,call,start,String(duration),String(expires)])}`;}
export function verifyOffer(token:string,workspace:string,call:string,start:string,duration:number){const m=/^g1\.(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if(!m||Number(m[1])<Date.now()/1000||Number(m[1])>Date.now()/1000+650)return false;
  const expected=Buffer.from(sign([workspace,call,start,String(duration),m[1]]));const actual=Buffer.from(m[2]);
  return expected.length===actual.length&&timingSafeEqual(expected,actual);}
export function fmt(start:number,zone:string){return new Date(start).toLocaleString("en-GB",{timeZone:zone,weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}
export async function googleEvents(access:string){const params=new URLSearchParams({singleEvents:"true",orderBy:"startTime",timeMin:new Date().toISOString(),maxResults:"8",fields:"items(id,summary,start(dateTime),htmlLink),nextPageToken"});
  const resp=await fetch(`${api}/calendars/primary/events?${params}`,{headers:{Authorization:`Bearer ${access}`},cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!resp.ok)throw Error(`Google Calendar event list unavailable (${resp.status})`);
  const d=await resp.json() as {items?:Array<{id?:string;summary?:string;start?:{dateTime?:string};htmlLink?:string}>};
  return (d.items||[]).filter(x=>x.start?.dateTime).map(x=>({id:x.id||"",title:(x.summary||"Busy").slice(0,120),start:x.start!.dateTime!}));}
