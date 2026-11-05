import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminClient, appOrigin } from '@/app/api/mail/_lib/common';
import { createClient } from '@/lib/supabase/server';
import { isCrmProvider } from '@/lib/intrigue-crm/providers';
import { exchangeTokens, seal } from '@/lib/intrigue-crm/server';

function result(status:string){
  const res=NextResponse.redirect(new URL(`/dashboard?integration=crm&crm=${encodeURIComponent(status)}`,appOrigin()));
  res.headers.set('Cache-Control','no-store');res.headers.set('Referrer-Policy','no-referrer');
  return res;
}
export async function GET(request:NextRequest){
  try {
    if(request.nextUrl.origin!==appOrigin()) return NextResponse.json({error:'OAuth origin mismatch'},{status:400});
    const state=request.nextUrl.searchParams.get('state') || '';
    if(!/^[a-zA-Z0-9_-]{40,100}$/.test(state)) return result('invalid_state');
    const db=adminClient();
    const {data:rows,error}=await db.from('intrigue_crm_oauth_states').update({consumed_at:new Date().toISOString()})
      .eq('state_hash',createHash('sha256').update(state).digest('hex'))
      .is('consumed_at',null).gt('expires_at',new Date().toISOString())
      .select('workspace_id,actor_id,provider');
    if(error||rows?.length!==1) return result('expired_state');
    const s=rows[0];if(!isCrmProvider(s.provider))return result('invalid_provider');
    if(request.nextUrl.searchParams.get('error'))return result('declined');
    const code=request.nextUrl.searchParams.get('code');
    if(!code||code.length>5000)return result('missing_code');
    // Authentication is independently checked at callback, not just at OAuth initiation.
    const userClient=await createClient();
    const {data:{user}}=await userClient.auth.getUser();
    if(!user || user.id!==s.actor_id)return result('session_changed');
    const {data:member}=await db.from('workspace_memberships').select('role')
      .eq('workspace_id',s.workspace_id).eq('user_id',user.id).maybeSingle();
    if(!member||!['owner','admin'].includes(String(member.role)))return result('access_revoked');
    const tokens=await exchangeTokens(s.provider,code,appOrigin());
    const {error:saveError}=await db.from('intrigue_crm_connections').upsert({
      workspace_id:s.workspace_id, provider:s.provider,connected_by:user.id,
      access_token_cipher:seal(tokens.accessToken),refresh_token_cipher:seal(tokens.refreshToken),
      expires_at:new Date(Date.now()+Math.max(60,Math.min(86400,tokens.expiresIn))*1000).toISOString(),
      api_domain:tokens.apiDomain,updated_at:new Date().toISOString(),
    },{onConflict:'workspace_id,provider'});
    if(saveError)return result('storage_failed');
    return result('connected');
  }catch{return result('failed');}
}
