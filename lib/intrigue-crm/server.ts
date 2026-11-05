import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { adminClient } from '@/app/api/mail/_lib/common';
import { isCrmProvider, oauthConfig, safeApiDomain, type CrmProvider, mapCrmContacts } from './providers';

export class CrmError extends Error { constructor(message: string, public status=400) { super(message); } }
export { isCrmProvider };

function cryptoKey() {
  const raw = process.env.INTRIGUE_CRM_ENCRYPTION_KEY || '';
  const key = Buffer.from(raw,'base64');
  if (key.length !== 32) throw new CrmError('CRM token encryption key is not configured.',503);
  return key;
}
export function seal(value: string) {
  const nonce=randomBytes(12), cipher=createCipheriv('aes-256-gcm',cryptoKey(),nonce);
  const content=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return [nonce.toString('base64url'),cipher.getAuthTag().toString('base64url'),content.toString('base64url')].join('.');
}
export function unseal(value: string) {
  const parts=value.split('.');
  if(parts.length!==3) throw new CrmError('CRM connection needs reconnection.',409);
  const dec=createDecipheriv('aes-256-gcm',cryptoKey(),Buffer.from(parts[0],'base64url'));
  dec.setAuthTag(Buffer.from(parts[1],'base64url'));
  return Buffer.concat([dec.update(Buffer.from(parts[2],'base64url')),dec.final()]).toString('utf8');
}
export async function exchangeTokens(provider:CrmProvider,code:string,origin:string){
  const conf=oauthConfig(provider,origin);
  const params=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:conf.redirectUri});
  if(provider!=='pipedrive'){params.set('client_id',conf.clientId);params.set('client_secret',conf.secret);}
  const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded'};
  if(provider==='pipedrive') headers.Authorization='Basic '+Buffer.from(conf.clientId+':'+conf.secret).toString('base64');
  const resp=await fetch(conf.tokenUrl,{method:'POST',headers,body:params,signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(!resp.ok) throw new CrmError('CRM authorization failed. Please reconnect.',502);
  const raw:unknown=await resp.json();const t=raw && typeof raw==='object'?raw as Record<string,unknown>:{};
  if(typeof t.access_token!=='string'||typeof t.refresh_token!=='string'||!t.access_token||!t.refresh_token) throw new CrmError('CRM did not provide offline access. Reauthorize and allow offline access.',400);
  const apiDomain=safeApiDomain(provider,typeof t.api_domain==='string'?t.api_domain:undefined);
  return {accessToken:t.access_token,refreshToken:t.refresh_token,expiresIn:typeof t.expires_in==='number'?t.expires_in:3600,apiDomain};
}
export async function refreshToken(provider:CrmProvider,refresh:string,origin:string){
  const conf=oauthConfig(provider,origin);
  const params=new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh});
  if(provider!=='pipedrive'){params.set('client_id',conf.clientId);params.set('client_secret',conf.secret);}
  const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded'};
  if(provider==='pipedrive') headers.Authorization='Basic '+Buffer.from(conf.clientId+':'+conf.secret).toString('base64');
  const resp=await fetch(conf.tokenUrl,{method:'POST',headers,body:params,signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(!resp.ok) throw new CrmError('CRM session expired. Disconnect and reconnect.',409);
  const raw:unknown=await resp.json();const t=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};
  if(typeof t.access_token!=='string'||!t.access_token) throw new CrmError('CRM refresh failed.',502);
  return {accessToken:t.access_token,refreshToken:typeof t.refresh_token==='string'?t.refresh_token:refresh,expiresIn:typeof t.expires_in==='number'?t.expires_in:3600};
}
export async function loadCrmContacts(provider:CrmProvider,workspaceId:string,origin:string){
  const db=adminClient();
  const {data,error}=await db.from('intrigue_crm_connections').select('access_token_cipher,refresh_token_cipher,expires_at,api_domain')
    .eq('workspace_id',workspaceId).eq('provider',provider).maybeSingle();
  if(error) throw new CrmError('CRM connection storage is unavailable.',503);
  if(!data) throw new CrmError('Connect this CRM before previewing its contacts.',409);
  let token=unseal(String(data.access_token_cipher));
  if(new Date(String(data.expires_at)).getTime()<Date.now()+90_000){
    const fresh=await refreshToken(provider,unseal(String(data.refresh_token_cipher)),origin);
    token=fresh.accessToken;
    const {error:saveError}=await db.from('intrigue_crm_connections').update({
      access_token_cipher:seal(fresh.accessToken),refresh_token_cipher:seal(fresh.refreshToken),
      expires_at:new Date(Date.now()+Math.max(60,Math.min(86400,fresh.expiresIn))*1000).toISOString(),updated_at:new Date().toISOString(),
    }).eq('workspace_id',workspaceId).eq('provider',provider);
    if(saveError) throw new CrmError('Unable to rotate CRM access token.',503);
  }
  const domain=safeApiDomain(provider,String(data.api_domain));
  const endpoint=provider==='zoho' ? `${domain}/crm/v8/Contacts?fields=First_Name,Last_Name,Email,Phone,Account_Name&per_page=100&page=1`
    :provider==='hubspot'?`${domain}/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,email,phone,company`
    :`${domain}/api/v2/persons?limit=100`;
  const resp=await fetch(endpoint,{headers:{Authorization:provider==='zoho'?`Zoho-oauthtoken ${token}`:`Bearer ${token}`},signal:AbortSignal.timeout(16000),cache:'no-store'});
  if(!resp.ok) throw new CrmError(`CRM contact retrieval failed (${resp.status}). Check provider permissions.`,502);
  const raw:unknown=await resp.json();
  const contacts=mapCrmContacts(provider,raw);
  return {contacts:contacts.slice(0,100),pageLimited:true};
}
