'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {createClient} from '@/lib/supabase/client';
import {CheckCircle2,CloudDownload,Link2,RefreshCcw,ShieldAlert,Unplug} from 'lucide-react';
import type {CrmProvider} from '@/lib/intrigue-crm/providers';
import './crm-connections.css';

const NAMES:Record<CrmProvider,string>={zoho:'Zoho CRM',hubspot:'HubSpot',pipedrive:'Pipedrive'};
const PROVIDERS:CrmProvider[]=['zoho','hubspot','pipedrive'];
type Contact={full_name:string;email:string;phone:string;company_name:string};
type Preview={contacts:Contact[];total:number;newRows:number;duplicateRows:number;invalidRows:number;pageLimited:boolean};
type ProviderStatus={connected:boolean;lastImportAt:string|null;lastImportCount:number};
const INITIAL:ProviderStatus={connected:false,lastImportAt:null,lastImportCount:0};
export default function CrmConnections({workspaceId,onImported}:{workspaceId:string;onImported:()=>void}){
  const supabase=useMemo(()=>createClient(),[]);
  const [statuses,setStatuses]=useState<Record<CrmProvider,ProviderStatus>>({zoho:INITIAL,hubspot:INITIAL,pipedrive:INITIAL});
  const [reviews,setReviews]=useState<Partial<Record<CrmProvider,Preview>>>({});
  const [confirmation,setConfirmation]=useState<Partial<Record<CrmProvider,string>>>({});
  const [busy,setBusy]=useState<CrmProvider|null>(null);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [loading,setLoading]=useState(true);
  const [callbackStatus,setCallbackStatus]=useState<string|null>(null);
  const req=useCallback(async(provider:CrmProvider,operation:string,extra:Record<string,unknown>={})=>{
    const {data,error:authErr}=await supabase.auth.getSession();
    if(authErr||!data.session?.access_token)throw Error('Sign in again to connect a CRM.');
    const uri=operation==='start'?'/api/integrations/crm/start':'/api/integrations/crm/contacts';
    const res=await fetch(uri,{method:'POST',headers:{Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({provider,workspaceId,...(operation==='start'?{}:{operation}),...extra}),cache:'no-store'});
    const payload:unknown=await res.json().catch(()=>null);
    const body=payload && typeof payload==='object' ? payload as Record<string,unknown> : {};
    if(!res.ok)throw Error(typeof body.error==='string'?body.error:`CRM request failed (${res.status}).`);
    return body;
  },[supabase,workspaceId]);
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{const updates=await Promise.all(PROVIDERS.map(async p=>({p,data:await req(p,'status')})));
      const next={zoho:INITIAL,hubspot:INITIAL,pipedrive:INITIAL};
      for(const item of updates)next[item.p]={connected:item.data.connected===true,lastImportAt:typeof item.data.lastImportAt==='string'?item.data.lastImportAt:null,lastImportCount:Number(item.data.lastImportCount||0)};
      setStatuses(next);
    }catch(err){setError(err instanceof Error?err.message:'Unable to check CRM connections.');}
    finally{setLoading(false);}
  },[req]);
  useEffect(()=>{void load();},[load]);
  const perform=async(provider:CrmProvider,operation:'start'|'preview'|'import'|'disconnect')=>{
    if(busy)return;
    setBusy(provider);setError('');setNotice('');
    try{
      if(operation==='disconnect'&&!window.confirm(`Disconnect ${NAMES[provider]} from this company? Imported contacts will remain in INTRIGUE.`))return;
      const extra:Record<string,unknown>={};
      if(operation==='import')extra.confirmation=confirmation[provider];
      if(operation==='disconnect')extra.confirmation=`DISCONNECT ${provider.toUpperCase()}`;
      const data=await req(provider,operation,extra);
      if(operation==='start'){
        const url=typeof data.authorizationUrl==='string'?new URL(data.authorizationUrl):null;
        if(!url||url.protocol!=='https:')throw Error('Provider authorization URL was invalid.');
        window.location.assign(url.toString());return;
      }
      if(operation==='preview'){
        setReviews(prev=>({...prev,[provider]:data as Preview}));
        setConfirmation(prev=>({...prev,[provider]:''}));
        setNotice(`${NAMES[provider]} preview loaded. Confirm explicitly before importing.`);
      }else if(operation==='import'){
        setNotice(`${Number(data.imported||0)} contacts added from ${NAMES[provider]}; ${Number(data.duplicateRows||0)} duplicates skipped. No existing contacts overwritten.`);
        setReviews(prev=>({...prev,[provider]:undefined}));setConfirmation(prev=>({...prev,[provider]:''}));
        onImported();void load();
      }else if(operation==='disconnect'){
        setNotice(`${NAMES[provider]} disconnected. Existing INTRIGUE contacts remain unchanged.`);
        setReviews(prev=>({...prev,[provider]:undefined}));void load();
      }
    }catch(err){setError(err instanceof Error?err.message:'CRM operation failed.');}
    finally{setBusy(null);}
  };
  useEffect(()=>{setCallbackStatus(new URLSearchParams(window.location.search).get('crm'));},[]);
  return <section className="crm-connect" aria-label="Connected CRM platforms">
    <div className="crm-connect-heading"><div><p className="crm-connect-kicker">CUSTOMER DATA</p><h2>Connect your CRM</h2><p>Authorize a provider, preview contacts, and approve an add-only import. Your company's existing contacts are never overwritten.</p></div><button type="button" className="crm-connect-secondary" onClick={()=>void load()} disabled={loading||!!busy}><RefreshCcw size={15}/> Refresh</button></div>
    {callbackStatus&&<p role="status" className="crm-connect-note">Connection result: {callbackStatus==='connected'?'Connected successfully. Refresh the status below.':`Could not connect (${callbackStatus}). Please review configuration or try again.`}</p>}
    {error&&<p role="alert" className="crm-connect-error"><ShieldAlert size={16}/>{error}</p>}
    {notice&&<p role="status" className="crm-connect-note">{notice}</p>}
    <div className="crm-connect-grid">{PROVIDERS.map(provider=>{
      const status=statuses[provider];const review=reviews[provider];
      return <article className="crm-connect-card" key={provider}>
        <div className="crm-connect-title"><h3>{NAMES[provider]}</h3><span className={status.connected?'crm-connect-active':'crm-connect-inactive'}>{loading?'Checking…':status.connected?'Connected':'Not connected'}</span></div>
        <p>Secure read-only access to contacts, with confirmation before adding them to INTRIGUE.</p>
        <div className="crm-connect-actions">{!status.connected?<button type="button" disabled={!!busy||loading} onClick={()=>void perform(provider,'start')}><Link2 size={15}/> Connect</button>:<><button disabled={!!busy} onClick={()=>void perform(provider,'preview')}><CloudDownload size={15}/> Preview contacts</button><button className="crm-connect-secondary" disabled={!!busy} onClick={()=>void perform(provider,'disconnect')}><Unplug size={15}/> Disconnect</button></>}</div>
        {status.lastImportAt&&<small>Last import: {new Date(status.lastImportAt).toLocaleString()} ({status.lastImportCount} new)</small>}
        {review&&<div className="crm-connect-review"><strong>{review.total} contacts checked</strong><p>{review.newRows} new · {review.duplicateRows} duplicates · {review.invalidRows} invalid</p><small>First 100 contacts per preview. Further pages will require a separate import batch.</small>
          <div className="crm-connect-contact-list">{review.contacts.slice(0,5).map((c,i)=><div key={i}><span>{c.full_name}</span><small>{c.email}</small></div>)}</div>
          {review.newRows>0&&review.invalidRows===0&&<label>Type <strong>IMPORT {review.newRows}</strong> to add new contacts
            <input value={confirmation[provider]||''} onChange={e=>setConfirmation(o=>({...o,[provider]:e.target.value}))} placeholder={`IMPORT ${review.newRows}`}/>
            <button disabled={!!busy||confirmation[provider]!==`IMPORT ${review.newRows}`} onClick={()=>void perform(provider,'import')}><CheckCircle2 size={15}/> Add reviewed contacts</button>
          </label>}</div>}
      </article>;
    })}</div>
    <p className="crm-connect-foot">Provider connections require application credentials set by your administrator. Imports never send messages, delete contacts or write back to the external CRM. Larger sync jobs and bidirectional updates are not enabled yet.</p>
  </section>;
}
