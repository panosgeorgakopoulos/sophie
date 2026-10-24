import path from 'node:path';
import { mkdir, realpath, lstat, writeFile, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { HttpError } from './httpError';
import type { DocumentFormat } from './ingestion/types';

export const MAX_UPLOAD_BYTES=20*1024*1024;
export function uploadFormat(name:string, contentType:string|null):DocumentFormat {
  if (!name.trim() || name !== name.trim() || name.length>180 || /[/\\]/.test(name) || [...name].some(c=>c.charCodeAt(0)<32) || name.startsWith('.')) throw new HttpError(400,'Invalid document name.');
  const format=path.extname(name).slice(1).toLowerCase();
  const allowed:Record<string,string[]>={pdf:['application/pdf'],docx:['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],xlsx:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],md:['text/markdown','text/plain']};
  if (!allowed[format]?.includes((contentType??'').split(';')[0].trim().toLowerCase())) throw new HttpError(415,'Use PDF, DOCX, XLSX or Markdown with its matching content type.');
  return format as DocumentFormat;
}
export async function uploadDirectory():Promise<string> {
  const configured=process.env.UPLOAD_DIR;
  if (!configured || !path.isAbsolute(configured)) throw new HttpError(503,'Document storage is not configured.');
  // Storage is separate from the deployment tree, never a public/static asset.
  const root=await realpath(process.cwd());
  await mkdir(configured,{recursive:true,mode:0o700});
  const directory=await realpath(configured);
  if (directory===root || directory.startsWith(`${root}${path.sep}`) || (await lstat(configured)).isSymbolicLink()) throw new HttpError(503,'Document storage must be outside the application directory.');
  return directory;
}
export async function uploadPath(id:string):Promise<string> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid upload ID');
  return path.join(await uploadDirectory(),`${id}.quarantine`);
}
export async function readUpload(req:Request):Promise<Buffer> {
  const length=req.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length)>MAX_UPLOAD_BYTES)) throw new HttpError(413,'Document exceeds 20 MiB.');
  if (!req.body) throw new HttpError(400,'Document body required.');
  const reader=req.body.getReader(); const parts:Uint8Array[]=[]; let size=0;
  const timeout=setTimeout(()=>void reader.cancel(),15000);
  const start=Date.now();
  try {
    while(true) {
      const part=await reader.read();
      if (Date.now()-start>=15000) throw new HttpError(408,'Upload timed out.');
      if(part.done) break;
      size+=part.value.byteLength;
      if(size>MAX_UPLOAD_BYTES) throw new HttpError(413,'Document exceeds 20 MiB.');
      parts.push(part.value);
    }
    if(!size) throw new HttpError(400,'Empty document.');
    return Buffer.concat(parts,size);
  } finally { clearTimeout(timeout); void reader.cancel().catch(()=>undefined); reader.releaseLock(); }
}
export function validateUploadSignature(bytes:Buffer,format:DocumentFormat):void {
  if(format==='pdf' && bytes.subarray(0,5).toString()!=='%PDF-') throw new HttpError(422,'Invalid PDF.');
  if(['docx','xlsx'].includes(format) && (bytes.length < 4 || bytes.readUInt32LE(0)!==0x04034b50)) throw new HttpError(422,'Invalid Office archive.');
  if(format==='md') { try { new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch {throw new HttpError(422,'Markdown must be UTF-8.');} }
}
export async function storeUpload(bytes:Buffer) {
  const id=randomUUID(); const file=await uploadPath(id);
  await writeFile(file,bytes,{flag:'wx',mode:0o600});
  return {id,hash:createHash('sha256').update(bytes).digest('hex'),remove:()=>unlink(file)};
}
export async function scanUpload(file:string):Promise<void> {
  const executable=process.env.CLAMSCAN_PATH;
  if(!executable || !path.isAbsolute(executable)) throw new Error('Malware scanner not configured');
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(executable,['--no-summary','--stdout',file],{env:{LANG:'C.UTF-8',NODE_ENV:'production'},stdio:'ignore'});
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Malware scan timeout'));},120000);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('Malware scanner unavailable'));});
    child.once('exit',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error('Malware scan did not pass'));});
  });
}

/** Stable department+logical filename identity: replacing content creates a pending version. */
export function uploadCanonicalKey(departmentId: string, originalName: string): string {
  const identity = `${departmentId}:${originalName.normalize('NFKC').toLocaleLowerCase('en')}`;
  return `upload:${createHash('sha256').update(identity).digest('hex')}`;
}
