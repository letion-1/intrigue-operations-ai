"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Scheduler = "none" | "cal" | "calendly";
type MailProvider = "none" | "gmail" | "outlook";
type Source = "csv" | "hubspot" | "zoho" | "salesforce" | "pipedrive" | "other";
type Field = "full_name" | "email" | "phone" | "company_name" | "vehicle" | "external_id";
type Row = Record<Field, string>;

type Preferences = {
  scheduling_provider: Scheduler;
  booking_url: string;
  vapi_assistant_id: string;
  preferred_email_provider: MailProvider;
};
const EMPTY: Preferences = {
  scheduling_provider: "none", booking_url: "", vapi_assistant_id: "", preferred_email_provider: "none",
};
const FIELDS: { key: Field; title: string; aliases: string[] }[] = [
  { key:"full_name", title:"Full name", aliases:["full name","name","contact name","display name","fullname"] },
  { key:"email", title:"Email", aliases:["email","email address","e mail","primary email","contact email"] },
  { key:"phone", title:"Phone", aliases:["phone","mobile","phone number","telephone","mobile phone"] },
  { key:"company_name", title:"Company", aliases:["company","company name","organization","account name","organisation"] },
  { key:"vehicle", title:"Vehicle / notes", aliases:["vehicle","car","vehicle model"] },
  { key:"external_id", title:"CRM record ID", aliases:["record id","contact id","contactid","external id","id","crm id"] },
];
const box = "rounded-2xl border border-[#35485d] bg-[#142539] p-5 md:p-6";
const field = "w-full rounded-xl border border-[#41556b] bg-[#0d1e30] px-3 py-2.5 text-sm text-[#f4efe5] focus:border-[#d5b362] outline-none";
const btn = "rounded-lg bg-[#c9a552] px-4 py-2.5 text-sm font-semibold text-[#132134] disabled:opacity-45";

// Supports quoted fields, escaped quotes, CRLF, embedded newlines and UTF-8 BOM.
function parseDelimited(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/,1)[0] ?? "";
  const comma = (first.match(/,/g) ?? []).length;
  const semi = (first.match(/;/g) ?? []).length;
  const tabs = (first.match(/\t/g) ?? []).length;
  const separator = tabs > comma && tabs > semi ? "\t" : semi > comma ? ";" : ",";
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted && text[i+1]==='"'){cell+='"';i++;}
      else quoted=!quoted;
    } else if(c===separator && !quoted){row.push(cell);cell="";}
    else if((c==='\n'||c==='\r')&&!quoted){
      if(c==='\r' && text[i+1]==='\n')i++;
      row.push(cell); if(row.some(x=>x.trim())) rows.push(row);
      row=[];cell="";
    } else cell+=c;
  }
  if(quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
  return rows;
}
const normalized = (s:string)=>s.toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
function bookingUrlOk(provider:Scheduler,url:string):boolean{
  if(provider==="none")return !url.trim();
  try {
    const u=new URL(url);
    if(u.protocol!=="https:"||u.username||u.password||u.port)return false;
    if(provider==="cal")return (u.hostname==="cal.com"||u.hostname.endsWith(".cal.com"))&&u.pathname.length>1;
    return (u.hostname==="calendly.com"||u.hostname.endsWith(".calendly.com"))&&u.pathname.length>1;
  }catch{return false;}
}

