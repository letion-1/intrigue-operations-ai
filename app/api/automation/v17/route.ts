import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { crossOrigin } from '@/lib/ai-security';

// V17.1B is intentionally restricted to audit_event workflows. No email, CRM,
// calendar or telephony action may be executed from this endpoint.
// Next.js 16 cacheComponents manages dynamic request rendering.
// Do not export route-segment runtime or dynamic configuration here.

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const EVENT_KEY = /^manual:[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const json = (value: object, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

class AutomationError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
function fail(e: unknown) {
  if (e instanceof AutomationError) return json({error:e.message}, e.status);
  console.error('[INTRIGUE_V17_AUTOMATION_FAILED]', e instanceof Error ? e.name : 'Unknown');
  return json({error:'Automation operation failed. Check server logs.'}, 500);
}
function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  const adminKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !publicKey || !adminKey) throw new AutomationError('Automation server environment is incomplete.', 503);
  return {url,publicKey,adminKey};
}
async function manager(request: NextRequest, workspaceId: string) {
  if (!UUID.test(workspaceId)) throw new AutomationError('Invalid workspace identifier.');
  const token = request.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!token) throw new AutomationError('Sign in again.', 401);
  const e = env();
  const userDb = createClient(e.url, e.publicKey, {
    auth:{persistSession:false,autoRefreshToken:false},
    global:{headers:{Authorization:`Bearer ${token}`}},
  });
  const {data:{user},error:userError} = await userDb.auth.getUser(token);
  if (userError || !user) throw new AutomationError('Sign in again.', 401);
  const {data:member,error:memberError} = await userDb.from('workspace_memberships')
    .select('role').eq('workspace_id',workspaceId).eq('user_id',user.id).maybeSingle();
  if (memberError || !member || !['owner','admin'].includes(String(member.role))) {
    throw new AutomationError('Workspace Owner or Admin permission is required.', 403);
  }
  const {data:workspace,error:workspaceError} = await userDb.from('workspaces')
    .select('id').eq('id',workspaceId).maybeSingle();
  if (workspaceError || !workspace) throw new AutomationError('Workspace is inaccessible.', 403);
  const db = createClient(e.url,e.adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
  return {db,userId:user.id};
}
function readId(raw: unknown, what: string) {
  if (typeof raw !== 'string' || !UUID.test(raw)) throw new AutomationError(`Invalid ${what}.`);
  return raw;
}
async function body(request: NextRequest): Promise<Record<string,unknown>> {
  if (crossOrigin(request)) throw new AutomationError('Cross-origin request refused.', 403);
  if (!request.headers.get('content-type')?.includes('application/json')) throw new AutomationError('Expected JSON.', 415);
  const size = Number(request.headers.get('content-length') || '0');
  if (!Number.isFinite(size) || size > 8192) throw new AutomationError('Request is too large.', 413);
  const raw: unknown = await request.json().catch(()=>null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AutomationError('Invalid JSON.');
  if (JSON.stringify(raw).length > 8192) throw new AutomationError('Request is too large.', 413);
  return raw as Record<string,unknown>;
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = readId(request.nextUrl.searchParams.get('workspaceId'),'workspace');
    const {db} = await manager(request,workspaceId);
    const [a,b,c] = await Promise.all([
      db.from('intrigue_v17_workflows').select('id,name,trigger_type,action_type,enabled,requires_approval,max_attempts,created_at,updated_at').eq('workspace_id',workspaceId).order('created_at',{ascending:false}).limit(100),
      db.from('intrigue_v17_runs').select('id,workflow_id,event_key,status,attempts,max_attempts,approved_at,approved_by,last_error,result,available_at,created_at,finished_at').eq('workspace_id',workspaceId).order('created_at',{ascending:false}).limit(100),
      db.from('intrigue_v17_run_events').select('id,run_id,event_type,details,created_at').eq('workspace_id',workspaceId).order('created_at',{ascending:false}).limit(150),
    ]);
    if (a.error || b.error || c.error) throw new AutomationError('Workflow service is not configured. Please contact your workspace administrator.', 503);
    return json({workflows:a.data??[],runs:b.data??[],events:c.data??[],mode:'audit_only',worker:'local'});
  } catch(e) {return fail(e);}
}

