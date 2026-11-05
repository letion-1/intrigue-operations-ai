import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { actor, adminClient, appOrigin, jsonBody, uuidPattern } from '@/app/api/mail/_lib/common';
import { isCrmProvider, oauthConfig } from '@/lib/intrigue-crm/providers';

export async function POST(request:NextRequest){
  try {
    if(request.nextUrl.origin!==appOrigin()) return NextResponse.json({error:'Open INTRIGUE from the authorized application address.'},{status:400});
    const body=await jsonBody(request);
    const provider=body.provider, workspaceId=body.workspaceId;
    if(!isCrmProvider(provider)||typeof workspaceId!=='string'||!uuidPattern.test(workspaceId)) return NextResponse.json({error:'Invalid provider or workspace.'},{status:400});
    const {userId}=await actor(request,workspaceId);
    const conf=oauthConfig(provider,appOrigin());
    const state=randomBytes(32).toString('base64url');
    const hash=createHash('sha256').update(state).digest('hex');
    const db=adminClient();
    const {error}=await db.from('intrigue_crm_oauth_states').insert({
      state_hash:hash,workspace_id:workspaceId,actor_id:userId,provider,
      expires_at:new Date(Date.now()+600_000).toISOString(),
    });
    if(error) throw Error('Could not create a secure CRM authorization request. Apply the CRM database migration first.');
    const url=new URL(conf.authorize);
    for(const [key,value] of Object.entries({client_id:conf.clientId,redirect_uri:conf.redirectUri,response_type:'code',state})) url.searchParams.set(key,value);
    if(provider==='zoho') {url.searchParams.set('scope',conf.scope);url.searchParams.set('access_type','offline');url.searchParams.set('prompt','consent');}
    if(provider==='hubspot') url.searchParams.set('scope',conf.scope);
    return NextResponse.json({authorizationUrl:url.toString()},{headers:{'Cache-Control':'no-store'}});
  } catch(err){const status=err instanceof Error&&'status' in err&&typeof err.status==='number'?err.status:503;
    return NextResponse.json({error:err instanceof Error?err.message:'Unable to start CRM authorization.'},{status,headers:{'Cache-Control':'no-store'}});}
}