export default function IntegrationsPanel({workspaceId,onImported}:{workspaceId:string;onImported:()=>void}){
  const supabase=useMemo(()=>createClient(),[]);
  const [pref,setPref]=useState<Preferences>(EMPTY);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [status,setStatus]=useState("");
  const [error,setError]=useState("");
  const [raw,setRaw]=useState<string[][]>([]);
  const [headers,setHeaders]=useState<string[]>([]);
  const [map,setMap]=useState<Record<Field,number>>({full_name:-1,email:-1,phone:-1,company_name:-1,vehicle:-1,external_id:-1});
  const [source,setSource]=useState<Source>("csv");
  const [fileName,setFileName]=useState("");
  const [importing,setImporting]=useState(false);
  const [importMessage,setImportMessage]=useState("");

  const load=useCallback(async()=>{
    setLoading(true);
    const {data,error:e}=await supabase.from("workspace_integration_preferences")
      .select("scheduling_provider,booking_url,vapi_assistant_id,preferred_email_provider")
      .eq("workspace_id",workspaceId).maybeSingle();
    if(e)setError(e.message);
    else setPref(data ? data as Preferences : EMPTY);
    setLoading(false);
  },[supabase,workspaceId]);
  useEffect(()=>{void load();},[load]);

  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setStatus("");setError("");
    const url=pref.scheduling_provider==="none"?"":pref.booking_url.trim();
    if(!bookingUrlOk(pref.scheduling_provider,url)){
      setError("Enter a full HTTPS booking URL on cal.com or calendly.com for the selected provider.");return;
    }
    setSaving(true);
    const {error:e}=await supabase.from("workspace_integration_preferences").upsert({
      workspace_id:workspaceId,scheduling_provider:pref.scheduling_provider,
      booking_url:url,vapi_assistant_id:pref.vapi_assistant_id.trim(),
      preferred_email_provider:pref.preferred_email_provider,updated_at:new Date().toISOString(),
    },{onConflict:"workspace_id"});
    if(e)setError(e.message);
    else setStatus("Preferences saved for this company. Booking link is available; Vapi and email still require provider authorization.");
    setSaving(false);
  }

  async function chooseFile(file:File|undefined){
    setImportMessage("");setError("");setRaw([]);setHeaders([]);setFileName("");
    if(!file)return;
    if(file.size>512000){setError("Use a CSV file smaller than 500 KB for this staging importer.");return;}
    if(!/\.(csv|tsv|txt)$/i.test(file.name)){setError("Export contacts as a CSV or TSV file first.");return;}
    try{
      const lines=parseDelimited(await file.text());
      if(lines.length<2)throw new Error("No contact rows found in this file.");
      if(lines.length>501)throw new Error("V15.3 supports at most 500 rows per CSV file.");
      const cols=lines[0].map(s=>s.trim());
      if(cols.length>50)throw new Error("Too many CSV columns (max 50).");
      const mapping={} as Record<Field,number>;
      for(const f of FIELDS){mapping[f.key]=cols.findIndex(c=>f.aliases.includes(normalized(c)));}
      setHeaders(cols);setRaw(lines.slice(1));setMap(mapping);setFileName(file.name);
    }catch(e){setError(e instanceof Error?e.message:"Could not parse this file.");}
  }
  const mapped=useMemo<Row[]>(()=>raw.map(cols=>{
    const result={} as Row;
    for(const f of FIELDS){const idx=map[f.key];result[f.key]=(idx>=0?cols[idx]??"":"").trim();}
    if(!result.full_name && headers.some(h=>normalized(h)==="first name")){
      const fi=headers.findIndex(h=>normalized(h)==="first name");
      const li=headers.findIndex(h=>normalized(h)==="last name");
      result.full_name=[cols[fi],li>=0?cols[li]:""].filter(Boolean).join(" ").trim();
    }
    return result;
  }),[raw,headers,map]);
  const accepted=mapped.filter(r=>r.full_name.length>=2&&(r.email||r.external_id));
  async function importContacts(){
    if(!accepted.length){setError("Map a full name and an email or CRM record ID first.");return;}
    if(accepted.length>500){setError("Maximum 500 contacts per import.");return;}
    setImporting(true);setImportMessage("");setError("");
    let inserted=0,matched=0,skipped=0;
    try{
      for(let i=0;i<accepted.length;i+=50){
        const batch=accepted.slice(i,i+50);
        const {data,error:e}=await supabase.rpc("import_intrigue_crm_contacts",{
          p_workspace_id:workspaceId,p_source:source,p_contacts:batch,
        });
        if(e)throw new Error(`Batch ${Math.floor(i/50)+1}: ${e.message}`);
        inserted+=Number(data?.inserted??0);
        matched+=Number(data?.matched_existing??0);
        skipped+=Number(data?.skipped??0);
        setImportMessage(`Imported ${Math.min(i+50,accepted.length)} of ${accepted.length} eligible rows...`);
      }
      setImportMessage(`Import complete: ${inserted} new customers, ${matched} matched existing, ${skipped} skipped by server. ${raw.length-accepted.length} unmapped or incomplete rows were excluded.`);
      onImported();
    }catch(e){setError(e instanceof Error?e.message:"Import failed. Earlier batches may already have saved; re-importing the same file is deduplicated by email or external ID.");}
    setImporting(false);
  }

  return <div className="space-y-5">
    <div className={box}>
      <h2 className="text-lg font-semibold text-[#f4efe5]">Connect your business tools</h2>
      <p className="mt-2 text-sm leading-6 text-[#b8c7d4]">Each company keeps its own integration preferences. Saving a provider name does not grant INTRIGUE access to your provider account. No outbound calls or emails are sent by this screen.</p>
      {loading?<p className="mt-4 text-sm text-[#a9b9ca]">Loading company integrations...</p>:
      <form onSubmit={save} className="mt-5 grid gap-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="text-xs font-semibold text-[#e7c37c]" htmlFor="v153-scheduler">Meeting scheduler</label>
            <select id="v153-scheduler" className={field+" mt-1"} value={pref.scheduling_provider} onChange={e=>setPref(p=>({...p,scheduling_provider:e.target.value as Scheduler,booking_url:""}))}>
              <option value="none">Not configured</option><option value="cal">Cal.com</option><option value="calendly">Calendly</option>
            </select></div>
          <div><label className="text-xs font-semibold text-[#e7c37c]" htmlFor="v153-booking">Booking page URL</label>
            <input id="v153-booking" className={field+" mt-1"} value={pref.booking_url} onChange={e=>setPref(p=>({...p,booking_url:e.target.value}))} placeholder="https://cal.com/your-team/meeting" maxLength={400}/></div>
          <div><label className="text-xs font-semibold text-[#e7c37c]" htmlFor="v153-vapi">Vapi assistant ID</label>
            <input id="v153-vapi" className={field+" mt-1"} value={pref.vapi_assistant_id} onChange={e=>setPref(p=>({...p,vapi_assistant_id:e.target.value}))} placeholder="Vapi assistant identifier (optional)" maxLength={100}/>
            <p className="mt-1 text-xs text-[#96a9ba]">Reference only, not a live voice connection. Never paste a Vapi API key here.</p></div>
          <div><label className="text-xs font-semibold text-[#e7c37c]" htmlFor="v153-mail">Preferred email connection</label>
            <select id="v153-mail" className={field+" mt-1"} value={pref.preferred_email_provider} onChange={e=>setPref(p=>({...p,preferred_email_provider:e.target.value as MailProvider}))}>
              <option value="none">Not selected</option><option value="gmail">Gmail (OAuth not connected)</option><option value="outlook">Microsoft Outlook (OAuth not connected)</option>
            </select></div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={btn} disabled={saving}>{saving?"Saving...":"Save integration preferences"}</button>
          {pref.scheduling_provider!=="none" && bookingUrlOk(pref.scheduling_provider,pref.booking_url) &&
            <a href={pref.booking_url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-[#bea16e] px-4 py-2.5 text-sm text-[#e8ca86]">Open booking page ↗</a>}
        </div>
      </form>}
      {status&&<p role="status" className="mt-3 text-xs text-[#a9e8cc]">{status}</p>}
      {error&&<p role="alert" className="mt-3 text-xs text-[#ffc1b8]">{error}</p>}
    </div>
    <div className="grid gap-3 md:grid-cols-3">
      {[
        {title:"Scheduling",desc:"Booking-page link is available when saved. API availability and meeting sync need OAuth + webhooks."},
        {title:"AI receptionist",desc:"Vapi assistant ID can be saved. Call handling, appointment tools and webhooks are not connected yet."},
        {title:"Email",desc:"Gmail/Outlook preference only. OAuth and send approval are still required; no email is sent."},
      ].map(item=><div className={box} key={item.title}><h3 className="font-semibold text-[#efd5a1]">{item.title}</h3><p className="mt-2 text-xs leading-5 text-[#b8c7d4]">{item.desc}</p></div>)}
    </div>
    <div className={box}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-[#f4efe5]">Import contacts from your CRM</h2><span className="rounded-full bg-[#203f3b] px-3 py-1 text-xs text-[#b5edce]">CSV import · owner only</span></div>
      <p className="mt-2 text-sm text-[#b8c7d4]">Export a CSV from Zoho, HubSpot, Salesforce, Pipedrive or another CRM. Match the columns and preview the records before importing. Existing contacts are matched by CRM record ID or email <strong>within this company only</strong>. No emails or calls are triggered.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div><label className="text-xs font-semibold text-[#e7c37c]">CSV source</label>
          <select className={field+" mt-1"} value={source} onChange={e=>setSource(e.target.value as Source)}>
            {["csv","hubspot","zoho","salesforce","pipedrive","other"].map(s=><option value={s} key={s}>{s==="csv"?"Generic CSV":s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
          </select></div>
        <div><label className="text-xs font-semibold text-[#e7c37c]">Contact export file · CSV/TSV, max 500 KB and 500 rows</label>
          <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" className={field+" mt-1"} onChange={e=>void chooseFile(e.target.files?.[0])}/></div>
      </div>
      {raw.length>0&&<div className="mt-5 space-y-4">
        <p className="text-xs text-[#b5c4d3]">{fileName}: {raw.length} rows. Map at least Full name and Email or CRM record ID.</p>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">{FIELDS.map(f=><div key={f.key}>
          <label className="text-xs text-[#edd09a]">{f.title}</label>
          <select className={field+" mt-1"} value={map[f.key]} onChange={e=>setMap(old=>({...old,[f.key]:Number(e.target.value)}))}>
            <option value={-1}>Not in file</option>{headers.map((h,i)=><option key={i} value={i}>{h||`Column ${i+1}`}</option>)}
          </select></div>)}</div>
        <div className="overflow-x-auto rounded-xl border border-[#38495e]">
          <table className="w-full min-w-[520px] text-left text-xs text-[#dbe4ec]"><thead className="bg-[#23394d]"><tr>{["Name","Email","Phone","Company","External ID"].map(h=><th className="p-3" key={h}>{h}</th>)}</tr></thead>
            <tbody>{mapped.slice(0,5).map((r,i)=><tr key={i} className="border-t border-[#35485d]"><td className="p-3">{r.full_name}</td><td className="p-3">{r.email}</td><td className="p-3">{r.phone}</td><td className="p-3">{r.company_name}</td><td className="p-3">{r.external_id}</td></tr>)}</tbody></table>
        </div>
        <p className="text-xs text-[#bacbd8]">{accepted.length} eligible contacts. Start with fictional test contacts; real personal data requires your privacy, retention and processor checks first.</p>
        <button type="button" className={btn} disabled={importing || accepted.length===0} onClick={()=>void importContacts()}>{importing?"Importing...":`Import ${accepted.length} contacts`}</button>
      </div>}
      {importMessage&&<p role="status" className="mt-3 text-xs text-[#b4edd1]">{importMessage}</p>}
    </div>
  </div>;
}
