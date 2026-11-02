'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {createClient} from '@/lib/supabase/client';
import './email-delivery-preferences.css';
export type DeliveryPrefs={defaultProvider:'gmail'|'outlook';replyTo:string;signature:string;revision:string};
export function useDeliveryPreferences(workspaceId:string){
  const supabase=useMemo(()=>createClient(),[]);
  const [prefs,setPrefs]=useState<DeliveryPrefs|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const refresh=useCallback(async()=>{
    const {data,error:authError}=await supabase.auth.getSession();
    if(authError||!data.session?.access_token)throw Error('Sign in to load company email preferences.');
    const res=await fetch(`/api/mail/preferences?workspaceId=${encodeURIComponent(workspaceId)}`,{cache:'no-store',headers:{Authorization:`Bearer ${data.session.access_token}`}});
    const obj:unknown=await res.json().catch(()=>null);
    const row=obj&&typeof obj==='object'?obj as Record<string,unknown>:{};
    if(!res.ok)throw Error(typeof row.error==='string'?row.error:'Unable to load company email preferences.');
    if((row.defaultProvider!=='gmail'&&row.defaultProvider!=='outlook')||typeof row.revision!=='string')throw Error('Invalid company email preferences.');
    setPrefs({defaultProvider:row.defaultProvider,replyTo:typeof row.replyTo==='string'?row.replyTo:'',signature:typeof row.signature==='string'?row.signature:'',revision:row.revision});
  },[supabase,workspaceId]);
  useEffect(()=>{let active=true;setPrefs(null);setError('');setLoading(true);
    refresh().catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load email settings.');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[refresh]);
  return {prefs,error,loading,refresh};
}
export function EmailDeliveryPreferencesSummary({prefs,loading,error}:{prefs:DeliveryPrefs|null;loading:boolean;error:string}){
  return <div className="edp-summary" aria-label="Email settings to be reviewed">
    <strong>Company email settings used for this send</strong>
    {loading?<p>Loading company settings…</p>:error?<p role="alert" className="edp-error">{error}</p>:
    prefs?<><p><b>Reply-to:</b> {prefs.replyTo||'Sender address (default)'}</p><p><b>Signature appended:</b></p>
    <pre>{prefs.signature||'(No company signature)'}</pre><small>Review the signature and reply-to before final confirmation. Changes require refreshing this screen.</small></>:null}
  </div>;
}
