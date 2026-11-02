/** INTRIGUE V16.6 - Approved proposal rendered exclusively from workspace-scoped server data.
 * Never accept document text, prices or a PDF from the browser for automatic delivery.
 */
import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { actor, adminClient, MailError, uuidPattern } from './common';

const MAX_GENERATED_BYTES = 1_500_000;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 46;
const NAVY = rgb(0.065, 0.145, 0.235);
const GOLD = rgb(0.70, 0.51, 0.24);
const GRAY = rgb(0.34, 0.40, 0.47);
const LIGHT = rgb(0.95, 0.93, 0.89);

type Quote = { id:string; customer_id:string; workspace_id:string; amount:number|string; currency:string; status:string };
type Proposal = {
  id:string; workspace_id:string; quotation_id:string; customer_id:string;
  heading:string; introduction:string; scope:string; payment_terms:string;
  validity_days:number; vat_mode:'inclusive'|'exclusive'|'unset'; vat_rate:number|string;
  subtotal:number|string; vat_amount:number|string; total_amount:number|string;
  brand_logo_data:string|null; updated_at:string;
};
type Line = { position:number; item_name:string; quantity:number; unit_price:number|string; line_total:number|string };
type Customer = { id:string; full_name:string; email:string|null };
type Workspace = { id:string; name:string };
type Approved = { state:string; approved_fingerprint:string; reviewed_at:string|null };
type EmailPreview = { recipient:string; subject:string; body:string };

function money(value: number|string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) throw new MailError('Invalid amount in saved proposal.', 409);
  return amount.toLocaleString('de-DE', { minimumFractionDigits:2, maximumFractionDigits:2 }) + ' EUR';
}
function exactText(value: unknown, max: number): string {
  const text = String(value ?? '').trim();
  if (text.length > max) throw new MailError('Proposal text exceeds a PDF rendering limit.', 409);
  return text;
}
function clean(value: string): string {
  // PDF StandardFonts are WinAnsi encoded. Never quietly replace a customer's name
  // with gibberish when a language requires an embedded Unicode font.
  const text = value.replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"')
    .replace(/[\u2013\u2014]/g,'-').replace(/\u2026/g,'...').replace(/\u00A0/g,' ')
    .replace(/\t/g,' ').replace(/\r/g,'');
  if ([...text].some(ch => !/^[\x0A\x20-\x7E\u00A1-\u00FF\u20AC\u2022]$/.test(ch))) {
    throw new MailError('This proposal contains characters the automatic PDF font cannot represent. Use the existing manual PDF workflow until multilingual fonts are enabled.',409);
  }
  return text;
}
function width(font: PDFFont, text: string, size: number) { return font.widthOfTextAtSize(text, size); }
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const all: string[] = [];
  for (const para of clean(text).split('\n')) {
    if (!para.trim()) { all.push(''); continue; }
    let line = '';
    for (const word of para.trim().split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (width(font, next, size) <= maxWidth) { line = next; continue; }
      if (line) { all.push(line); line = ''; }
      // Long URLs / unspaced tokens must not overflow the page.
      for (const character of word) {
        if (width(font, line + character, size) > maxWidth && line) { all.push(line); line = ''; }
        line += character;
      }
    }
    if (line) all.push(line);
  }
  return all;
}

