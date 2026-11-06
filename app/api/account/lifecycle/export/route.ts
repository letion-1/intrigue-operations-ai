import {NextRequest,NextResponse,connection} from 'next/server';
import {identity,preview,safeResponseError,LifecycleError} from '@/lib/intrigue-account-lifecycle/server';

// Scope: personal account data. Company CRM, quotations and documents must be exported
// separately by the authorized company owner in Workspace Data Management.
export async function GET(request:NextRequest){
 await connection();
 try{
  const {db,user}=await identity(request);
  const p=await preview(db);
  const {data:memberships,error:membersError}=await db.from('workspace_memberships')
    .select('workspace_id,role,created_at').eq('user_id',user.id);
  if(membersError)throw new LifecycleError(503,'Unable to export membership information.');
  const {data:requests,error:reqError}=await db.from('intrigue_rc2_requests')
    .select('id,kind,status,requested_at,response_due_at,completed_at').eq('requested_by',user.id);
  if(reqError)throw new LifecycleError(503,'Unable to export request history.');
  const result={
    export_type:'personal_account_summary',exported_at:new Date().toISOString(),
    note:'This export contains your INTRIGUE account summary only. Company business data can be exported using the owner-only Data Management feature.',
    account:{id:user.id,email:user.email,created_at:user.created_at,last_sign_in_at:user.last_sign_in_at,
      user_metadata:user.user_metadata},
    owned_workspace:p.workspace,
    memberships:memberships||[],requests:requests||[]
  };
  return new NextResponse(JSON.stringify(result,null,2),{status:200,headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Content-Disposition':'attachment; filename="INTRIGUE-personal-account-export.json"',
    'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff'
  }});
 }catch(e){const x=safeResponseError(e);return NextResponse.json({error:x.message},{status:x.status,headers:{'Cache-Control':'no-store'}});}
}
