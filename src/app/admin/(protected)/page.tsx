import { query } from '@/lib/db';

interface Stats {
  totalConversations: number;
  last7Days: number;
  helpfulCount: number;
  unhelpfulCount: number;
  unratedCount: number;
  unresolvedFlagged: number;
  documentsCount: number;
  documentsBySection: { section: string; count: number }[];
}

async function getStats(): Promise<Stats> {
  const [totals, ratings, flagged, docs, docsBySection] = await Promise.all([
    query(`
      SELECT
        count(*) FILTER (WHERE true) AS total,
        count(*) FILTER (WHERE created_at > now() - interval '7 days') AS last_7_days
      FROM chat_logs
    `),
    query(`
      SELECT
        count(*) FILTER (WHERE is_helpful = true) AS helpful,
        count(*) FILTER (WHERE is_helpful = false) AS unhelpful,
        count(*) FILTER (WHERE is_helpful IS NULL) AS unrated
      FROM chat_logs
    `),
    query(`SELECT count(*) AS count FROM flagged_conversations WHERE resolved = false`),
    query(`SELECT count(*) AS count FROM documents`),
    query(`
      SELECT COALESCE(metadata->>'section', '(unmapped)') AS section, count(*) AS count
      FROM documents GROUP BY 1 ORDER BY 2 DESC
    `),
  ]);

  return {
    totalConversations: Number(totals.rows[0].total),
    last7Days: Number(totals.rows[0].last_7_days),
    helpfulCount: Number(ratings.rows[0].helpful),
    unhelpfulCount: Number(ratings.rows[0].unhelpful),
    unratedCount: Number(ratings.rows[0].unrated),
    unresolvedFlagged: Number(flagged.rows[0].count),
    documentsCount: Number(docs.rows[0].count),
    documentsBySection: docsBySection.rows.map((r) => ({ section: r.section, count: Number(r.count) })),
  };
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-3xl font-semibold text-gray-900 mt-1">{value}</p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export default async function AdminOverviewPage() {
  const stats = await getStats();
  const ratedTotal = stats.helpfulCount + stats.unhelpfulCount;
  const helpfulPct = ratedTotal > 0 ? Math.round((stats.helpfulCount / ratedTotal) * 100) : null;

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Overview</h1>
      <p className="text-sm text-gray-500 mb-6">
        How Sophie is doing right now. Numbers update as visitors chat with the widget.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Conversations (all time)" value={stats.totalConversations} />
        <StatCard label="Conversations (last 7 days)" value={stats.last7Days} />
        <StatCard
          label="Marked helpful"
          value={helpfulPct !== null ? `${helpfulPct}%` : '—'}
          hint={ratedTotal > 0 ? `${stats.helpfulCount} helpful / ${stats.unhelpfulCount} not helpful` : 'No feedback yet'}
        />
        <StatCard
          label="Needs review"
          value={stats.unresolvedFlagged}
          hint="Questions Sophie couldn't answer confidently"
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">
          Knowledge base — {stats.documentsCount} indexed content chunks
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          What Sophie has actually read from ifg.gr and internal documents, broken down by category.
          &quot;(unmapped)&quot; pages are still used to answer questions, just not tied to a specific
          category filter in the widget.
        </p>
        <div className="space-y-2">
          {stats.documentsBySection.map((row) => (
            <div key={row.section} className="flex items-center gap-3">
              <span className="w-32 text-sm text-gray-700 shrink-0">{row.section}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-600 h-2 rounded-full"
                  style={{ width: `${Math.max(4, (row.count / stats.documentsCount) * 100)}%` }}
                />
              </div>
              <span className="text-sm text-gray-500 w-10 text-right">{row.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
