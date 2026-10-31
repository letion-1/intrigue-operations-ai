'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import './data-management.css';

type Operation = 'clear' | 'replace' | 'full_reset';
type Module = 'customers' | 'enquiries' | 'quotations' | 'follow_ups' | 'knowledge_entries' | 'workspace_services' | 'intrigue_receptionist_calls';
type Preview = { workspace: string; counts: Record<string, number>; warning: string };
type Prepared = { backup_id: string; counts: Record<string, number>; replacement_rows: number; workspace: string; message: string };

const modules: {value:Module; label:string; replace:boolean}[] = [
  {value:'customers',label:'Customers & CRM',replace:true},
  {value:'enquiries',label:'Customer enquiries',replace:false},
  {value:'quotations',label:'Quotations',replace:false},
  {value:'follow_ups',label:'Follow-ups',replace:false},
  {value:'knowledge_entries',label:'Knowledge entries',replace:true},
  {value:'workspace_services',label:'Service Catalog',replace:true},
  {value:'intrigue_receptionist_calls',label:'Receptionist call metadata',replace:false},
];

function csvRows(source:string):Record<string,string>[] {
  // Small RFC4180-compatible parser: quoted newlines and escaped quotes.
  const rows:string[][]=[]; let row:string[]=[];let field='';let quoted=false;
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(c==='"') {if(quoted && source[i+1]==='"'){field+='"';i++;} else quoted=!quoted;}
    else if(c===',' && !quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){
      if(c==='\r'&&source[i+1]==='\n')i++;
      row.push(field);if(row.some(s=>s.trim()))rows.push(row);row=[];field='';
    } else field+=c;
  }
  if(quoted)throw new Error('CSV has an unclosed quotation mark.');
  row.push(field);if(row.some(s=>s.trim()))rows.push(row);
  if(rows.length<2)return [];
  const headers=rows[0].map((h,i)=>i===0?h.replace(/^\uFEFF/,'').trim():h.trim());
  if(new Set(headers).size!==headers.length)throw new Error('CSV headers must be unique.');
  return rows.slice(1).map((cols)=>{
    if(cols.length!==headers.length)throw new Error('CSV row contains a different number of columns.');
    return Object.fromEntries(headers.map((h,i)=>[h,cols[i].trim()]));
  });
}

