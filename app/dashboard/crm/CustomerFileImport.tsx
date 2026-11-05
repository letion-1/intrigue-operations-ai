'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { HEADER_FIELDS, parseCsv, suggestMapping, mapRows } from '@/lib/intrigue-v173-import.mjs';
import './customer-file-import.css';

type ImportResult = {
  preview: boolean; total_rows: number; new_rows: number;
  duplicate_rows: number; invalid_rows: number;
  details: { row: number; status: string }[];
  message: string;
};

const LABELS: Record<string,string> = {
  full_name: 'Full name *', email: 'Email *', phone: 'Phone (optional)',
  company_name: 'Company / organization (optional)',
};

export default function CustomerFileImport({ workspaceId, companyName, onImported, onClose }: {
  workspaceId: string; companyName: string;
  onImported: () => Promise<unknown> | void; onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [source, setSource] = useState<{ headers:string[]; records:Record<string,string>[] } | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Record<string,string>>({});
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    setSource(null); setFileName(''); setMapping({}); setPreview(null);
    setConfirmText(''); setMessage(''); setError(''); setComplete(false);
  }, [workspaceId]);

  function clearReview() { setPreview(null); setConfirmText(''); setMessage(''); setComplete(false); }
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setSource(null); setFileName(''); setMapping({}); clearReview(); setError('');
    if (!file) return;
    try {
      const isExcel = file.name.toLowerCase().endsWith('.xlsx');
      if (!isExcel && !file.name.toLowerCase().endsWith('.csv')) throw new Error('Upload a CSV or XLSX file.');
      if (file.size > 2_097_152) throw new Error('Maximum file size is 2 MB.');
      let parsed: { headers:string[]; records:Record<string,string>[] };
      if (isExcel) {
        // Imported only for Excel uploads, keeping the normal CRM page lightweight.
        const { readSheet } = await import('read-excel-file/browser');
        const sheet = await readSheet(file);
        if (sheet.length < 2 || sheet.length > 201) throw new Error('Upload a workbook with 1 to 200 contacts on the first sheet.');
        const headings = sheet[0].map(cell => String(cell ?? '').trim());
        if (headings.length > 40 || !headings.some(Boolean) || new Set(headings.map(x=>x.toLowerCase())).size !== headings.length) throw new Error('Workbook headers are missing, duplicated or too wide.');
        const records = sheet.slice(1).filter(row => row.some(cell => cell !== null && cell !== '')).map(row => {
          const entry:Record<string,string> = {};
          headings.forEach((heading,index)=>{entry[heading] = row[index] instanceof Date ? row[index].toISOString().slice(0,10) : String(row[index] ?? '');});
          return entry;
        });
        parsed = {headers:headings,records};
      } else parsed = parseCsv(await file.text());
      setFileName(file.name); setSource(parsed); setMapping(suggestMapping(parsed.headers));
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to read CSV file.'); }
  }
  function rows() { return mapRows(source?.records ?? [], mapping); }
  async function execute(apply: boolean) {
    if (!source || !workspaceId || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const payload = rows();
      if (apply && (!preview || complete || preview.invalid_rows !== 0 || preview.new_rows < 1 || confirmText !== `IMPORT ${preview.new_rows}`))
        throw new Error('Review the preview and type the confirmation first.');
      const { data, error: rpcError } = await supabase.rpc('intrigue_v173_import_customers', {
        p_workspace_id: workspaceId, p_rows: payload, p_apply: apply,
      });
      if (rpcError) throw new Error(rpcError.message);
      const result = data as ImportResult;
      if (!result || !Number.isInteger(result.total_rows)) throw new Error('Invalid Supabase import response.');
      if (apply) {
        setComplete(true); setPreview(null); setMessage(`${result.new_rows} new contacts imported; ${result.duplicate_rows} duplicates skipped. Existing records were not changed.`);
        try { await onImported(); } catch { setMessage(`${result.new_rows} contacts imported, but the list could not refresh. Reload Customers & CRM to see them.`); }
      } else { setPreview(result); setConfirmText(''); }
    } catch (err) { setError(err instanceof Error ? err.message : 'Import failed.'); }
    finally { setBusy(false); }
  }
  return <section className="v173-import" aria-label="Import customer contacts">
    <header className="v173-import-head">
      <div><h3>Import contacts into {companyName}</h3>
        <p>Owner/Admin only · Preview before importing · Up to 200 contacts · No customer notifications</p></div>
      <button type="button" onClick={onClose} className="crm-secondary">Close</button>
    </header>
    <p className="v173-import-tip">Upload CSV or Excel contacts here, or authorize a live CRM connection from Integrations. Only name and email are required. Phone and company / organization are optional. Industry-specific details can be managed in the appropriate company modules.</p>
    <label className="v173-import-upload">1. Choose contacts file (.csv or .xlsx, max 2 MB)
      <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => { void readFile(event); }} disabled={busy} />
    </label>
    {source && <>
      <p className="v173-import-meta">{fileName} · {source.records.length} records · {source.headers.length} columns</p>
      <div className="v173-import-map" aria-label="Column mapping">
        {HEADER_FIELDS.map(field => <label key={field}>{LABELS[field]}
          <select value={mapping[field] || ''} disabled={busy} onChange={event => { setMapping(old => ({...old,[field]:event.target.value})); clearReview(); }}>
            <option value="">Don't import this field</option>
            {source.headers.map(header => <option key={header} value={header}>{header}</option>)}
          </select>
        </label>)}
      </div>
      <button className="crm-secondary" type="button" disabled={busy} onClick={() => { void execute(false); }}>{busy ? 'Checking…' : '2. Preview against Supabase'}</button>
    </>}
    {preview && <div className="v173-import-result">
      <h4>3. Review the import</h4>
      <p><strong>{preview.new_rows}</strong> new · <strong>{preview.duplicate_rows}</strong> duplicates skipped · <strong>{preview.invalid_rows}</strong> invalid</p>
      <p className="v173-import-muted">Preview only. No contacts have been saved. Duplicate matching uses email within this company. Existing contact fields will never be overwritten.</p>
      <ul>{(preview.details || []).slice(0, 12).map(item => <li key={item.row}>File row {item.row}: {item.status.replaceAll('_',' ')}</li>)}</ul>
      {preview.invalid_rows > 0 ? <p className="v173-import-error">Fix invalid rows in the CSV and upload it again before importing.</p>
        : preview.new_rows === 0 ? <p>No new contacts to import.</p>
        : <>
          <label>Type <strong>IMPORT {preview.new_rows}</strong> to approve adding contacts to {companyName}
            <input value={confirmText} disabled={busy} spellCheck={false} autoComplete="off" onChange={event => setConfirmText(event.target.value)} placeholder={`IMPORT ${preview.new_rows}`} />
          </label>
          <button type="button" className="crm-primary" disabled={busy || confirmText !== `IMPORT ${preview.new_rows}`} onClick={() => { void execute(true); }}>{busy ? 'Saving…' : `4. Add ${preview.new_rows} contacts`}</button>
        </>}
    </div>}
    {error && <p className="v173-import-error" role="alert">{error}</p>}
    {message && <p className="v173-import-success" role="status">{message}</p>}
    <p className="v173-import-muted">No deletion, replacement, email sending, or external CRM synchronization. Import results are rechecked server-side at commit time.</p>
  </section>;
}
