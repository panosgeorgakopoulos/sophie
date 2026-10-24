import { NextResponse } from 'next/server';
import { authorizeAdminApi } from '@/lib/adminApi';
import { query } from '@/lib/db';
import { readJsonBody } from '@/lib/requestBody';
import { toSafeErrorResponse } from '@/lib/apiError';
import { HttpError } from '@/lib/httpError';
import { factDraftSchema,reviewSchema,createFactDraft,reviewKnowledge } from '@/lib/knowledgeReview';

export async function GET(req:Request) {
  try {
    await authorizeAdminApi(req);
    const url=new URL(req.url); const sourceId=url.searchParams.get('sourceId');
    if (sourceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId)) throw new HttpError(400,'Invalid source ID.');
    if (sourceId) {
      const [source,chunks,facts] = await Promise.all([
        query('SELECT * FROM knowledge_sources WHERE id=$1',[sourceId]),
        query(`SELECT d.id,d.version_id,d.content,d.metadata FROM documents d JOIN knowledge_sources s ON s.id=d.source_id
          WHERE s.id=$1 AND d.version_id=s.active_version_id ORDER BY (d.metadata->>'chunk_index')::integer LIMIT 200`,[sourceId]),
        query(`SELECT f.* FROM knowledge_facts f JOIN knowledge_sources s ON s.id=f.source_id
          WHERE s.id=$1 AND f.version_id=s.active_version_id ORDER BY f.created_at DESC LIMIT 200`,[sourceId]),
      ]);
      return NextResponse.json({source:source.rows[0]??null,chunks:chunks.rows,facts:facts.rows},{headers:{'Cache-Control':'no-store'}});
    }
    const {rows}=await query(`SELECT id,source_name,source_type,audience,approval_status,department_id,
      active_version_id,status,last_seen_at FROM knowledge_sources ORDER BY created_at DESC LIMIT 200`);
    return NextResponse.json({sources:rows},{headers:{'Cache-Control':'no-store'}});
  } catch(error) { return toSafeErrorResponse(error,'knowledge_read'); }
}
export async function POST(req:Request) {
  try {
    const session=await authorizeAdminApi(req);
    const parsed=factDraftSchema.safeParse(await readJsonBody(req,{maxBytes:16384}));
    if (!parsed.success) throw new HttpError(400,'Invalid fact draft. Check evidence, subject, language and expiry.');
    const id=await createFactDraft(parsed.data,session.userId);
    return NextResponse.json({id,status:'pending'},{status:201,headers:{'Cache-Control':'no-store'}});
  } catch(error) { return toSafeErrorResponse(error,'knowledge_draft'); }
}
export async function PATCH(req:Request) {
  try {
    const session=await authorizeAdminApi(req);
    const parsed=reviewSchema.safeParse(await readJsonBody(req,{maxBytes:2048}));
    if (!parsed.success) throw new HttpError(400,'Invalid review decision.');
    await reviewKnowledge(parsed.data,session.userId);
    return NextResponse.json({status:parsed.data.decision},{headers:{'Cache-Control':'no-store'}});
  } catch(error) { return toSafeErrorResponse(error,'knowledge_review'); }
}
