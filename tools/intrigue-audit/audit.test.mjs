import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {findRouteMethods,classifyRoute,analyzeProject,reportMarkdown,listSources} from './audit.mjs';
import {classify} from './staging-rls.mjs';

test('methods and auth candidate detection',()=>{
  const content='export async function POST(request: Request) { return NextResponse.json({ok:true}); }';
  assert.deepEqual(findRouteMethods(content),['POST']);
  assert.equal(classifyRoute(content).needsManualReview,true);
  assert.equal(classifyRoute(content+' await supabase.auth.getUser(); const workspace_id = x;').needsManualReview,false);
});
test('read only scan does not inspect env, node_modules or symlinks',()=>{
  const root=mkdtempSync(join(tmpdir(),'intrigue-v17-test-'));
  try {
    mkdirSync(join(root,'app','api','demo'),{recursive:true});mkdirSync(join(root,'node_modules'));
    writeFileSync(join(root,'package.json'),JSON.stringify({dependencies:{next:'latest'},scripts:{build:'next build'}}));
    writeFileSync(join(root,'app','api','demo','route.ts'),'export async function POST(){}');
    writeFileSync(join(root,'node_modules','secret.ts'),'secret');
    writeFileSync(join(root,'.env.local'),'SUPERSECRET');
    const paths=listSources(root).join(' ');
    assert.ok(!paths.includes('node_modules'));
    assert.ok(!paths.includes('.env'));
    const result=analyzeProject(root);
    assert.equal(result.routes.length,1);
    assert.ok(result.findings.some(x=>x.id==='ROUTE_AUTH_REVIEW'));
    assert.ok(result.findings.some(x=>x.id==='DEPENDENCY_LATEST'));
    assert.ok(!reportMarkdown(result).includes('SUPERSECRET'));
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('staging cross tenant status classification is fail closed',()=>{
  assert.equal(classify({count:1,error:null}),'DATA_LEAK');
  assert.equal(classify({count:0,error:null}),'ZERO_ROWS');
  assert.equal(classify({count:null,error:{code:'42501',message:'permission denied'}}),'DENIED');
  assert.equal(classify({count:null,error:{code:'PGRST205',message:'not found'}}),'REVIEW_SCHEMA');
  assert.equal(classify({count:null,error:{code:'500',message:'unknown'}}),'REVIEW_ERROR');
});
