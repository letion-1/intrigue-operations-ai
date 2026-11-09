import { NextRequest, NextResponse } from 'next/server';
import { identity, admin, preview, recentlySignedIn, checkOrigin, LifecycleError, safeResponseError } from '@/lib/intrigue-account-lifecycle/server';

// Cache Components enabled: Next.js 16 uses Node.js by default and disallows
// route-level runtime/dynamic exports. Authentication and no-store headers
// are handled per request by GET/POST below.
const uid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (data:object,status=200) => NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});

async function owner(req:NextRequest) {
 const auth=await identity(req);
 const p=await preview(auth.db);
 if(p.owned_workspaces!==1 || !p.workspace?.id)
  throw new LifecycleError(403,'Only the verified company owner may close a company.');
 return {...auth,workspace:p.workspace, service:admin(auth.url,auth.serviceKey)};
}

export async function GET(req:NextRequest) {
 try {
  const ctx=await owner(req);
  if(req.nextUrl.searchParams.get('mode')==='export') {
   const {data,error}=await ctx.service.rpc('intrigue_v21_export_company',{
     p_actor:ctx.user.id,p_tenant:ctx.workspace.id});
   if(error||!data) throw new LifecycleError(409,'Complete company export unavailable. Do not proceed with deletion.');
   return new NextResponse(JSON.stringify(data,null,2),{status:200,headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Content-Disposition':'attachment; filename="INTRIGUE-company-business-export.json"',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
   }});
  }
  const {data,error}=await ctx.service.rpc('intrigue_v21_owner_preflight',{
    p_actor:ctx.user.id,p_tenant:ctx.workspace.id});
  if(error||!data)throw new LifecycleError(503,'Company erasure preflight unavailable. Apply and verify the V21 migration.');
  return reply(data);
 }catch(err){const e=safeResponseError(err);return reply({error:e.message},e.status);}
}

export async function POST(req:NextRequest) {
 try {
  checkOrigin(req);
  const ctx=await owner(req);
  const body:unknown=await req.json().catch(()=>null);
  if(!body || typeof body!=='object'||Array.isArray(body))throw new LifecycleError(400,'Invalid request.');
  const b=body as Record<string,unknown>;
  await recentlySignedIn(req,ctx.user,ctx.url,ctx.serviceKey);
  if(b.action==='cancel') {
   if(typeof b.case_id!=='string'||!uid.test(b.case_id)||b.confirmation!==`CANCEL ${b.case_id}`)
    throw new LifecycleError(400,'Exact cancellation confirmation required.');
   const {data,error}=await ctx.service.rpc('intrigue_v21_cancel_company',{
    p_actor:ctx.user.id,p_tenant:ctx.workspace.id,p_case:b.case_id});
   if(error||data!==true)throw new LifecycleError(409,'Cancellation could not be completed.');
   return reply({cancelled:true,database_erased:false});
  }
  if(b.action!=='erase')throw new LifecycleError(400,'Unsupported action.');
  if(b.exported!==true || b.acknowledged!==true || b.confirmation!==`DELETE COMPANY ${ctx.workspace.name}`)
   throw new LifecycleError(400,'Download the company export and type the exact company deletion confirmation.');
  // Stage serializes with workspace writes, causing database triggers to block
  // new AI claims, new CRM records and outgoing-mail history writes.
  const {data:caseId,error:stageError}=await ctx.service.rpc('intrigue_v21_stage_company',{
   p_actor:ctx.user.id,p_tenant:ctx.workspace.id,p_phrase:b.confirmation});
  if(stageError || typeof caseId!=='string'||!uid.test(caseId))
   throw new LifecycleError(409,'Closure could not be staged. Check active jobs, Storage objects and legal holds. Nothing was erased.');
  // This is a genuine, atomic, destructive database RPC. If it fails the staged
  // freeze remains to prevent new processing until owner cancels or retries.
  const {data:result,error:eraseError}=await ctx.service.rpc('intrigue_v21_erase_company',{
   p_actor:ctx.user.id,p_tenant:ctx.workspace.id,p_case:caseId,p_phrase:b.confirmation});
  if(eraseError || !result?.database_erased)
   return reply({database_erased:false,case_id:caseId,workspace_frozen:true,
    message:'Database erasure did not complete. The workspace is frozen. You may retry or cancel the staged closure. No completed deletion is confirmed.'},409);
  let loginDeleted=false;
  let loginNotice='Your personal login was retained; you may delete it separately if eligible.';
  if(b.delete_personal_login===true) {
   const [{count:owned,error:ownedError},{count:members,error:memberError}]=await Promise.all([
    ctx.service.from('workspaces').select('id',{count:'exact',head:true}).eq('owner_id',ctx.user.id),
    ctx.service.from('workspace_memberships').select('workspace_id',{count:'exact',head:true}).eq('user_id',ctx.user.id)
   ]);
   if(!ownedError&&!memberError&&owned===0&&members===0) {
    const {error:authError}=await ctx.service.auth.admin.deleteUser(ctx.user.id,false);
    if(!authError){loginDeleted=true;loginNotice='Personal login deleted.';}
    else loginNotice='Company database erased, but Auth login deletion was blocked. Review personal account dependencies separately.';
   }else loginNotice='Company database erased. Login retained because the user has other memberships or database checks were inconclusive.';
  }
  return reply({database_erased:true,account_deleted:loginDeleted,case_id:caseId,
   deleted_rows:result.deleted_rows,by_table:result.by_table,personal_login_status:loginNotice,
   backup_notice:'Historical database/provider backups are not erased by this transaction. Review the documented backup and subprocessor retention schedule.'});
 }catch(err){const e=safeResponseError(err);return reply({error:e.message},e.status);}
}