export async function POST(request: NextRequest) {
  try {
    const input = await body(request);
    const workspaceId = readId(input.workspaceId,'workspace');
    const {db,userId} = await manager(request,workspaceId);
    const operation = input.operation;
    if (operation === 'create_workflow') {
      const name = typeof input.name==='string' ? input.name.trim() : '';
      if (name.length<3 || name.length>120) throw new AutomationError('Workflow name must contain 3–120 characters.');
      const {count:existing,error:countError}=await db.from('intrigue_v17_workflows')
        .select('id',{count:'exact',head:true}).eq('workspace_id',workspaceId);
      if(countError)throw new AutomationError('Could not verify workflow limit.',503);
      if((existing??0)>=50)throw new AutomationError('Workspace limit: 50 workflows. Disable or consolidate existing workflows.',429);
      const {data,error}=await db.from('intrigue_v17_workflows').insert({
        workspace_id:workspaceId,name,trigger_type:'manual',action_type:'audit_event',
        enabled:false,requires_approval:true,max_attempts:3,
      }).select('id').single();
      if (error || !data) throw new AutomationError('Could not create workflow. Please contact your workspace administrator.',503);
      return json({ok:true,workflowId:data.id},201);
    }
    if (operation === 'toggle_workflow') {
      const workflowId=readId(input.workflowId,'workflow');
      if (typeof input.enabled !== 'boolean') throw new AutomationError('Invalid enabled flag.');
      // Verify the workflow is audit-only before allowing activation.
      const {data:w,error:findError}=await db.from('intrigue_v17_workflows')
        .select('id,action_type,trigger_type,requires_approval').eq('id',workflowId).eq('workspace_id',workspaceId).maybeSingle();
      if (findError || !w) throw new AutomationError('Workflow not found.',404);
      if (w.action_type!=='audit_event' || w.requires_approval!==true || w.trigger_type!=='manual') {
        throw new AutomationError('Only manual, approval-required audit workflows are currently enabled.',409);
      }
      const {data:updated,error}=await db.from('intrigue_v17_workflows')
        .update({enabled:input.enabled,updated_at:new Date().toISOString()})
        .eq('id',workflowId).eq('workspace_id',workspaceId).eq('action_type','audit_event').eq('trigger_type','manual').eq('requires_approval',true)
        .select('id').maybeSingle();
      if (error || !updated) throw new AutomationError('Unable to change workflow state.',409);
      return json({ok:true});
    }
    if (operation === 'enqueue') {
      const workflowId=readId(input.workflowId,'workflow');
      const key=input.eventKey;
      if (typeof key!=='string' || !EVENT_KEY.test(key)) throw new AutomationError('Invalid event idempotency key.');
      const {data:workflow,error:findError}=await db.from('intrigue_v17_workflows')
        .select('id,action_type,trigger_type,enabled,requires_approval').eq('id',workflowId).eq('workspace_id',workspaceId).maybeSingle();
      if (findError || !workflow) throw new AutomationError('Workflow not found.',404);
      if (!workflow.enabled || workflow.trigger_type!=='manual' || workflow.action_type!=='audit_event' || workflow.requires_approval!==true) {
        throw new AutomationError('Workflow must be enabled, manual and approval-required.',409);
      }
      const since=new Date(Date.now()-60*60*1000).toISOString();
      const {count:recent,error:rateError}=await db.from('intrigue_v17_runs')
        .select('id',{count:'exact',head:true}).eq('workspace_id',workspaceId).gte('created_at',since);
      if(rateError)throw new AutomationError('Could not verify workflow rate limit.',503);
      if((recent??0)>=100)throw new AutomationError('Workspace limit: 100 workflow runs per hour.',429);
      const {data:runId,error}=await db.rpc('intrigue_v17_enqueue',{
        p_workflow_id:workflowId,p_event_key:key,p_payload:{source:'manual',requested_by:userId},
      });
      if (error || typeof runId!=='string') throw new AutomationError('Unable to queue workflow.',503);
      return json({ok:true,runId});
    }
    if (operation === 'approve' || operation === 'cancel' || operation === 'retry') {
      const runId=readId(input.runId,'run');
      // Never allow a request scoped to company A to mutate company B's run.
      const {data:run,error:lookupError}=await db.from('intrigue_v17_runs')
        .select('id,status,approved_at,workflow_id').eq('id',runId).eq('workspace_id',workspaceId).maybeSingle();
      if (lookupError || !run) throw new AutomationError('Workflow run not found.',404);
      const {data:workflow,error:werr}=await db.from('intrigue_v17_workflows')
        .select('action_type,requires_approval').eq('id',run.workflow_id).eq('workspace_id',workspaceId).maybeSingle();
      if (werr || !workflow || workflow.action_type!=='audit_event' || workflow.requires_approval!==true) {
        throw new AutomationError('Unsupported workflow configuration.',409);
      }
      if (operation==='approve') {
        if (run.status!=='awaiting_approval') throw new AutomationError('This run is not awaiting approval.',409);
        const {data:ok,error}=await db.rpc('intrigue_v17_approve',{p_run_id:runId,p_approved_by:userId});
        if (error) throw new AutomationError('Unable to approve workflow run.',503);
        if (ok!==true) throw new AutomationError('Run was already handled. Refresh.',409);
        return json({ok:true});
      }
      if (operation==='cancel') {
        if (!['awaiting_approval','queued','retry_wait'].includes(run.status)) throw new AutomationError('This run cannot be cancelled in its current state.',409);
        const {data:ok,error}=await db.rpc('intrigue_v17_cancel',{
          p_workspace_id:workspaceId,p_run_id:runId,p_actor_id:userId,
        });
        if (error) throw new AutomationError('Unable to cancel run. Please contact your workspace administrator.',503);
        if (ok!==true) throw new AutomationError('Run already changed. Refresh.',409);
        return json({ok:true});
      }
      if (run.status!=='dead_letter' || !run.approved_at) throw new AutomationError('Only previously approved dead-letter runs can be retried.',409);
      const {data:ok,error}=await db.rpc('intrigue_v17_retry',{
        p_workspace_id:workspaceId,p_run_id:runId,p_actor_id:userId,
      });
      if (error) throw new AutomationError('Unable to retry run. Please contact your workspace administrator.',503);
      if (ok!==true) throw new AutomationError('Run already changed. Refresh.',409);
      return json({ok:true});
    }
    throw new AutomationError('Unknown automation operation.');
  } catch(e) {return fail(e);}
}
