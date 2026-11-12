import type {NextRequest} from 'next/server';
import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {siteOrigin} from '@/lib/intrigue-calendar-server';
import {voiceService} from '@/lib/intrigue-ai/voice-gate';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj=>v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const str=(v:unknown)=>typeof v==='string'?v.trim():'';
async function owner(workspaceId:string){
 if(!uuid.test(workspaceId))return null;
 const db=await createClient();
 const {data:{user},error}=await db.auth.getUser();
 if(error||!user)return null;
 const {data:ws,error:e}=await db.from('workspaces').select('id').eq('id',workspaceId).eq('owner_id',user.id).maybeSingle();
 if(e||!ws)return null;
 return {db,user,workspaceId};
}
async function writable(workspaceId:string){
 const service=voiceService();
 const {data,error}=await service.rpc('intrigue_platform_workspace_open',{p_tenant:workspaceId});
 return !error && data===true;
}
function sameOrigin(req:NextRequest){
 try{return req.headers.get('origin')===siteOrigin();}catch{return false;}
}
export async function GET(req:NextRequest){
 const workspaceId=req.nextUrl.searchParams.get('workspace_id')||'';
 const ctx=await owner(workspaceId);if(!ctx)return json({error:'Workspace owner access required'},403);
 try{
  const service=voiceService();
  const [settings,requests,routes,google,other]=await Promise.all([
   ctx.db.from('intrigue_receptionist_workspace_settings').select('calendar_provider,booking_mode,updated_at').eq('workspace_id',workspaceId).maybeSingle(),
   ctx.db.from('intrigue_receptionist_phone_requests').select('id,request_kind,provider_mode,phone_number_id,assistant_id,phone_hint,status,created_at,operator_note').eq('workspace_id',workspaceId).order('created_at',{ascending:false}).limit(50),
   service.from('intrigue_ai_voice_routes').select('phone_number_id,assistant_id,provider_mode,active,verified_at,reservation_seconds').eq('workspace_id',workspaceId).order('updated_at',{ascending:false}).limit(100),
   ctx.db.rpc('intrigue_v157_google_owner_connection',{p_workspace_id:workspaceId,p_action:'get'}),
   Promise.all(['cal','calendly'].map(p=>ctx.db.rpc('intrigue_calendar_connection',{p_workspace_id:workspaceId,p_provider:p,p_operation:'get'})))
  ]);
  if(settings.error||requests.error||routes.error)throw Error('Setup tables unavailable. Apply the consolidated SQL migration.');
  // Never return stored encrypted credentials or provider access tokens to the UI.
  const otherStates=other.map(r=>!r.error && Boolean(obj(r.data).connected));
  return json({settings:settings.data||{calendar_provider:'google',booking_mode:'disabled'},
   connections:{google:!google.error&&Boolean(obj(google.data).encrypted_tokens),cal:otherStates[0],calendly:otherStates[1]},
   routes:routes.data||[],requests:requests.data||[],
   limits:{new_number_purchase:'operator_approval_required',byok_activation:'verification_required'}});
 }catch{return json({error:'Receptionist setup is unavailable; check the consolidated SQL migration.'},503);}
}
export async function PATCH(req:NextRequest){
 if(!sameOrigin(req))return json({error:'Cross-origin request denied'},403);
 const b=obj(await req.json().catch(()=>null)),workspaceId=str(b.workspace_id);
 const ctx=await owner(workspaceId);if(!ctx)return json({error:'Workspace owner access required'},403);
 const provider=str(b.calendar_provider),mode=str(b.booking_mode);
 if(!['google','cal','calendly','none'].includes(provider)||!['disabled','link','direct'].includes(mode))return json({error:'Invalid calendar preferences'},400);
 if(provider==='none'&&mode!=='disabled')return json({error:'Select a calendar before enabling booking'},400);
 if(provider==='cal'&&mode==='direct')return json({error:'Cal.com direct voice booking is not approved in this release; use booking link mode'},409);
 if(!await writable(workspaceId))return json({error:'Workspace is frozen or unavailable'},403);
 // Selecting a provider does not claim that a booking works: connections and live Vapi tool paths must be verified separately.
 if(mode==='direct'){
  if(provider==='google'){
   const {data,error}=await ctx.db.from('intrigue_google_booking_settings').select('booking_enabled').eq('workspace_id',workspaceId).maybeSingle();
   if(error||data?.booking_enabled!==true)return json({error:'Enable live Google booking in Calendar before selecting direct mode'},409);
  }else if(provider==='calendly'){
   const {data,error}=await ctx.db.from('intrigue_voice_booking_settings').select('booking_enabled').eq('workspace_id',workspaceId).maybeSingle();
   if(error||data?.booking_enabled!==true)return json({error:'Enable Calendly voice booking and choose an event type in Calendar first'},409);
  }
 }
 const {error}=await ctx.db.from('intrigue_receptionist_workspace_settings').upsert({workspace_id:workspaceId,calendar_provider:provider,
  booking_mode:mode,updated_by:ctx.user.id,updated_at:new Date().toISOString()},{onConflict:'workspace_id'});
 if(error)return json({error:'Unable to save receptionist calendar preferences'},503);
 return json({saved:true,calendar_provider:provider,booking_mode:mode});
}
export async function POST(req:NextRequest){
 if(!sameOrigin(req))return json({error:'Cross-origin request denied'},403);
 const b=obj(await req.json().catch(()=>null)),workspaceId=str(b.workspace_id);
 const ctx=await owner(workspaceId);if(!ctx)return json({error:'Workspace owner access required'},403);
 if(!await writable(workspaceId))return json({error:'Workspace is frozen or unavailable'},403);
 const kind=str(b.request_kind),mode=str(b.provider_mode),phone=str(b.phone_number_id),assistant=str(b.assistant_id),hint=str(b.phone_hint);
 if(!['new_number','existing_number','client_owned_vapi'].includes(kind)||!['managed','byok'].includes(mode))return json({error:'Invalid phone request'},400);
 if(kind==='client_owned_vapi'&&mode!=='byok')return json({error:'Client-owned Vapi requires BYOK mode'},400);
 if(kind!=='new_number'&&(!uuid.test(phone)||!uuid.test(assistant)))return json({error:'Existing Vapi phone and assistant UUIDs are required'},400);
 if(kind==='new_number'&&(phone||assistant))return json({error:'Do not assign provider IDs until the new number is provisioned'},400);
 if(hint.length>40)return json({error:'Phone hint is too long'},400);
 const {count,error:countError}=await ctx.db.from('intrigue_receptionist_phone_requests')
  .select('id',{head:true,count:'exact'}).eq('workspace_id',workspaceId).eq('status','pending');
 if(countError||Number(count||0)>=200)return json({error:'Phone request queue unavailable or full'},409);
 const {data,error}=await ctx.db.from('intrigue_receptionist_phone_requests').insert({workspace_id:workspaceId,requested_by:ctx.user.id,
  request_kind:kind,provider_mode:mode,phone_number_id:phone||null,assistant_id:assistant||null,phone_hint:hint||null,status:'pending'})
  .select('id,status,created_at').single();
 if(error)return json({error:'Unable to submit phone request. Check whether the number is already requested.'},409);
 return json({request:data,message:'Request submitted to INTRIGUE operator for verification. No phone was purchased or rerouted.'},201);
}
