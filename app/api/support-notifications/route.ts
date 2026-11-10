import { type NextRequest } from 'next/server';
import { platformAuth, mustBeOperator, uuid, json, apiError, checkOrigin, LifecycleError } from '@/lib/intrigue-platform';

// Both audiences use the same database events, but separate verified sessions.
// Never accept an actor id, recipient id or arbitrary tenant from a POST body.
function scope(req: NextRequest) {
  const operator = req.nextUrl.searchParams.get('audience') === 'operator';
  const workspace = req.nextUrl.searchParams.get('workspace_id');
  if (!operator && !uuid(workspace)) throw new LifecycleError(400,'Select a valid company workspace.');
  return {operator, workspace: operator ? null : workspace};
}

export async function GET(req: NextRequest) {
  try {
    const {operator,workspace}=scope(req);
    const ctx=await platformAuth(req);
    if(operator) await mustBeOperator(ctx);
    const {data,error}=await ctx.service.rpc('intrigue_support_notifications_list',{
      p_actor:ctx.user.id,p_operator:operator,p_workspace:workspace,p_limit:40
    });
    if(error) throw new LifecycleError(503,'Unable to load support notifications.');
    return json({items:data?.items??[],unread_count:data?.unread_count??0});
  }catch(err){return apiError(err);}
}

export async function POST(req: NextRequest) {
  try {
    checkOrigin(req);
    const {operator,workspace}=scope(req);
    const ctx=await platformAuth(req);
    if(operator) await mustBeOperator(ctx);
    const b:unknown=await req.json().catch(()=>null);
    if(!b||typeof b!=='object'||Array.isArray(b))throw new LifecycleError(400,'Invalid request.');
    const body=b as Record<string,unknown>;
    if(body.action!=='mark_read'||!uuid(body.notification_id)) throw new LifecycleError(400,'Invalid notification action.');
    const {data,error}=await ctx.service.rpc('intrigue_support_notification_mark_read',{
      p_actor:ctx.user.id,p_notification:body.notification_id,p_operator:operator,p_workspace:workspace
    });
    if(error||data!==true)throw new LifecycleError(403,'Notification not accessible.');
    return json({saved:true});
  }catch(err){return apiError(err);}
}
