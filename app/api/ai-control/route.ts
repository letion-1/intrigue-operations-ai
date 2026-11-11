import type {NextRequest} from 'next/server';
import {platformAuth,checkOrigin,uuid,json,apiError,LifecycleError} from '@/lib/intrigue-platform';
import {requireCompanyOwner,loadStatus,storeCredential,isProvider} from '@/lib/intrigue-ai/server';

export async function GET(req:NextRequest){
 try{
  const ctx=await platformAuth(req);
  const ws=await requireCompanyOwner(ctx,req.nextUrl.searchParams.get('workspace_id'));
  return json(await loadStatus(ctx.service,ws));
 }catch(error){return apiError(error);}
}
export async function POST(req:NextRequest){
 try{
  checkOrigin(req);
  const ctx=await platformAuth(req);
  const body:unknown=await req.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body))throw new LifecycleError(400,'Invalid request.');
  const b=body as Record<string,unknown>;
  const ws=await requireCompanyOwner(ctx,b.workspace_id);
  const action=b.action;
  if(action==='connect'){
   if(!isProvider(b.provider)||typeof b.api_key!=='string')throw new LifecycleError(400,'Select a supported provider and supply its key.');
   await storeCredential(ctx,ws,b.provider,b.api_key.trim());
   return json({saved:true,activated:false,message:'Provider verified and securely saved. Activation requires the runtime integration gate.'});
  }
  if(action==='disconnect'){
   if(!isProvider(b.provider)||b.confirmation!==`DISCONNECT ${b.provider.toUpperCase()}`)throw new LifecycleError(400,'Confirm the provider disconnection.');
   const {error}=await ctx.service.from('intrigue_ai_connections').delete().eq('workspace_id',ws).eq('provider',b.provider);
   if(error)throw new LifecycleError(503,'Unable to disconnect provider.');
   // Fail-safe fallback: never leave BYOK selected with missing credentials.
   const changes=b.provider==='openrouter'?{text_mode:'managed'}:{voice_mode:'managed'};
   const {error:planError}=await ctx.service.from('intrigue_ai_plans').update({...changes,updated_by:ctx.user.id,updated_at:new Date().toISOString()}).eq('workspace_id',ws);
   if(planError)throw new LifecycleError(503,'Provider was disconnected but company mode could not be updated. Contact support.');
   return json({disconnected:true});
  }
  if(action==='mode'){
   if((b.text_mode!=='managed'&&b.text_mode!=='byok')||(b.voice_mode!=='managed'&&b.voice_mode!=='byok'))
    throw new LifecycleError(400,'Choose a supported AI mode.');
   if(b.text_mode==='byok'&&process.env.INTRIGUE_AI_BYOK_ACTIVATION_ENABLED!=='true')
    throw new LifecycleError(409,'Text AI provider switching is not yet activated for this workspace.');
   if(b.text_mode==='byok'&&process.env.INTRIGUE_AI_BROWSER_METERING_ENABLED!=='true')
    throw new LifecycleError(409,'Company-owned AI requires governed dashboard and agent requests.');
   if(b.voice_mode==='byok'&&process.env.INTRIGUE_VOICE_BYOK_ACTIVATION_ENABLED!=='true')
    throw new LifecycleError(409,'Receptionist provider switching is not yet activated for this workspace.');
   const {data:existing,error:existingError}=await ctx.service.from('intrigue_ai_connections').select('provider').eq('workspace_id',ws);
   if(existingError)throw new LifecycleError(503,'Could not verify company AI connections.');
   if(b.text_mode==='byok'&&!existing?.some(c=>c.provider==='openrouter'))throw new LifecycleError(409,'Connect OpenRouter before enabling your own AI.');
   if(b.voice_mode==='byok'&&!existing?.some(c=>c.provider==='vapi'))throw new LifecycleError(409,'Connect Vapi before enabling your own receptionist.');
   if(b.voice_mode==='byok'){
    const {data:verified,error:voiceRouteError}=await ctx.service.from('intrigue_ai_voice_routes')
     .select('phone_number_id').eq('workspace_id',ws).eq('provider_mode','byok')
     .eq('active',true).limit(1);
    if(voiceRouteError||!verified?.length)throw new LifecycleError(409,'Verify your company Vapi phone call gate before switching voice billing.');
    const {data:routes,error:routesError}=await ctx.service.from('intrigue_ai_voice_routes')
     .select('provider_mode').eq('workspace_id',ws).eq('active',true);
    if(routesError||routes?.some(r=>r.provider_mode!=='byok'))
     throw new LifecycleError(409,'Disable or reconfigure managed receptionist numbers before switching to client-owned Vapi billing.');
   }
   const {error}=await ctx.service.from('intrigue_ai_plans').upsert({workspace_id:ws,text_mode:b.text_mode,voice_mode:b.voice_mode,
    updated_at:new Date().toISOString(),updated_by:ctx.user.id},{onConflict:'workspace_id'});
   if(error)throw new LifecycleError(503,'Could not save AI provider selection.');
   return json({updated:true});
  }
  throw new LifecycleError(400,'Unknown AI setting.');
 }catch(error){return apiError(error);}
}
