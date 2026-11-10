import { type NextRequest } from 'next/server';
import { platformAuth, uuid, stringValue, json, apiError, checkOrigin, LifecycleError } from '@/lib/intrigue-platform';

async function memberships(ctx: Awaited<ReturnType<typeof platformAuth>>) {
  const [membership, owned] = await Promise.all([
    ctx.service.from('workspace_memberships').select('workspace_id').eq('user_id',ctx.user.id).limit(50),
    ctx.service.from('workspaces').select('id').eq('owner_id',ctx.user.id).limit(50)
  ]);
  if(membership.error || owned.error) throw new LifecycleError(503,'Unable to check workspace memberships.');
  const ids=[...new Set([...(membership.data||[]).map(x=>x.workspace_id),...(owned.data||[]).map(x=>x.id)])];
  if(!ids.length) return [];
  const {data,error}=await ctx.service.from('workspaces').select('id,name').in('id',ids).limit(50);
  if(error) throw new LifecycleError(503,'Unable to load workspaces.');
  return data||[];
}

export async function GET(req:NextRequest) {
  try {
    const ctx=await platformAuth(req);
    const companies=await memberships(ctx);
    const workspaceId=req.nextUrl.searchParams.get('workspace_id');
    if(!workspaceId) return json({workspaces:companies,tickets:[]});
    if(!uuid(workspaceId) || !companies.some(w=>w.id===workspaceId)) throw new LifecycleError(403,'You are not a member of this company.');
    const {data,error}=await ctx.service.rpc('intrigue_platform_list_tickets',{
      p_actor:ctx.user.id,p_tenant:workspaceId,p_operator:false
    });
    if(error) throw new LifecycleError(503,'Help Center is temporarily unavailable. Contact INTRIGUE Support.');
    return json({workspaces:companies,tickets:data||[]});
  }catch(err){return apiError(err);}
}

export async function POST(req:NextRequest) {
  try {
    checkOrigin(req);
    const ctx=await platformAuth(req);
    const b:unknown=await req.json().catch(()=>null);
    if(!b||typeof b!=='object'||Array.isArray(b)) throw new LifecycleError(400,'Invalid request');
    const body=b as Record<string,unknown>;
    if(body.action==='create') {
      if(!uuid(body.workspace_id)) throw new LifecycleError(400,'Invalid company');
      const subject=stringValue(body.subject,160);
      const ticketBody=stringValue(body.message,4000);
      const category=body.category;
      if(typeof category!=='string'||!['general','technical','integration','billing','privacy'].includes(category))
       throw new LifecycleError(400,'Invalid category');
      const {data,error}=await ctx.service.rpc('intrigue_platform_new_ticket',{
        p_actor:ctx.user.id,p_tenant:body.workspace_id,p_subject:subject,
        p_category:category,p_body:ticketBody
      });
      if(error){
       if(error.code==='54000') throw new LifecycleError(429,'Daily support ticket limit reached. Try again tomorrow.');
       if(error.code==='22023') throw new LifecycleError(400,'Check the subject and message, then try again.');
       if(error.code==='42501') throw new LifecycleError(403,'You cannot create a ticket for this company.');
       throw new LifecycleError(503,'Support request could not be saved. Try again or contact INTRIGUE Support.');
      }
      if(!uuid(data)) throw new LifecycleError(503,'Ticket was not confirmed by the server. Please check your conversation list before retrying.');
      return json({created:true,ticket_id:data},201);
    }
    if(body.action==='reply') {
      if(!uuid(body.ticket_id)) throw new LifecycleError(400,'Invalid ticket');
      const {data,error}=await ctx.service.rpc('intrigue_platform_reply_ticket',{
        p_actor:ctx.user.id,p_ticket:body.ticket_id,p_body:stringValue(body.message,4000),p_operator:false
      });
      if(error||data!==true)throw new LifecycleError(403,'Reply refused. Only your tickets or those managed by the company owner can be accessed.');
      return json({saved:true});
    }
    throw new LifecycleError(400,'Unsupported action');
  }catch(err){return apiError(err);}
}
