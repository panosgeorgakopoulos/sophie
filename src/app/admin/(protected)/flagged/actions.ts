'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@/lib/db';
import { requireAdminSession } from '@/lib/adminSession';

export async function resolveFlaggedConversation(id: string) {
  const session = await requireAdminSession(['reviewer', 'admin']);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid identifier');

  await query(
    'UPDATE flagged_conversations SET resolved = true, resolved_at = now(), resolved_by = $1 WHERE id = $2',
    [session.email, id],
  );
  revalidatePath('/admin/flagged');
}
