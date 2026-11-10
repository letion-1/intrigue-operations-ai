/**
 * Rebuild application icons from the user's own image; never invents a mark.
 * Usage: node tools/intrigue-prelaunch/prepare-brand.mjs --apply [path/to/transparent-logo.png]
 * Requires sharp (included by most Next.js installs). Without --apply only previews the output paths.
 * The sidebar PNG itself is NOT overwritten, only derived browser icons.
 */
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
const cwd=process.cwd();
const apply=process.argv.includes('--apply');
const source=resolve(cwd,process.argv.filter(x=>!x.startsWith('--')&&x!==process.argv[0]&&x!==process.argv[1])[0]||'public/intrigue-mark.png');
if(!existsSync(source)) throw Error(`Brand image missing: ${source}`);
if(!apply){console.log(`Source: ${source}\nWould generate: app/icon.png, app/apple-icon.png, app/favicon.ico\nAdd --apply to write icons.\nThe mark is centered with 18% padding.`);process.exit(0);}
let sharp;
try{sharp=(await import('sharp')).default;}catch{throw Error('Install sharp in this project to generate icons. No assets have been changed.');}
const dir=join(tmpdir(),`intrigue-icon-backup-${Date.now()}`);mkdirSync(dir,{recursive:true});
for(const name of ['icon.png','apple-icon.png','favicon.ico']) {const p=resolve(cwd,'app',name);if(existsSync(p)) copyFileSync(p,join(dir,name));}
async function png(size){
  const target=Math.round(size*.64);
  const bytes=await sharp(source).resize(target,target,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
  return sharp({create:{width:size,height:size,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
    .composite([{input:bytes,gravity:'centre'}]).png().toBuffer();
}
function ico(chunks) {
  // ICO frames can contain PNG payloads. Windows and modern browsers support it.
  const header=Buffer.alloc(6+16*chunks.length);
  header.writeUInt16LE(0,0);header.writeUInt16LE(1,2);header.writeUInt16LE(chunks.length,4);
  let offset=header.length;
  chunks.forEach(({size,data},i)=>{
    const at=6+i*16;
    header[at]=size===256?0:size;header[at+1]=size===256?0:size;
    header[at+2]=0;header[at+3]=0;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);
    header.writeUInt32LE(data.length,at+8);header.writeUInt32LE(offset,at+12);
    offset+=data.length;
  });
  return Buffer.concat([header,...chunks.map(c=>c.data)]);
}
const images=await Promise.all([png(512),png(180),png(16),png(32),png(48)]);
writeFileSync(resolve(cwd,'app/icon.png'),images[0]);
writeFileSync(resolve(cwd,'app/apple-icon.png'),images[1]);
writeFileSync(resolve(cwd,'app/favicon.ico'),ico([{size:16,data:images[2]},{size:32,data:images[3]},{size:48,data:images[4]}]));
console.log(`Icons generated from your source image, with padding. Existing icon backups: ${dir}`);
