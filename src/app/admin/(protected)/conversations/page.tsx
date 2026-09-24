import Link from 'next/link';
import { query } from '@/lib/db';

const PAGE_SIZE = 25;
const SECTIONS = ['all', 'mathimata', 'eksetaseis', 'spoudes', 'synergeies', 'vivliothiki'];

interface ChatLogRow {
  id: string;
  session_id: string;
  user_message: string;
  assistant_reply: string;
  is_helpful: boolean | null;
  section: string | null;
  created_at: string;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function HelpfulBadge({ value }: { value: boolean | null }) {
  if (value === true) return <span className="text-green-600 text-xs font-medium">👍 Helpful</span>;
  if (value === false) return <span className="text-red-600 text-xs font-medium">👎 Not helpful</span>;
  return <span className="text-gray-400 text-xs">No feedback</span>;
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; section?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const section = params.section && SECTIONS.includes(params.section) ? params.section : 'all';
  const offset = (page - 1) * PAGE_SIZE;

  const whereClause = section !== 'all' ? 'WHERE section = $1' : '';
  const queryParams = section !== 'all' ? [section, PAGE_SIZE, offset] : [PAGE_SIZE, offset];
  const limitIdx = section !== 'all' ? '$2' : '$1';
  const offsetIdx = section !== 'all' ? '$3' : '$2';

  const [rowsResult, countResult] = await Promise.all([
    query<ChatLogRow>(
      `SELECT id, session_id, user_message, assistant_reply, is_helpful, section, created_at
       FROM chat_logs ${whereClause}
       ORDER BY created_at DESC
       LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
      queryParams,
    ),
    query<{ count: string }>(
      `SELECT count(*) FROM chat_logs ${whereClause}`,
      section !== 'all' ? [section] : [],
    ),
  ]);

  const total = Number(countResult.rows[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Conversations</h1>
      <p className="text-sm text-gray-500 mb-4">{total} total — most recent first.</p>

      <div className="flex gap-2 mb-4 flex-wrap">
        {SECTIONS.map((s) => (
          <Link
            key={s}
            href={`/admin/conversations?section=${s}`}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition ${
              s === section
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        {rowsResult.rows.length === 0 && (
          <p className="p-6 text-sm text-gray-500">No conversations yet for this filter.</p>
        )}
        {rowsResult.rows.map((row) => (
          <div key={row.id} className="p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs text-gray-400">
                {new Date(row.created_at).toLocaleString()} · {row.section ?? 'all'} · session {row.session_id.slice(0, 8)}
              </span>
              <HelpfulBadge value={row.is_helpful} />
            </div>
            <p className="text-sm text-gray-900 mb-1">
              <span className="font-medium text-gray-500">Q: </span>
              {truncate(row.user_message, 300)}
            </p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              <span className="font-medium text-gray-500">A: </span>
              {truncate(row.assistant_reply, 500)}
            </p>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 mt-4">
          {page > 1 && (
            <Link
              href={`/admin/conversations?section=${section}&page=${page - 1}`}
              className="text-sm text-blue-700 hover:underline"
            >
              ← Previous
            </Link>
          )}
          <span className="text-sm text-gray-400">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/admin/conversations?section=${section}&page=${page + 1}`}
              className="text-sm text-blue-700 hover:underline"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
