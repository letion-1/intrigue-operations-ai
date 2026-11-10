/**
 * Safe integration point for the existing local worker.
 * This module is NOT automatically imported by the existing worker; a reviewed
 * change to tools/intrigue-v17/worker.mjs is required before activating BYOK.
 * Never send this token to browser code.
 */
export async function callIntrigueManagedGateway({workspaceId,requestKey,messages,tools,maxTokens=1000}) {
 const origin=(process.env.INTRIGUE_APP_URL||'').replace(/\/$/,'');
 const token=process.env.INTRIGUE_AI_WORKER_TOKEN;
 if(!origin.startsWith('https://')||!token||token.length<32)
   throw Error('Internal AI runtime URL or token is not configured.');
 const res=await fetch(`${origin}/api/ai-runtime/chat`,{
  method:'POST',headers:{'Content-Type':'application/json','x-intrigue-worker-token':token},
  body:JSON.stringify({workspace_id:workspaceId,request_key:requestKey,messages,max_tokens:maxTokens,
    ...(Array.isArray(tools)?{tools}:{})}),signal:AbortSignal.timeout(55000),cache:'no-store'});
 const result=await res.json().catch(()=>null);
 if(!res.ok)throw Error(typeof result?.error==='string'?result.error:'AI gateway unavailable.');
 return result;
}
