'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CheckCircle2, Link2, Loader2, RefreshCw, Unplug } from 'lucide-react';

function describe(error:unknown) {return error instanceof Error?error.message:'Outlook connection failed.';}
export default function OutlookConnection({workspaceId}:{workspaceId:string}) {
  const supabase=useMemo(()=>createClient(),[]);
  const [connected,setConnected]=useState(false);
  const [sender,setSender]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const api=useCallback(async (path:string,method:'GET'|'POST',data?:Record<string,unknown>)=>{
    const {data:auth,error:authError}=await supabase.auth.getSession();
    if(authError||!auth.session?.access_token) throw new Error('Sign in again to manage Outlook.');
    const target=method==='GET'?`${path}?workspaceId=${encodeURIComponent(workspaceId)}`:path;
    const response=await fetch(target,{method,cache:'no-store',
      headers:{Authorization:`Bearer ${auth.session.access_token}`,...(data?{'Content-Type':'application/json'}:{})},
      ...(data?{body:JSON.stringify(data)}:{})});
    const payload:unknown=await response.json().catch(()=>null);
    const result=payload&&typeof payload==='object' ? payload as Record<string,unknown> : {};
    if(!response.ok) throw new Error(typeof result.error==='string'?result.error:`Outlook request failed (${response.status}).`);
    return result;
  },[supabase,workspaceId]);
  const refresh=useCallback(async()=>{
    const data=await api('/api/mail/outlook/status','GET');
    setConnected(data.connected===true);setSender(typeof data.sender==='string'?data.sender:null);
  },[api]);
  useEffect(()=>{
    let active=true;setLoading(true);setConnected(false);setSender(null);setError('');setNotice('');
    refresh().catch(e=>{if(active)setError(describe(e));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[refresh]);
  // Display OAuth outcome after the full-page Microsoft redirect. The callback carries
  // only a safe status, OAuth error category and optional AADSTS diagnostic number.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get('outlook');
    if (!result) return;
    const kind = url.searchParams.get('outlook_error') || '';
    const rawCode = url.searchParams.get('outlook_code') || '';
    const code = /^AADSTS\d{5,7}$/.test(rawCode) ? ` (${rawCode})` : '';
    if (result === 'connected') {
      setNotice('Microsoft Outlook connected successfully.');
    } else if (result === 'declined') {
      setError(`Microsoft did not authorize Outlook${code}. ${kind === 'access_denied' ? 'The account may have declined consent, or its organization may require administrator approval.' : 'Review the Microsoft app registration and sign-in permissions.'} ${code ? 'Look up the AADSTS code in Microsoft Entra sign-in logs.' : 'Retry and check for a Microsoft consent or administrator approval screen.'}`);
    } else {
      const messages: Record<string, string> = {
        expired_state: 'The Outlook sign-in attempt expired or was already used. Click Connect Outlook again.',
        invalid_state: 'Microsoft returned an invalid authorization state. Restart the Outlook connection.',
        missing_code: 'Microsoft did not return an authorization code. Restart Outlook authorization.',
        no_refresh_token: 'Microsoft did not grant offline access. Check delegated permissions and reconnect.',
        missing_scope: 'Microsoft did not grant Mail.Send. Check delegated Microsoft Graph permissions and consent.',
        profile_failed: 'Microsoft Graph could not read the connected account profile. Check User.Read and the mailbox account.',
        access_revoked: 'Your company Owner/Admin access changed during authorization.',
        storage_failed: 'Outlook authorization could not be stored. Verify the V16.8 Supabase migration.',
        callback_failed: 'The Outlook callback failed. Check the Vercel function logs for /api/mail/outlook/callback.',
      };
      setError(messages[result] || 'Outlook connection failed. Check Microsoft permissions and try again.');
    }
    for (const key of ['outlook','outlook_error','outlook_code']) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);
  async function connect(){
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{
      const data=await api('/api/mail/outlook/start','POST',{workspaceId});
      if(typeof data.authorizationUrl!=='string')throw new Error('Microsoft authorization URL missing.');
      const url=new URL(data.authorizationUrl);
      if(url.origin!=='https://login.microsoftonline.com')throw new Error('Unexpected Microsoft authorization destination.');
      window.location.assign(url.href);
    }catch(e){setError(describe(e));setBusy(false);}
  }
  async function disconnect(){
    if(busy||!window.confirm(`Disconnect Outlook ${sender||''} from this company? Existing sent history will remain.`))return;
    setBusy(true);setError('');setNotice('');
    try{await api('/api/mail/outlook/disconnect','POST',{workspaceId});await refresh();setNotice('Outlook disconnected. You can also revoke the authorization in your Microsoft account.');}
    catch(e){setError(describe(e));}finally{setBusy(false);}
  }
  return <div className="bec-provider" aria-label="Microsoft Outlook connection">
    <div className="bec-provider-info"><strong>Microsoft Outlook / Microsoft 365</strong>
      {connected?<p className="bec-connected"><CheckCircle2 size={14}/> Connected: {sender}</p>
        :<p>Not connected. Authorize Microsoft Graph to send approved proposal PDFs.</p>}
      <small>Uses delegated Mail.Send and User.Read permissions, not full mailbox read access.</small>
      {loading&&<p><Loader2 size={13}/> Checking Microsoft connection…</p>}
      {error&&<p className="bec-error" role="alert">{error}</p>}
      {notice&&<p className="bec-notice" role="status">{notice}</p>}
    </div>
    <div className="bec-actions">
      {!loading&&(connected?<>
        <button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(describe(e)))}><RefreshCw size={14}/> Refresh</button>
        <button type="button" disabled={busy} onClick={()=>void disconnect()}><Unplug size={14}/> Disconnect</button>
      </>:<button type="button" className="bec-primary" disabled={busy} onClick={()=>void connect()}><Link2 size={14}/> Connect Outlook</button>)}
    </div>
  </div>;
}
