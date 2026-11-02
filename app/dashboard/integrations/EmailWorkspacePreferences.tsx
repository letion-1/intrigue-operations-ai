'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MailCheck, Save, RefreshCcw } from 'lucide-react';
import './email-workspace-preferences.css';

type Prefs={defaultProvider:'gmail'|'outlook';replyTo:string;signature:string;revision:string};
const empty:Prefs={defaultProvider:'gmail',replyTo:'',signature:'',revision:'unset'};
function describe(x:unknown){return x instanceof Error?x.message:'Could not update business email settings.';}
export default function EmailWorkspacePreferences({workspaceId,canManage}:{workspaceId:string;canManage:boolean}) {
  const supabase=useMemo(()=>createClient(),[]);
  const [prefs,setPrefs]=useState<Prefs>(empty);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const api=useCallback(async(method:'GET'|'POST',form?:Prefs)=>{
    const {data,error:e}=await supabase.auth.getSession();
    if(e||!data.session?.access_token)throw Error('Sign in again to manage email settings.');
    const url=method==='GET'?`/api/mail/preferences?workspaceId=${encodeURIComponent(workspaceId)}`:'/api/mail/preferences';
    const res=await fetch(url,{method,cache:'no-store',headers:{Authorization:`Bearer ${data.session.access_token}`,...(form?{'Content-Type':'application/json'}:{})},...(form?{body:JSON.stringify({workspaceId,...form})}:{})});
    const obj:unknown=await res.json().catch(()=>null);
    const result=obj&&typeof obj==='object'?obj as Record<string,unknown>:{};
    if(!res.ok)throw Error(typeof result.error==='string'?result.error:`Email preferences request failed (${res.status}).`);
    if((result.defaultProvider!=='gmail'&&result.defaultProvider!=='outlook')||typeof result.revision!=='string')throw Error('Invalid email preferences response.');
    return {defaultProvider:result.defaultProvider,replyTo:typeof result.replyTo==='string'?result.replyTo:'',signature:typeof result.signature==='string'?result.signature:'',revision:result.revision} as Prefs;
  },[supabase,workspaceId]);
  const refresh=useCallback(async()=>{setPrefs(await api('GET'));},[api]);
  useEffect(()=>{
    let active=true;setPrefs(empty);setLoading(true);setError('');setNotice('');
    if(canManage)api('GET').then(data=>{if(active)setPrefs(data);}).catch(e=>{if(active)setError(describe(e));}).finally(()=>{if(active)setLoading(false);});
    else setLoading(false);
    return()=>{active=false;};
  },[api,canManage]);
  async function save(){
    if(busy)return;setBusy(true);setNotice('');setError('');
    try{const saved=await api('POST',prefs);setPrefs(saved);setNotice('Company email preferences saved. Review these settings again before any proposal is sent.');}
    catch(e){setError(describe(e));}finally{setBusy(false);}
  }
  if(!canManage)return null;
  return <section className="ewp-panel" aria-label="Workspace email preferences">
    <h3><MailCheck size={18}/> Company email preferences</h3>
    <p className="ewp-muted">These settings control actual outbound proposal email. Any older provider preference under Advanced settings does not override them. Use a reply-to address your company controls; sending still requires approval and final confirmation.</p>
    {loading?<p className="ewp-muted">Loading saved preferences…</p>:<>
      <div className="ewp-form">
        <label>Default email provider
          <select value={prefs.defaultProvider} onChange={e=>setPrefs(p=>({...p,defaultProvider:e.target.value as 'gmail'|'outlook'}))} disabled={busy}>
            <option value="gmail">Gmail</option><option value="outlook">Microsoft Outlook / Microsoft 365</option>
          </select>
        </label>
        <label>Reply-to address (optional)
          <input type="email" maxLength={254} value={prefs.replyTo} onChange={e=>setPrefs(p=>({...p,replyTo:e.target.value}))} placeholder="support@yourcompany.com" disabled={busy} autoComplete="email"/>
        </label>
        <label className="ewp-full">Company email signature (optional)
          <textarea value={prefs.signature} onChange={e=>setPrefs(p=>({...p,signature:e.target.value}))} rows={4} maxLength={1200} placeholder={'Kind regards,\nYour Company Team'} disabled={busy}/>
          <small>{prefs.signature.length}/1200 characters · Appended to approved proposal emails after final review</small>
        </label>
      </div>
      <div className="ewp-actions">
        <button type="button" disabled={busy} onClick={()=>void save()}><Save size={15}/>{busy?'Saving…':'Save email preferences'}</button>
        <button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(describe(e)))}><RefreshCcw size={15}/> Refresh</button>
      </div>
    </>}
    {error&&<p role="alert" className="ewp-error">{error}</p>}{notice&&<p role="status" className="ewp-notice">{notice}</p>}
  </section>;
}
