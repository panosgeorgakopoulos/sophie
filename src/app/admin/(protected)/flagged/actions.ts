'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@/lib/db';
import { getAdminSession } from '@/lib/adminSession';

export async function resolveFlaggedConversation(id: string) {
  const session = await getAdminSession();
  if (!session) throw new Error('Unauthorized');

  await query(
    'UPDATE flagged_conversations SET resolved = true, resolved_at = now(), resolved_by = $1 WHERE id = $2',
    [session.email, id],
  );
  revalidatePath('/admin/flagged');
}
