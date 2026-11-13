import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { platformAuth, checkOrigin, json, apiError, LifecycleError } from '@/lib/intrigue-platform';
import { requireCompanyOwner } from '@/lib/intrigue-ai/server';
import { voiceAccountKey } from '@/lib/intrigue-ai/voice-gate';
import { callRow } from '@/lib/intrigue-vapi-call-history';
import { uuidPattern } from '@/lib/intrigue-outbound-evidence';

/** Owner-invoked, bounded backfill. NO transcript processing, recording download, or AI generation. */
export async function POST(request:NextRequest){
 try{
  checkOrigin(request);
  const ctx=await platformAuth(request);
  const b:unknown=await request.json().catch(()=>null);
  if(!b||typeof b!=='object'||Array.isArray(b))throw new LifecycleError(400,'Invalid request.');
  const body=b as Record<string,unknown>;
  const workspace=await requireCompanyOwner(ctx,body.workspace_id);
  const offset=Number(body.offset);
  if(!Number.isInteger(offset)||offset<0||offset>990||offset%10!==0)throw new LifecycleError(400,'Invalid summary page offset.');
  const bearer=request.headers.get('authorization')||'';
  const jwt=/^Bearer (\S{20,})$/.exec(bearer)?.[1];
  if(!jwt)throw new LifecycleError(401,'Sign in required.');
  const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  if(!anon||!url)throw new LifecycleError(503,'Supabase is not configured.');
  const userDb=createClient(url,anon,{auth:{autoRefreshToken:false,persistSession:false},global:{headers:{Authorization:`Bearer ${jwt}`}}});
  const {data:assistantId,error:assistantError}=await userDb.rpc('intrigue_v160_owner_assistant',{p_workspace_id:workspace});
  if(assistantError||typeof assistantId!=='string'||!uuidPattern.test(assistantId))throw new LifecycleError(403,'Assistant is not authorized for this workspace.');
  const {data:routes,error:routeError}=await ctx.service.from('intrigue_ai_voice_routes').select('provider_mode')
   .eq('workspace_id',workspace).eq('assistant_id',assistantId).eq('active',true).limit(1);
  if(routeError)throw new LifecycleError(503,'Company voice route not available.');
  const key=routes?.[0]?.provider_mode==='byok'
   ? await voiceAccountKey(ctx.service,workspace,'byok')
   : (process.env.INTRIGUE_VAPI_PRIVATE_KEY||process.env.INTRIGUE_VAPI_MANAGED_API_KEY||process.env.VAPI_API_KEY||'');
  if(!key)throw new LifecycleError(503,'Vapi credential unavailable for this assistant.');
  const {data:missing,error:missingError}=await ctx.service.from('intrigue_receptionist_calls')
   .select('provider_call_id,started_at,summary').eq('workspace_id',workspace).eq('assistant_id',assistantId)
   .order('started_at',{ascending:false}).range(offset,offset+9);
  if(missingError)throw new LifecycleError(503,'Unable to inspect call summaries.');
  let recovered=0,withoutAnalysis=0,errors=0;
  // Bounded to 10 provider GET requests, sequential to avoid rate limits and timeouts.
  for(const entry of missing||[]){
   if(entry.summary){continue;}
   if(!uuidPattern.test(String(entry.provider_call_id||''))){errors++;continue;}
   try{
    const response=await fetch(`https://api.vapi.ai/call/${encodeURIComponent(entry.provider_call_id)}`,{
     headers:{Authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(4000),
    });
    if(!response.ok){errors++;continue;}
    const payload:unknown=await response.json();
    if(!payload||typeof payload!=='object'||Array.isArray(payload)){errors++;continue;}
    const call=payload as Record<string,unknown>;
    if(call.id!==entry.provider_call_id||call.assistantId!==assistantId){errors++;continue;}
    const normalized=callRow(call,false);
    if(!normalized.summary){withoutAnalysis++;continue;}
    // Update only the summary after verifying workspace, assistant and call identity.
    // Never overwrite duration, caller, recording, outcome, or existing transcripts.
    const {data:updated,error:saveError}=await ctx.service.from('intrigue_receptionist_calls')
      .update({summary:normalized.summary})
      .eq('workspace_id',workspace).eq('assistant_id',assistantId)
      .eq('provider_call_id',entry.provider_call_id).is('summary',null).select('id');
    if(saveError||!updated?.length){errors++;continue;}
    recovered++;
   }catch{errors++;}
  }
  return json({checked:(missing||[]).length,recovered,without_analysis:withoutAnalysis,errors,
   next_offset:offset+10,transcripts_imported:false,
   message:'Only summaries already available in Vapi were considered. No transcript or recording was imported.'});
 }catch(e){return apiError(e);}
}