function downloadJson(name:string,data:unknown){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function DataManagementPanel({workspaceId,onCompleted}:{workspaceId:string;onCompleted:()=>void}){
  const db=useMemo(()=>createClient(),[]);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [operation,setOperation]=useState<Operation>('replace');
  const [module,setModule]=useState<Module>('knowledge_entries');
  const [data,setData]=useState<Record<string,unknown>[]>([]);
  const [filename,setFilename]=useState('');
  const [prepared,setPrepared]=useState<Prepared|null>(null);
  const [downloaded,setDownloaded]=useState(false);
  const [acknowledged,setAcknowledged]=useState(false);
  const [phrase,setPhrase]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [result,setResult]=useState('');
  const availableReplacement=modules.find(x=>x.value===module)?.replace??false;
  const effectiveModule=operation==='full_reset'?'full':module;
  const confirmation=`${operation==='full_reset'?'RESET':operation==='clear'?'CLEAR':'REPLACE'} ${preview?.workspace??''}`;
  const selectedCount=operation==='full_reset'
    ?Object.values(preview?.counts??{}).reduce((s,n)=>s+n,0)
    :(preview?.counts?.[module]??0);

  const loadPreview=useCallback(async()=>{
    const {data:response,error:e}=await db.rpc('intrigue_dm_preview',{p_workspace_id:workspaceId});
    if(e)throw new Error(e.message);
    setPreview(response as Preview);
  },[db,workspaceId]);
  useEffect(()=>{let live=true;void loadPreview().catch(e=>{if(live)setError(e instanceof Error?e.message:'Preview failed');});return()=>{live=false};},[loadPreview]);
  function resetPreparation(){setPrepared(null);setDownloaded(false);setAcknowledged(false);setPhrase('');setError('');setResult('');}
  async function readFile(ev:ChangeEvent<HTMLInputElement>){
    resetPreparation();const file=ev.currentTarget.files?.[0];if(!file)return;
    try{
      if(file.size>1024*1024)throw new Error('File exceeds the 1 MB limit.');
      const text=await file.text();
      const rows=file.name.toLowerCase().endsWith('.json')?JSON.parse(text):csvRows(text);
      if(!Array.isArray(rows)||rows.length>500||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))
        throw new Error('Upload a JSON array or CSV with no more than 500 records.');
      setFilename(file.name);setData(rows as Record<string,unknown>[]);
    }catch(e){setData([]);setFilename('');setError(e instanceof Error?e.message:'File invalid');}
  }
  async function prepare(){
    setBusy(true);resetPreparation();
    try{
      if(operation==='replace'&&!availableReplacement)throw new Error('Replacement is not available for this module.');
      if(operation==='replace'&&!filename)throw new Error('Select a replacement file first.');
      const {data:response,error:e}=await db.rpc('intrigue_dm_prepare',{
        p_workspace_id:workspaceId,p_mode:operation,p_module:effectiveModule,
        p_rows:operation==='replace'?data:[],
      });
      if(e)throw new Error(e.message);
      setPrepared(response as Prepared);
    }catch(e){setError(e instanceof Error?e.message:'Could not prepare snapshot');}
    finally{setBusy(false);}
  }
  async function saveBackup(){
    if(!prepared)return;setBusy(true);setError('');
    try{
      const {data:response,error:e}=await db.rpc('intrigue_dm_download',{p_backup_id:prepared.backup_id});
      if(e)throw new Error(e.message);
      downloadJson(`INTRIGUE-backup-${effectiveModule}-${new Date().toISOString().slice(0,10)}.json`,response);
      setDownloaded(true);
    }catch(e){setError(e instanceof Error?e.message:'Backup download failed');}
    finally{setBusy(false);}
  }
  async function execute(){
    if(!prepared||!downloaded||!acknowledged||phrase!==confirmation)return;
    setBusy(true);setError('');
    try{
      const {data:response,error:e}=await db.rpc('intrigue_dm_execute',{
        p_backup_id:prepared.backup_id,p_confirmation:phrase,
      });
      if(e)throw new Error(e.message);
      const result=response as {removed_rows:number;imported_rows:number};
      setResult(`Completed: removed ${result.removed_rows} rows; imported ${result.imported_rows} rows.`);
      setPrepared(null);setDownloaded(false);setAcknowledged(false);setPhrase('');
      await loadPreview();onCompleted();
    }catch(e){setError(e instanceof Error?e.message:'Operation failed. No data was changed.');}
    finally{setBusy(false);}
  }

  return <section className="intrigue-dm" aria-label="Workspace data management">
    <div className="dm-card">
      <h2>Workspace Data Management</h2>
      <p className="dm-subtitle">Owner-only tools for exporting, clearing, replacing and resetting supported business records. No action runs automatically.</p>
      <div className="dm-warning">This is not a Supabase project deletion. Workspace login, users, integration credentials, billing, external call recordings and uploaded storage objects are excluded. Backups contain personal information. Keep downloaded files secure. One-click restoration is not included in this version.</div>
      <div className="dm-counts">
        {modules.map(m=><div key={m.value} className="dm-stat"><span>{m.label}</span><strong>{preview?.counts?.[m.value]??'—'}</strong></div>)}
      </div>
      <button type="button" className="dm-secondary" disabled={busy} onClick={()=>{void loadPreview().catch(e=>setError(e.message));}}>Refresh counts</button>
    </div>
    <div className="dm-card">
      <h3>Choose an operation</h3>
      <div className="dm-options">
        <label><input type="radio" checked={operation==='replace'} onChange={()=>{setOperation('replace');resetPreparation();}}/> Replace a module</label>
        <label><input type="radio" checked={operation==='clear'} onChange={()=>{setOperation('clear');resetPreparation();}}/> Clear a module</label>
        <label><input type="radio" checked={operation==='full_reset'} onChange={()=>{setOperation('full_reset');resetPreparation();}}/> Full supported business-data reset</label>
      </div>
      {operation!=='full_reset' && <label className="dm-label">Module
        <select value={module} onChange={e=>{setModule(e.target.value as Module);resetPreparation();}}>
          {modules.map(m=><option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>}
      {operation==='replace' && <div className="dm-upload">
        {!availableReplacement ? <p>To protect related records, this module supports clearing but not replacement.</p> : <>
          <label className="dm-label">Replacement file (.csv or .json; up to 500 rows)
            <input type="file" accept=".csv,.json,text/csv,application/json" onChange={e=>{void readFile(e);}}/>
          </label>
          <p>{filename?`${filename} · ${data.length} rows loaded`:'CSV columns: customers = full_name,email,vehicle; knowledge = title,category,content; services = name,description,price,currency,is_active.'}</p>
        </>}
      </div>}
      <p className="dm-subtitle">Current affected rows: <strong>{selectedCount}</strong>. Related-record constraints may block a selected module. A full reset preserves the workspace account and integrations.</p>
      <button type="button" className="dm-primary" onClick={()=>{void prepare();}} disabled={busy||(operation==='replace'&&(!availableReplacement||!filename))}>{busy?'Working…':'1. Prepare backup and preview'}</button>
    </div>
    {prepared && <div className="dm-card dm-confirm">
      <h3>Review and confirm</h3>
      <p>Snapshot prepared for <strong>{prepared.workspace}</strong>. Rows in backup: {Object.entries(prepared.counts).map(([name,n])=>`${name}: ${n}`).join(' · ')}.</p>
      {operation==='replace'&&<p>New replacement rows: <strong>{prepared.replacement_rows}</strong></p>}
      <button type="button" className="dm-secondary" disabled={busy} onClick={()=>{void saveBackup();}}>2. Download JSON backup</button>
      <label className="dm-check"><input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)}/><span>I downloaded the backup, understand that this action removes data, and understand that recovery requires an administrator-assisted restore.</span></label>
      <label className="dm-label">3. Type exactly: <code>{confirmation}</code>
        <input type="text" spellCheck={false} autoComplete="off" value={phrase} onChange={e=>setPhrase(e.target.value)} placeholder={confirmation}/>
      </label>
      <button type="button" className="dm-danger" disabled={busy||!downloaded||!acknowledged||phrase!==confirmation} onClick={()=>{void execute();}}>4. Confirm {operation==='full_reset'?'workspace business-data reset':operation==='replace'?'module replacement':'module deletion'}</button>
      <p className="dm-note">The prepared snapshot expires for execution after 15 minutes or if records change. Database failures roll back the operation.</p>
    </div>}
    {error && <p className="dm-error" role="alert">{error}</p>}
    {result && <p className="dm-success" role="status">{result}</p>}
  </section>;
}
