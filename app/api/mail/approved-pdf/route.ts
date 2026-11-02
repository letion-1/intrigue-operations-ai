import { NextRequest, NextResponse } from 'next/server';
import { approvedPdf } from '../_lib/approved-pdf';
import { jsonBody, mailError, MailError, uuidPattern } from '../_lib/common';

// Authenticated, workspace-scoped preview. No PDFs or personal data are stored publicly.
export async function POST(request: NextRequest) {
  try {
    const input=await jsonBody(request);
    const workspaceId=String(input.workspaceId||'');
    const quotationId=String(input.quotationId||'');
    if(!uuidPattern.test(workspaceId)||!uuidPattern.test(quotationId)) throw new MailError('Invalid workspace or quotation.',400);
    const result=await approvedPdf(request,workspaceId,quotationId);
    return new NextResponse(Uint8Array.from(result.pdf).buffer as ArrayBuffer,{
      status:200,
      headers:{
        'Content-Type':'application/pdf',
        'Content-Disposition':`inline; filename="INTRIGUE-Proposal-${quotationId.slice(0,8)}.pdf"`,
        'Cache-Control':'private, no-store, max-age=0',
        'X-Content-Type-Options':'nosniff',
        'X-Intrigue-Snapshot-SHA256':result.snapshotHash,
        'X-Intrigue-PDF-SHA256':result.pdfSha256,
      }
    });
  } catch(e) { return mailError(e); }
}
