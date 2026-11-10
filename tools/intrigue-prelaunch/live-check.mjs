/** Non-destructive public deployment checks: never POST, never sends tokens. */
const input=process.argv[2] || 'https://intrigue-operations-ai-5ywh.vercel.app';
const base=new URL(input);
if (!['https:','http:'].includes(base.protocol)) throw Error('HTTP(S) URL required');
if(base.protocol!=='https:' && base.hostname!=='localhost') throw Error('Use HTTPS for deployed checks');
let failed=0;
async function probe(path, expected, label){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),10000);
  try{
    const res=await fetch(new URL(path,base),{method:'GET',cache:'no-store',redirect:'manual',signal:ctrl.signal});
    const okay=expected(res.status);
    console.log(`${okay?'PASS':'FAIL'} ${label}: HTTP ${res.status}`);
    if(!okay)failed++;
  }catch(err){console.log(`FAIL ${label}: ${err.name==='AbortError'?'timeout':'network error'}`);failed++;
  }finally{clearTimeout(timer);}
}
await probe('/api/health',s=>s===200,'Application liveness');
await probe('/api/platform/console',s=>s===401||s===403,'Admin API refuses anonymous access');
await probe('/api/help-center',s=>s===401||s===403,'Client support API refuses anonymous access');
await probe('/api/company/erasure',s=>s===401||s===403,'Erasure API refuses anonymous access');
if(failed) {console.error(`${failed} probe(s) failed. Do not mark prelaunch acceptance complete.`);process.exitCode=1;}
else console.log('Public unauthenticated-route checks passed. Authenticated RLS and worker tests still require live testing.');