async function drawPdf(input: {workspace:Workspace;customer:Customer;quote:Quote;proposal:Proposal;lines:Line[];approved:Approved}): Promise<Buffer> {
  const { workspace, customer, quote, proposal, lines, approved } = input;
  const doc = await PDFDocument.create({ updateMetadata:false });
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const safeName = clean(exactText(workspace.name, 200));
  doc.setTitle(clean(exactText(proposal.heading, 140)));
  doc.setAuthor(safeName);
  doc.setSubject('Approved proposal - not an invoice');
  // Fixed date from the approved revision: no wall-clock changes between preview and send.
  const fixedDate = new Date(approved.reviewed_at || proposal.updated_at);
  const docDate = Number.isNaN(fixedDate.getTime()) ? new Date('2020-01-01T00:00:00Z') : fixedDate;
  doc.setCreationDate(docDate); doc.setModificationDate(docDate);

  let page:PDFPage=doc.addPage([PAGE_W,PAGE_H]);
  let y=PAGE_H-MARGIN;
  let pageCount=1;
  const addPage = () => {
    page = doc.addPage([PAGE_W,PAGE_H]); pageCount++;
    y=PAGE_H-MARGIN;
    if (pageCount>1) {
      page.drawText(safeName, {x:MARGIN,y,size:11,font:bold,color:NAVY});
      page.drawText('PROPOSAL CONTINUED', {x:PAGE_W-MARGIN-125,y,size:8,font:bold,color:GOLD});
      y-=23;
      page.drawLine({start:{x:MARGIN,y},end:{x:PAGE_W-MARGIN,y},thickness:1,color:LIGHT}); y-=18;
    }
  };
  const ensure = (height:number) => { if (y-height < 65) addPage(); };
  const text = (value:string,opts:{size?:number;font?:PDFFont;color?:ReturnType<typeof rgb>;indent?:number;lineHeight?:number}={}) => {
    const font=opts.font||normal, size=opts.size||10, lineHeight=opts.lineHeight||size*1.46, x=MARGIN+(opts.indent||0);
    for (const line of wrap(value,font,size,PAGE_W-MARGIN-x)) {
      ensure(lineHeight);
      if(line) page.drawText(line,{x,y,size,font,color:opts.color||NAVY});
      y-=lineHeight;
    }
  };
  const title = (label:string) => {
    ensure(40); y-=13;
    page.drawText(label, {x:MARGIN,y,size:10,font:bold,color:GOLD}); y-=11;
    page.drawLine({start:{x:MARGIN,y},end:{x:PAGE_W-MARGIN,y},thickness:0.65,color:LIGHT}); y-=16;
  };
  const right = (label:string,size:number,yy:number) => {
    const safe=clean(label);
    page.drawText(safe,{x:PAGE_W-MARGIN-width(bold,safe,size),y:yy,size,font:bold,color:NAVY});
  };
  // Brand header. The logo is part of the approved proposal fingerprint.
  let headingX=MARGIN;
  if(proposal.brand_logo_data) {
    const logo=proposal.brand_logo_data;
    const match=logo.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
    if(!match || logo.length>180000) throw new MailError('Saved company logo is not a supported PNG/JPEG.',409);
    try {
      const raw=Buffer.from(match[2],'base64');
      const image=match[1]==='png' ? await doc.embedPng(raw) : await doc.embedJpg(raw);
      const fit=Math.min(54/image.width,54/image.height);
      page.drawImage(image,{x:MARGIN,y:y-54,width:image.width*fit,height:image.height*fit});
      headingX+=68;
    } catch { throw new MailError('The saved logo could not be embedded. Update or remove it, then reapprove the proposal.',409); }
  }
  const firstX=headingX;
  const companyLines=wrap(safeName,bold,17,PAGE_W-firstX-MARGIN);
  for(const line of companyLines.slice(0,2)) { page.drawText(line,{x:firstX,y:y-20,size:17,font:bold,color:NAVY});y-=22; }
  page.drawText('COMMERCIAL PROPOSAL | APPROVED, NOT YET SENT',{x:firstX,y:y-14,size:8,font:bold,color:GOLD});
  y=Math.min(y-43,PAGE_H-MARGIN-73);
  page.drawLine({start:{x:MARGIN,y},end:{x:PAGE_W-MARGIN,y},thickness:1.5,color:GOLD}); y-=33;

  text(exactText(proposal.heading,140),{size:18,font:bold,lineHeight:24}); y-=6;
  text(`Reference: QT-${quote.id.slice(0,8).toUpperCase()} | Valid for ${proposal.validity_days} days after issue`,{size:9,color:GRAY});y-=13;
  text(`Prepared for: ${exactText(customer.full_name,200)}`,{font:bold});
  if(customer.email) text(`Email: ${exactText(customer.email,254)}`,{size:9,color:GRAY});
  y-=8;
  title('INTRODUCTION'); text(exactText(proposal.introduction,2500));
  title('SCOPE AND DELIVERABLES'); text(exactText(proposal.scope,4000));
  title('PRODUCTS AND SERVICES');
  ensure(38);
  const col={item:MARGIN+8,qty:351,unit:398,total:493};
  const tableHead=()=>{
    ensure(45);
    page.drawRectangle({x:MARGIN,y:y-9,width:PAGE_W-2*MARGIN,height:28,color:LIGHT});
    page.drawText('Item / Service',{x:col.item,y:y,size:9,font:bold,color:NAVY});
    page.drawText('Qty',{x:col.qty,y:y,size:9,font:bold,color:NAVY});
    page.drawText('Unit',{x:col.unit,y:y,size:9,font:bold,color:NAVY});
    page.drawText('Total',{x:col.total,y:y,size:9,font:bold,color:NAVY});y-=32;
  };
  tableHead();
  for(const line of lines) {
    const itemLines=wrap(exactText(line.item_name,200),normal,9,col.qty-col.item-8);
    const rowHeight=Math.max(26,itemLines.length*13+10);
    if(y-rowHeight<68) {addPage(); tableHead();}
    const rowTop=y;
    for(const part of itemLines) { if(part)page.drawText(part,{x:col.item,y,size:9,font:normal,color:NAVY});y-=13; }
    page.drawText(String(line.quantity),{x:col.qty,y:rowTop,size:9,font:normal,color:NAVY});
    page.drawText(money(line.unit_price),{x:col.unit,y:rowTop,size:8,font:normal,color:NAVY});
    page.drawText(money(line.line_total),{x:col.total,y:rowTop,size:8,font:normal,color:NAVY});
    y=Math.min(rowTop-rowHeight,y-6);
    page.drawLine({start:{x:MARGIN,y},end:{x:PAGE_W-MARGIN,y},thickness:0.4,color:LIGHT}); y-=8;
  }
  ensure(103);y-=10;
  const sums=[['Catalog subtotal',money(proposal.subtotal)],
    [proposal.vat_mode==='inclusive' ? `VAT included (${proposal.vat_rate}%)`:`VAT added (${proposal.vat_rate}%)`,money(proposal.vat_amount)],
    ['Proposal total',money(proposal.total_amount)]];
  for(const [key,value] of sums) {
    ensure(21);
    page.drawText(clean(key),{x:335,y,size:10,font:key==='Proposal total'?bold:normal,color:NAVY});
    right(value,key==='Proposal total'?11:10,y); y-=22;
  }
  title('COMMERCIAL TERMS');
  text(exactText(proposal.payment_terms||'No additional payment terms supplied.',1400),{size:9});
  y-=12; text('This is a commercial proposal, not a tax invoice or proof of payment.',{size:8,color:GRAY});
  const pages=doc.getPages();
  for(let index=0;index<pages.length;index++) {
    const p=pages[index];
    p.drawLine({start:{x:MARGIN,y:48},end:{x:PAGE_W-MARGIN,y:48},thickness:0.7,color:LIGHT});
    p.drawText('Made by INTRIGUE Studios  |  Unsent approved proposal', {x:MARGIN,y:32,size:7,font:normal,color:GRAY});
    const pagination=`${index+1} / ${pages.length}`;
    p.drawText(pagination,{x:PAGE_W-MARGIN-width(normal,pagination,8),y:32,size:8,font:normal,color:GRAY});
  }
  const bytes=Buffer.from(await doc.save());
  if(bytes.length<200 || bytes.length>MAX_GENERATED_BYTES) throw new MailError('Generated PDF is too large for the Gmail integration (1.5 MB maximum).',413);
  return bytes;
}

