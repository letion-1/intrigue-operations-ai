import { NextRequest, NextResponse } from 'next/server';
import { actor, adminClient, appOrigin, jsonBody, uuidPattern } from '@/app/api/mail/_lib/common';
import { isCrmProvider } from '@/lib/intrigue-crm/providers';
import { loadCrmContacts, CrmError } from '@/lib/intrigue-crm/server';

const response=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest){
  try{
    if(request.nextUrl.origin!==appOrigin()) return response({error:'Open INTRIGUE from the registered application address.'},400);
    const body=await jsonBody(request);
    const {workspaceId,provider,operation}=body;
    if(typeof workspaceId!=='string'||!uuidPattern.test(workspaceId)||!isCrmProvider(provider)||!['status','preview','import','disconnect'].includes(String(operation)))return response({error:'Invalid CRM request.'},400);
    const {userClient}=await actor(request,workspaceId);
    const db=adminClient();
    if(operation==='status'){
      const {data,error}=await db.from('intrigue_crm_connections').select('connected_at,updated_at,last_import_at,last_import_count')
        .eq('workspace_id',workspaceId).eq('provider',provider).maybeSingle();
      if(error) throw new CrmError('Unable to load CRM connection status.',503);
      return response({connected:!!data,lastImportAt:data?.last_import_at||null,lastImportCount:data?.last_import_count||0});
    }
    if(operation==='disconnect'){
      if(body.confirmation!==`DISCONNECT ${provider.toUpperCase()}`)return response({error:'Disconnect confirmation required.'},400);
      const {error}=await db.from('intrigue_crm_connections').delete().eq('workspace_id',workspaceId).eq('provider',provider);
      if(error)throw new CrmError('CRM disconnect failed.',503);
      return response({disconnected:true});
    }
    // Provider data is fetched entirely server-side. Contact data is never used to call arbitrary URLs.
    const {contacts,pageLimited}=await loadCrmContacts(provider,workspaceId,appOrigin());
    if(!contacts.length)return response({contacts:[],total:0,newRows:0,duplicateRows:0,invalidRows:0,pageLimited});
    const {data:preview,error:preErr}=await userClient.rpc('intrigue_v173_import_customers',{
      p_workspace_id:workspaceId,p_rows:contacts,p_apply:false,
    });
    if(preErr) throw new CrmError('CRM import preview failed: '+preErr.message,400);
    if(operation==='preview')return response({contacts:contacts.slice(0,20),total:contacts.length,newRows:preview.new_rows,duplicateRows:preview.duplicate_rows,invalidRows:preview.invalid_rows,pageLimited});
    if(operation!=='import'||body.confirmation!==`IMPORT ${preview.new_rows}`)return response({error:'Preview the CRM contacts and enter the exact import confirmation.'},400);
    if(preview.invalid_rows>0||preview.new_rows<1)return response({error:'No verified new contacts to import. Review the preview first.'},409);
    const {data:committed,error:commitErr}=await userClient.rpc('intrigue_v173_import_customers',{
      p_workspace_id:workspaceId,p_rows:contacts,p_apply:true,
    });
    if(commitErr)throw new CrmError('CRM import rejected: '+commitErr.message,409);
    const {error:auditError}=await db.from('intrigue_crm_connections').update({last_import_at:new Date().toISOString(),last_import_count:committed.new_rows,updated_at:new Date().toISOString()})
      .eq('workspace_id',workspaceId).eq('provider',provider);
    return response({imported:committed.new_rows,duplicateRows:committed.duplicate_rows,warning:auditError?'Contacts saved; sync timestamp could not be recorded.':null});
  }catch(err){return response({error:err instanceof CrmError?err.message:err instanceof Error&&'status' in err?err.message:'CRM request failed. Check logs.'},err instanceof Error&&'status' in err&&typeof err.status==='number'?err.status:500);}
}
