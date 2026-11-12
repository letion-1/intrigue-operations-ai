import type {NextRequest} from 'next/server';
import {platformAuth,mustBeOperator,checkOrigin,uuid,json,apiError,LifecycleError} from '@/lib/intrigue-platform';

type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj=>v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const str=(v:unknown)=>typeof v==='string'?v.trim():'';
export async function GET(req:NextRequest){
 try{
  const ctx=await platformAuth(req);await mustBeOperator(ctx);
  const {data,error}=await ctx.service.from('intrigue_receptionist_phone_requests')
   .select('id,workspace_id,requested_by,request_kind,provider_mode,phone_number_id,assistant_id,phone_hint,status,created_at,operator_note,reviewed_at')
   .order('created_at',{ascending:false}).limit(100);
  if(error)throw new LifecycleError(503,'Receptionist requests unavailable. Run the consolidated SQL migration.');
  return json({requests:data||[]});
 }catch(e){return apiError(e);}
}
export async function POST(req:NextRequest){
 try{
  checkOrigin(req);
  const ctx=await platformAuth(req);await mustBeOperator(ctx);
  const b=obj(await req.json().catch(()=>null)),id=str(b.request_id),action=str(b.action);
  if(!uuid(id)||!['approve','reject','assign'].includes(action))throw new LifecycleError(400,'Invalid request or operation.');
  const {data:r,error:readError}=await ctx.service.from('intrigue_receptionist_phone_requests')
    .select('id,workspace_id,status,request_kind,provider_mode,phone_number_id,assistant_id').eq('id',id).maybeSingle();
  if(readError||!r||r.status!=='pending')throw new LifecycleError(409,'The request is missing or already reviewed.');
  const {data:open,error:openError}=await ctx.service.rpc('intrigue_platform_workspace_open',{p_tenant:r.workspace_id});
  if(openError||open!==true)throw new LifecycleError(403,'Workspace is unavailable.');
  if(action==='assign'){
   const phoneId=str(b.phone_number_id),assistantId=str(b.assistant_id);
   if(!uuid(phoneId)||!uuid(assistantId))throw new LifecycleError(400,'Valid Vapi phone and assistant IDs are required.');
   // Assignment records the operator's provider IDs, but never activates routing or buys a number.
   const {error}=await ctx.service.from('intrigue_receptionist_phone_requests').update({phone_number_id:phoneId,assistant_id:assistantId})
    .eq('id',id).eq('status','pending');
   if(error)throw new LifecycleError(409,'Could not assign the new provider resource IDs.');
   return json({assigned:true,active:false,message:'IDs saved. Provision and verify the matching call gate before approval.'});
  }
  if(action==='approve'){
   if(!r.phone_number_id||!r.assistant_id)throw new LifecycleError(409,'Assign the purchased/imported number and assistant first.');
   const {data:route,error}=await ctx.service.from('intrigue_ai_voice_routes')
    .select('workspace_id,phone_number_id,assistant_id,provider_mode,active,verified_at')
    .eq('workspace_id',r.workspace_id).eq('phone_number_id',r.phone_number_id).maybeSingle();
   if(error||!route||!route.active||!route.verified_at||route.assistant_id!==r.assistant_id||route.provider_mode!==r.provider_mode)
    throw new LifecycleError(409,'The workspace phone/assistant route has not passed Vapi verification and activation.');
   // One assistant per workspace: avoids ambiguous calendar context when tenant phone numbers scale.
   const {data:other,error:otherError}=await ctx.service.from('intrigue_ai_voice_routes')
    .select('workspace_id').eq('assistant_id',r.assistant_id).neq('workspace_id',r.workspace_id).limit(1);
   if(otherError||other?.length)throw new LifecycleError(409,'This assistant is assigned to another workspace. Create a distinct assistant.');
  }
  const note=str(b.operator_note).slice(0,300);
  const {error}=await ctx.service.from('intrigue_receptionist_phone_requests').update({
   status:action==='approve'?'approved':'rejected',operator_note:note||null,reviewed_at:new Date().toISOString()
  }).eq('id',id).eq('status','pending');
  if(error)throw new LifecycleError(503,'Could not review request.');
  return json({status:action==='approve'?'approved':'rejected'});
 }catch(e){return apiError(e);}
}
