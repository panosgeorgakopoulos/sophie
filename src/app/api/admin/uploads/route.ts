import { NextResponse } from 'next/server';
import { authorizeAdminApi } from '@/lib/adminApi';
import { query } from '@/lib/db';
import { HttpError } from '@/lib/httpError';
import { toSafeErrorResponse } from '@/lib/apiError';
import { sourcePolicySchema } from '@/lib/ingestion/manifest';
import { readUpload,storeUpload,uploadFormat,validateUploadSignature,uploadCanonicalKey } from '@/lib/uploadStorage';
import { checkRateLimit } from '@/lib/rateLimit';

export const runtime='nodejs';
export async function GET(req:Request) {
  try {
    const session=await authorizeAdminApi(req,['staff','reviewer','admin']);
    const {rows}=await query(`SELECT id,original_name,status,result_code,source_id,created_at FROM ingestion_uploads
      WHERE created_by=$1 OR $2 IN ('reviewer','admin') ORDER BY created_at DESC LIMIT 100`,[session.userId,session.role]);
    return NextResponse.json({uploads:rows},{headers:{'Cache-Control':'no-store'}});
  } catch(error) {return toSafeErrorResponse(error,'upload_status');}
}
export async function POST(req:Request) {
  try {
    const session=await authorizeAdminApi(req,['staff','reviewer','admin']);
    if(!(await checkRateLimit(`upload:${session.userId}`,{limit:10,windowMs:3600000})).success) throw new HttpError(429,'Upload quota reached. Try again later.');
    if(!(await checkRateLimit('uploads:global:day',{limit:100,windowMs:86400000})).success) throw new HttpError(429,'Daily upload capacity reached.');
    let name:string;
    try {name=decodeURIComponent(req.headers.get('x-document-name')??'');} catch {throw new HttpError(400,'Invalid encoded document name.');}
    const format=uploadFormat(name,req.headers.get('content-type'));
    const policyText=req.headers.get('x-source-policy');
    if(!policyText || policyText.length>4096) throw new HttpError(400,'Source policy required.');
    let policyValue:unknown; try{policyValue=JSON.parse(policyText);}catch{throw new HttpError(400,'Invalid source policy.');}
    const policy=sourcePolicySchema.safeParse(policyValue);
    if(!policy.success || policy.data.sections.length === 0) throw new HttpError(400,'Invalid department, audience, sections or dates.');
    const bytes=await readUpload(req); validateUploadSignature(bytes,format);
    const file=await storeUpload(bytes);
    try {
      await query(`INSERT INTO ingestion_uploads(id,original_name,format,content_hash,byte_size,policy,created_by,canonical_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[file.id,name,format,file.hash,bytes.length,policy.data,session.userId,uploadCanonicalKey(policy.data.departmentId,name)]);
    } catch(error) {await file.remove();throw error;}
    return NextResponse.json({id:file.id,status:'queued'},{status:202,headers:{'Cache-Control':'no-store'}});
  } catch(error) {return toSafeErrorResponse(error,'document_upload');}
}
