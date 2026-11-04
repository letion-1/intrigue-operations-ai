import { test } from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,suggestMapping,mapRows,IMPORT_LIMIT} from '../../lib/intrigue-v173-import.mjs';
test('reads ordinary contact CSV and maps aliases',()=>{
  const {headers,records}=parseCsv('Customer Name,Email Address,Phone\r\nNia Test,nia@example.invalid,+49123456\r\n');
  assert.deepEqual(headers,['Customer Name','Email Address','Phone']);
  assert.deepEqual(mapRows(records,suggestMapping(headers)),[{full_name:'Nia Test',email:'nia@example.invalid',phone:'+49123456',company_name:'',vehicle:''}]);
});
test('handles BOM, quoted commas and newlines, escaped quotes',()=>{
  const {records}=parseCsv('\uFEFFName,Email\n"Otieno, A.",o@example.invalid\n"Mae ""M""\nB",m@example.invalid');
  assert.equal(records[0].Name,'Otieno, A.');
  assert.equal(records[1].Name,'Mae "M"\nB');
});
test('rejects malformed quotes',()=>assert.throws(()=>parseCsv('Name,Email\n"Nia,b@example.invalid'),/Unclosed/));
test('rejects invalid quote tail',()=>assert.throws(()=>parseCsv('Name,Email\n"Nia"x,n@example.invalid'),/Unexpected/));
test('rejects rows with missing columns',()=>assert.throws(()=>parseCsv('Name,Email\nNia'),/columns/));
test('rejects duplicate case-insensitive headers',()=>assert.throws(()=>parseCsv('Email,email\na,b'),/unique/));
test('rejects header-only files',()=>assert.throws(()=>parseCsv('Name,Email\n'),/at least one/));
test('enforces max 200 records',()=>{
 const rows=Array.from({length:IMPORT_LIMIT+1},(_,i)=>`N${i},n${i}@example.invalid`).join('\n');
 assert.throws(()=>parseCsv('Name,Email\n'+rows),/200/);
});
test('rejects duplicate mapped fields',()=>{
 const {records}=parseCsv('Name,Email\nNia,nia@example.invalid');
 assert.throws(()=>mapRows(records,{full_name:'Name',email:'Name'}),/separate/);
});
test('does not infer missing email column',()=>{
 const {headers,records}=parseCsv('Name,Phone\nNia,+49123456');
 assert.equal(suggestMapping(headers).email,'');
 assert.throws(()=>mapRows(records,suggestMapping(headers)),/Map separate/);
});
test('rejects over 1 MB source',()=>assert.throws(()=>parseCsv('x'.repeat(1048577)),/1 MB/));
test('does not strip Unicode characters',()=>{
 const {records}=parseCsv('Name,Email\nMüller Åse,ase@example.invalid');
 assert.equal(records[0].Name,'Müller Åse');
});
