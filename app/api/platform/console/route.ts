import { type NextRequest } from 'next/server';
import { platformAuth, mustBeOperator, uuid, stringValue, json, apiError, checkOrigin, LifecycleError } from '@/lib/intrigue-platform';

// Operator identity comes from a verified Supabase Bearer token; NEVER from the browser body.
// All cross-tenant reads and freeze actions are service-role-only, behind a seeded operator allowlist.
export async function GET(req: NextRequest) {
  try {
    const ctx = await platformAuth(req);
    await mustBeOperator(ctx);
    const [company, tickets] = await Promise.all([
      ctx.service.rpc('intrigue_platform_operator_dashboard', {p_actor: ctx.user.id}),
      ctx.service.rpc('intrigue_platform_list_tickets', {p_actor: ctx.user.id,p_tenant:null,p_operator:true}),
    ]);
    if (company.error || tickets.error) throw new LifecycleError(503, 'Platform dashboard unavailable. Contact INTRIGUE Support.');
    return json({companies:company.data ?? [],tickets:tickets.data ?? [],read_only_metrics:true});
  } catch (err) {return apiError(err);}
}

export async function POST(req: NextRequest) {
  try {
    checkOrigin(req);
    const ctx = await platformAuth(req);
    await mustBeOperator(ctx);
    const b: unknown = await req.json().catch(()=>null);
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new LifecycleError(400,'Invalid request');
    const body=b as Record<string,unknown>;
    if (body.action === 'freeze') {
      if (!uuid(body.workspace_id) || typeof body.frozen !== 'boolean') throw new LifecycleError(400,'Invalid workspace action');
      const reason=stringValue(body.reason,500);
      if (reason.length < 8) throw new LifecycleError(400,'Reason must be at least 8 characters');
      const {data,error}=await ctx.service.rpc('intrigue_platform_set_freeze',{
        p_actor:ctx.user.id,p_tenant:body.workspace_id,p_frozen:body.frozen,p_reason:reason
      });
      if(error || data!==true) throw new LifecycleError(409,'Freeze change refused. Check for active AI jobs, closing workspace or invalid state.');
      return json({saved:true,frozen:body.frozen});
    }
    if (body.action === 'reply') {
      if (!uuid(body.ticket_id)) throw new LifecycleError(400,'Invalid ticket');
      const {data,error}=await ctx.service.rpc('intrigue_platform_reply_ticket',{
        p_actor:ctx.user.id,p_ticket:body.ticket_id,p_body:stringValue(body.message,4000),p_operator:true
      });
      if(error || data!==true) throw new LifecycleError(409,'Reply refused; ticket may be closed.');
      return json({saved:true});
    }
    if (body.action === 'status') {
      if (!uuid(body.ticket_id) || typeof body.status!=='string' || !['open','in_progress','waiting_client','resolved','closed'].includes(body.status))
        throw new LifecycleError(400,'Invalid status');
      const {data,error}=await ctx.service.rpc('intrigue_platform_ticket_status',{
        p_actor:ctx.user.id,p_ticket:body.ticket_id,p_status:body.status
      });
      if(error || data!==true) throw new LifecycleError(409,'Ticket status update refused');
      return json({saved:true});
    }
    throw new LifecycleError(400,'Unsupported action');
  } catch(err) {return apiError(err);}
}
