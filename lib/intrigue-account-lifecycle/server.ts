import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

export class LifecycleError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type Dependency = {resource:string; count:number; rule?:string};
export type Preview = {
  email:string;
  owned_workspaces:number;
  workspace:{id:string;name:string;members:number}|null;
  account_blockers:Dependency[];
  storage_owned:number;
  workspace_references:Dependency[];
  empty_workspace_eligible:boolean;
  account_deletion_eligible:boolean;
};

function keys() {
  const url=(process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL||'').trim();
  const publicKey=(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||'').trim();
  const serviceKey=(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'').trim();
  if(!url||!publicKey)throw new LifecycleError(503,'Supabase configuration is incomplete.');
  return {url,publicKey,serviceKey};
}

export async function identity(request:NextRequest) {
  const token=request.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if(!token)throw new LifecycleError(401,'Please sign in again.');
  const {url,publicKey,serviceKey}=keys();
  const db=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false},
    global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:{user},error}=await db.auth.getUser(token);
  if(error||!user?.id||!user.email)throw new LifecycleError(401,'Session expired. Please sign in again.');
  return {db,user,serviceKey,url};
}

export function admin(url:string,secret:string):SupabaseClient {
  if(!secret)throw new LifecycleError(503,'Server-side Supabase secret key is unavailable.');
  return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
}

export function checkOrigin(request:NextRequest) {
  const origin=request.headers.get('origin');
  if(!origin) return; // Auth Bearer in a non-simple header is required for all mutation calls.
  try {
    const candidate=new URL(origin);
    const site=new URL(request.url);
    const canonical=process.env.INTRIGUE_APP_URL?new URL(process.env.INTRIGUE_APP_URL):null;
    if(candidate.protocol!=='https:' && candidate.hostname!=='localhost')throw Error();
    if(candidate.origin!==site.origin && candidate.origin!==canonical?.origin)throw Error();
  } catch {throw new LifecycleError(403,'Cross-origin request refused.');}
}

export async function recentlySignedIn(request:NextRequest,user:User,url:string,serviceKey:string) {
  // getUser(token) has already verified the JWT. Bind the *same token's session_id*
  // to a recently CREATED session, not the user's global last_sign_in_at timestamp.
  const token=request.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let sessionId:string|undefined;
  try {
    const claim=JSON.parse(Buffer.from(token?.split('.')[1]||'', 'base64url').toString('utf8')) as {session_id?:string;sub?:string};
    if(claim.sub===user.id && typeof claim.session_id==='string' && uuid.test(claim.session_id))
      sessionId=claim.session_id;
  }catch { /* fail closed */ }
  if(!sessionId)throw new LifecycleError(403,'For security, sign out and sign in again before this action.');
  const {data,error}=await admin(url,serviceKey).rpc('intrigue_rc2_recent_session',{
    p_actor:user.id,p_session_id:sessionId,
  });
  if(error||data!==true)throw new LifecycleError(403,
    'For security, sign out and sign in again, then complete this action within 10 minutes.');
}

export async function preview(db:SupabaseClient):Promise<Preview> {
  const {data,error}=await db.rpc('intrigue_rc2_preview');
  if(error)throw new LifecycleError(503,`Account lifecycle safety check unavailable (${error.code||'migration required'}).`);
  if(!data || typeof data!=='object' || typeof data.email!=='string' ||
    !Array.isArray(data.account_blockers) || !Array.isArray(data.workspace_references) ||
    typeof data.account_deletion_eligible!=='boolean') {
    throw new LifecycleError(503,'Unexpected safety-check response.');
  }
  return data as Preview;
}

export function safeResponseError(error:unknown):{status:number;message:string} {
  if(error instanceof LifecycleError)return {status:error.status,message:error.message};
  console.error('INTRIGUE RC2 request failed',error instanceof Error?error.message:'unknown error');
  return {status:500,message:'Unable to complete the request. No deletion is confirmed.'};
}
