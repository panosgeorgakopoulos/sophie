import Link from 'next/link';
import { query } from '@/lib/db';
import { resolveFlaggedConversation } from './actions';

interface FlaggedRow {
  id: string;
  conversation_history: { role: string; content: string }[];
  flag_reason: string | null;
  created_at: string;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
}

export default async function FlaggedPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const params = await searchParams;
  const showResolved = params.show === 'resolved';

  const { rows } = await query<FlaggedRow>(
    `SELECT id, conversation_history, flag_reason, created_at, resolved, resolved_at, resolved_by
     FROM flagged_conversations
     WHERE resolved = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [showResolved],
  );

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Needs review</h1>
      <p className="text-sm text-gray-500 mb-4">
        Conversations where Sophie couldn&apos;t find a confident answer. Use these to spot gaps in the
        content Sophie has been given — a recurring question here usually means a page is missing or
        outdated in the knowledge base.
      </p>

      <div className="flex gap-2 mb-4">
        <Link
          href="/admin/flagged"
          className={`text-xs font-medium px-3 py-1.5 rounded-full border transition ${
            !showResolved ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-gray-600 border-gray-300'
          }`}
        >
          Unresolved
        </Link>
        <Link
          href="/admin/flagged?show=resolved"
          className={`text-xs font-medium px-3 py-1.5 rounded-full border transition ${
            showResolved ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-gray-600 border-gray-300'
          }`}
        >
          Resolved
        </Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        {rows.length === 0 && (
          <p className="p-6 text-sm text-gray-500">
            {showResolved ? 'Nothing resolved yet.' : 'Nothing needs review right now. 🎉'}
          </p>
        )}
        {rows.map((row) => {
          const lastUserMessage = [...row.conversation_history].reverse().find((m) => m.role === 'user');
          const lastAssistantMessage = [...row.conversation_history].reverse().find((m) => m.role === 'assistant');
          return (
            <div key={row.id} className="p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs text-gray-400">
                  {new Date(row.created_at).toLocaleString()} · {row.flag_reason ?? 'flagged'}
                </span>
                {!row.resolved ? (
                  <form action={resolveFlaggedConversation.bind(null, row.id)}>
                    <button
                      type="submit"
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      Mark resolved
                    </button>
                  </form>
                ) : (
                  <span className="text-xs text-gray-400">
                    Resolved {row.resolved_by ? `by ${row.resolved_by}` : ''}
                    {row.resolved_at ? ` on ${new Date(row.resolved_at).toLocaleDateString()}` : ''}
                  </span>
                )}
              </div>
              {lastUserMessage && (
                <p className="text-sm text-gray-900 mb-1">
                  <span className="font-medium text-gray-500">Q: </span>
                  {lastUserMessage.content}
                </p>
              )}
              {lastAssistantMessage && (
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  <span className="font-medium text-gray-500">A: </span>
                  {lastAssistantMessage.content}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
