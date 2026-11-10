#!/usr/bin/env node
'use strict';
/**
 * Repairs only a favicon ICO whose embedded PNG frames are not RGBA.
 * Reads current app/icon.png so the user's chosen mark is preserved.
 * Called by the guarded runtime installer, which backs up/restores the old ICO.
 */
const fs = require('node:fs');
const path = require('node:path');
const src = path.resolve('app/icon.png');
const target = path.resolve('app/favicon.ico');
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
function pngIsRgba(frame) {
  return frame.length >= 26 && frame.subarray(0,8).equals(pngSignature) && frame[25] === 6;
}
function isValidRgbaPngIco(file){
  try {
    const b=fs.readFileSync(file);
    if(b.length<22 || b.readUInt16LE(0)!==0 || b.readUInt16LE(2)!==1) return false;
    const n=b.readUInt16LE(4);
    if(n<1||n>32||b.length<6+n*16) return false;
    for(let i=0;i<n;i++){
      const entry=6+i*16,sz=b.readUInt32LE(entry+8),off=b.readUInt32LE(entry+12);
      if(sz===0 || off<6+n*16 || off+sz>b.length || !pngIsRgba(b.subarray(off,off+sz)))return false;
    }
    return true;
  }catch{return false;}
}
(async()=>{
  if(!fs.existsSync(src)) throw Error('Missing app/icon.png; refusing to replace favicon or change branding.');
  if(isValidRgbaPngIco(target)) {
    console.log('Favicon already contains RGBA PNG frames; left unchanged.');
    return;
  }
  let sharp;
  try {sharp=require('sharp');} catch {throw Error('The project needs sharp to repair the ICO. Run npm install sharp first; nothing was changed.');}
  const sizes=[16,32,48,64,256];
  const frames=[];
  for(const size of sizes){
    const data=await sharp(src).resize(size,size,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}})
      .ensureAlpha().png({palette:false,compressionLevel:9}).toBuffer();
    if(!pngIsRgba(data))throw Error(`Sharp failed to encode ${size}px frame as RGBA; favicon not modified.`);
    frames.push({size,data});
  }
  const head=Buffer.alloc(6+16*frames.length);
  head.writeUInt16LE(0,0);head.writeUInt16LE(1,2);head.writeUInt16LE(frames.length,4);
  let off=head.length;
  frames.forEach(({size,data},i)=>{
    const k=6+i*16;
    head[k]=size===256?0:size;head[k+1]=size===256?0:size;
    head[k+2]=0;head[k+3]=0;head.writeUInt16LE(1,k+4);head.writeUInt16LE(32,k+6);
    head.writeUInt32LE(data.length,k+8);head.writeUInt32LE(off,k+12);off+=data.length;
  });
  const next=Buffer.concat([head,...frames.map(v=>v.data)]);
  const tmp=target+'.intrigue-repair-tmp';
  try {fs.writeFileSync(tmp,next);if(!isValidRgbaPngIco(tmp))throw Error('Repaired ICO did not validate');fs.renameSync(tmp,target);}
  finally {if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  console.log(`Fixed app/favicon.ico using current app/icon.png (${frames.length} RGBA frames).`);
})().catch(e=>{console.error('FAVICON REPAIR STOPPED: '+e.message);process.exitCode=1;});