export async function approvedPdf(request:NextRequest,workspaceId:string,quotationId:string) {
  if(!uuidPattern.test(workspaceId)||!uuidPattern.test(quotationId)) throw new MailError('Invalid workspace or quotation.',400);
  const {userClient}=await actor(request,workspaceId);
  // Critical: RPC checks current approved fingerprint, line prices and recipient.
  const {data:preview,error:previewError}=await userClient.rpc('intrigue_proposal_email_preview',{
    p_workspace_id:workspaceId,p_quotation_id:quotationId,
  });
  if(previewError || !preview || typeof preview!=='object') throw new MailError(previewError?.message||'Proposal is not approved or has changed.',409);
  const pv=preview as EmailPreview;
  if(!pv.recipient||!pv.subject||!pv.body) throw new MailError('Approved email preview is incomplete.',409);
  const db=adminClient();
  const [quote,proposal,approval,workspace]=await Promise.all([
    db.from('quotations').select('id,customer_id,workspace_id,amount,currency,status').eq('id',quotationId).eq('workspace_id',workspaceId).maybeSingle(),
    db.from('intrigue_proposal_documents').select('id,workspace_id,quotation_id,customer_id,heading,introduction,scope,payment_terms,validity_days,vat_mode,vat_rate,subtotal,vat_amount,total_amount,brand_logo_data,updated_at').eq('quotation_id',quotationId).eq('workspace_id',workspaceId).maybeSingle(),
    db.from('intrigue_proposal_approvals').select('state,approved_fingerprint,reviewed_at').eq('quotation_id',quotationId).eq('workspace_id',workspaceId).maybeSingle(),
    db.from('workspaces').select('id,name').eq('id',workspaceId).maybeSingle(),
  ]);
  if(quote.error||proposal.error||approval.error||workspace.error||!quote.data||!proposal.data||!approval.data||!workspace.data) throw new MailError('Approved proposal cannot be loaded for this workspace.',409);
  const q=quote.data as Quote, p=proposal.data as Proposal, a=approval.data as Approved, w=workspace.data as Workspace;
  if(a.state!=='approved'||q.status!=='draft'||p.customer_id!==q.customer_id||p.vat_mode==='unset') throw new MailError('Proposal approval is stale or incomplete.',409);
  const [customer,items]=await Promise.all([
    db.from('customers').select('id,full_name,email').eq('id',q.customer_id).eq('workspace_id',workspaceId).maybeSingle(),
    db.from('quotation_line_items').select('position,item_name,quantity,unit_price,line_total').eq('quotation_id',quotationId).eq('workspace_id',workspaceId).order('position',{ascending:true}),
  ]);
  if(customer.error||items.error||!customer.data||!items.data?.length) throw new MailError('Customer or approved quotation items could not be loaded.',409);
  const c=customer.data as Customer, lines=items.data as Line[];
  if(c.email?.trim().toLowerCase()!==pv.recipient.trim().toLowerCase()) throw new MailError('Recipient changed since approval.',409);
  // Recheck after reading every table: a concurrent revision must not create an
  // apparently approved preview if the approval fingerprint was invalidated mid-read.
  const {data:secondPreview,error:secondError}=await userClient.rpc('intrigue_proposal_email_preview',{
    p_workspace_id:workspaceId,p_quotation_id:quotationId,
  });
  if(secondError || !secondPreview || secondPreview.recipient!==pv.recipient ||
     secondPreview.subject!==pv.subject || secondPreview.body!==pv.body) {
    throw new MailError('Proposal changed while generating the PDF. Reopen the approved proposal and retry.',409);
  }
  // Hash source information, not PDF metadata, so the user sees exactly the revision they send.
  const snapshotHash=createHash('sha256').update(JSON.stringify({workspace:w,quote:q,proposal:p,approval:a,customer:c,lines,
    approvedEmail:{recipient:pv.recipient,subject:pv.subject,body:pv.body}})).digest('hex');
  const pdf=await drawPdf({workspace:w,customer:c,quote:q,proposal:p,lines,approved:a});
  return {pdf,snapshotHash,pdfSha256:createHash('sha256').update(pdf).digest('hex'),preview:pv};
}
