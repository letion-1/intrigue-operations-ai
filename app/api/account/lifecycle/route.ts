import { NextRequest, NextResponse } from 'next/server';
import {identity,admin,checkOrigin,recentlySignedIn,preview,LifecycleError,safeResponseError} from '@/lib/intrigue-account-lifecycle/server';

const response=(data:object,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request:NextRequest){
  try{
    const {db,user}=await identity(request);
    const p=await preview(db);
    const {data:requests,error}=await db.from('intrigue_rc2_requests')
      .select('id,kind,status,workspace_label,requested_at,response_due_at,completed_at')
      .eq('requested_by',user.id).order('requested_at',{ascending:false}).limit(15);
    if(error)throw new LifecycleError(503,'Unable to load deletion requests.');
    const {data:transfers,error:transferError}=await db.from('intrigue_rc2_transfers')
      .select('id,workspace_id,status,created_at,expires_at,from_user,to_user')
      .eq('to_user',user.id).eq('status','pending').limit(10);
    if(transferError)throw new LifecycleError(503,'Unable to load ownership transfers.');
    return response({enabled:process.env.INTRIGUE_RC2_DELETION_ENABLED==='true',requestEnabled:true,preview:p,requests:requests||[],transfers:transfers||[]});
  }catch(e){const x=safeResponseError(e);return response({error:x.message},x.status);}
}

