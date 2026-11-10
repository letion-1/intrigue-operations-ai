import type {NextRequest} from 'next/server';
import {platformAuth,mustBeOperator,checkOrigin,uuid,json,apiError,LifecycleError} from '@/lib/intrigue-platform';
import {loadStatus} from '@/lib/intrigue-ai/server';

export async function GET(req:NextRequest){
 try{
  const ctx=await platformAuth(req);await mustBeOperator(ctx);
  const id=req.nextUrl.searchParams.get('workspace_id');
  if(id){
   if(!uuid(id))throw new LifecycleError(400,'Invalid workspace.');
   const {data,error}=await ctx.service.from('workspaces').select('id,name,intrigue_erasure_state').eq('id',id).maybeSingle();
   if(error||!data)throw new LifecycleError(404,'Workspace not found.');
   return json({workspace:data,...await loadStatus(ctx.service,id)});
  }
  const {data,error}=await ctx.service.from('workspaces').select('id,name,intrigue_erasure_state').eq('intrigue_erasure_state','active').order('created_at',{ascending:false}).limit(100);
  if(error)throw new LifecycleError(503,'Cannot load company list.');
  return json({workspaces:data||[]});
 }catch(error){return apiError(error);}
}
export async function POST(req:NextRequest){
 try{
  checkOrigin(req);
  const ctx=await platformAuth(req);await mustBeOperator(ctx);
  const raw:unknown=await req.json().catch(()=>null);
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new LifecycleError(400,'Invalid request.');
  const b=raw as Record<string,unknown>;
  if(!uuid(b.workspace_id)||b.action!=='set_allowance')throw new LifecycleError(400,'Invalid company allowance update.');
  const usd=b.text_budget_usd,minutes=b.voice_minutes;
  if(typeof usd!=='number'||!Number.isFinite(usd)||usd<0||usd>100000||
   Math.abs(usd*100-Math.round(usd*100))>1e-7||typeof minutes!=='number'||!Number.isInteger(minutes)||minutes<0||minutes>600000)
    throw new LifecycleError(400,'Enter an AI budget in USD and a valid voice-minute allowance.');
  const {data:open,error:openError}=await ctx.service.rpc('intrigue_platform_workspace_open',{p_tenant:b.workspace_id});
  if(openError||open!==true)throw new LifecycleError(403,'Company is frozen, closing or unavailable.');
  const {error}=await ctx.service.from('intrigue_ai_plans').upsert({workspace_id:b.workspace_id,text_budget_usd:usd,
     voice_seconds_limit:Number(minutes)*60,updated_by:ctx.user.id,updated_at:new Date().toISOString()},{onConflict:'workspace_id'});
  if(error)throw new LifecycleError(503,'Unable to update company allowances.');
  return json({saved:true,...await loadStatus(ctx.service,String(b.workspace_id))});
 }catch(error){return apiError(error);}
}