export async function POST(request:NextRequest){
  try{
    checkOrigin(request);
    const {db,user,url,serviceKey}=await identity(request);
    const input:unknown=await request.json().catch(()=>null);
    if(!input||typeof input!=='object'||Array.isArray(input))throw new LifecycleError(400,'Invalid request.');
    const b=input as Record<string,unknown>;
    const action=b.action;
    const safety=await preview(db);

    // A privacy request is a NON-DESTRUCTIVE intake action. It remains available
    // when automatic deletion and ownership transfer are disabled in Production.
    if(action==='request'){
      const kind=b.kind;
      if(kind!=='account'&&kind!=='workspace'&&kind!=='workspace_and_account')
        throw new LifecycleError(400,'Invalid deletion request.');
      const workspaceId=kind==='account'?null:safety.workspace?.id;
      if(kind!=='account'&&!workspaceId)
        throw new LifecycleError(403,'Only the verified company owner may request company deletion.');
      const expected=kind==='account'
        ?`REQUEST ACCOUNT ${user.email}`
        :kind==='workspace'
          ?`REQUEST COMPANY ${safety.workspace?.name}`
          :`REQUEST COMPANY AND ACCOUNT ${safety.workspace?.name}`;
      if(b.acknowledged!==true||b.confirmation!==expected)
        throw new LifecycleError(400,'Review the consequences and type the exact request confirmation.');
      // SECURITY: auth.uid() inside the RLS-protected RPC identifies the caller.
      // Never accept a client-provided user ID or arbitrary workspace ID.
      const {data,error}=await db.rpc('intrigue_rc2_request',{
        p_kind:kind,p_workspace_id:workspaceId
      });
      if(error||typeof data!=='string'||!id.test(data))
        throw new LifecycleError(409,'Request could not be recorded. Refresh and try again.');
      // This reference only proves receipt. It is NOT an erasure confirmation.
      return response({requested:true,request_id:data,status:'received',
        message:'Your request has been recorded for manual review. No records have been deleted.'},202);
    }

    // No transfer or deletion execution is possible with the feature disabled.
    if(process.env.INTRIGUE_RC2_DELETION_ENABLED!=='true')
      throw new LifecycleError(503,'Destructive account actions are currently disabled. You may still submit a privacy request.');

    if(action==='offer_transfer'){
      await recentlySignedIn(request,user,url,serviceKey);
      if(!safety.workspace?.id || typeof b.to_user!=='string'||!id.test(b.to_user))
        throw new LifecycleError(400,'Choose an active team member to receive ownership.');
      const {data,error}=await admin(url,serviceKey).rpc('intrigue_rc2_offer_transfer',{
        p_actor:user.id,p_workspace_id:safety.workspace.id,p_to_user:b.to_user});
      if(error)throw new LifecycleError(409,'Ownership transfer could not be offered. Check team membership and try again.');
      return response({offered:true,transfer_id:data});
    }

    if(action==='accept_transfer'){
      await recentlySignedIn(request,user,url,serviceKey);
      if(typeof b.transfer_id!=='string'||!id.test(b.transfer_id))throw new LifecycleError(400,'Invalid transfer reference.');
      const {error}=await admin(url,serviceKey).rpc('intrigue_rc2_accept_transfer',{p_actor:user.id,p_transfer_id:b.transfer_id});
      if(error)throw new LifecycleError(409,'Transfer could not be completed. It may have expired or membership changed.');
      return response({transferred:true});
    }

    if(action==='delete_empty_workspace'){
      await recentlySignedIn(request,user,url,serviceKey);
      if(!safety.workspace?.id||!safety.empty_workspace_eligible)
        throw new LifecycleError(409,'Company contains protected records. Use reviewed deletion instead.');
      if(b.acknowledged!==true || b.confirmation!==`DELETE ${safety.workspace.name}`)
        throw new LifecycleError(400,'Type the exact company name confirmation.');
      const {data,error}=await admin(url,serviceKey).rpc('intrigue_rc2_delete_empty_workspace',{
        p_actor:user.id,p_workspace_id:safety.workspace.id,p_phrase:b.confirmation});
      if(error)throw new LifecycleError(409,'Company deletion was blocked by newly detected dependencies. No company deletion is confirmed.');
      // Separate transactions: workspace removal can succeed while Auth deletion is blocked.
      // Caller receives the partial result instead of an untrue success message.
      if(b.also_delete_account!==true)return response({workspace_deleted:true,account_deleted:false,request_id:data});
      const after=await preview(db);
      if(!after.account_deletion_eligible)return response({workspace_deleted:true,account_deleted:false,
        request_id:data,message:'Workspace removed. Account deletion still has protected dependencies.'},202);
      try {
        const service=admin(url,serviceKey);
        const {error:authError}=await service.auth.admin.deleteUser(user.id,false);
        if(authError)throw authError;
        await service.from('intrigue_rc2_requests').update({status:'completed',completed_at:new Date().toISOString()}).eq('id',data);
        return response({workspace_deleted:true,account_deleted:true,request_id:data});
      }catch{
        return response({workspace_deleted:true,account_deleted:false,request_id:data,
          message:'Workspace deleted. Account removal requires follow-up; check Storage ownership and account dependencies.'},202);
      }
    }

    if(action==='delete_account'){
      await recentlySignedIn(request,user,url,serviceKey);
      if(!safety.account_deletion_eligible)throw new LifecycleError(409,'Account still has protected company or data references.');
      if(b.acknowledged!==true||b.confirmation!==`DELETE ${user.email}`)
        throw new LifecycleError(400,'Type the exact account confirmation.');
      const {data:requestId,error:requestError}=await db.rpc('intrigue_rc2_request',{p_kind:'account',p_workspace_id:null});
      if(requestError)throw new LifecycleError(503,'Unable to record deletion request.');
      const service=admin(url,serviceKey);
      const {error:deleteError}=await service.auth.admin.deleteUser(user.id,false);
      if(deleteError){
        await service.from('intrigue_rc2_requests').update({status:'failed'}).eq('id',requestId);
        throw new LifecycleError(409,'Supabase blocked account removal. No account deletion is confirmed. Contact support with your request ID.');
      }
      await service.from('intrigue_rc2_requests').update({status:'completed',completed_at:new Date().toISOString()}).eq('id',requestId);
      return response({account_deleted:true,request_id:requestId});
    }

    throw new LifecycleError(400,'Unknown account action.');
  }catch(e){const x=safeResponseError(e);return response({error:x.message},x.status);}
}
