import { query } from '@/lib/db';

interface DocumentSourceRow {
  source_name: string;
  source_type: string;
  section: string | null;
  chunk_count: string;
  last_updated: string;
}

export default async function DocumentsPage() {
  const { rows } = await query<DocumentSourceRow>(`
    SELECT
      source_name,
      source_type,
      metadata->>'section' AS section,
      count(*) AS chunk_count,
      max(created_at) AS last_updated
    FROM documents
    GROUP BY source_name, source_type, metadata->>'section'
    ORDER BY last_updated DESC
  `);

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Knowledge base</h1>
      <p className="text-sm text-gray-500 mb-6">
        Every page or document Sophie has actually read and can answer from — {rows.length} sources,{' '}
        {rows.reduce((sum, r) => sum + Number(r.chunk_count), 0)} content chunks total. To add or refresh
        content, re-run the ingestion script (see the README) — this list updates automatically after that.
      </p>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Chunks</th>
              <th className="px-4 py-3">Last updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={`${row.source_name}-${row.source_type}`}>
                <td className="px-4 py-3 max-w-md truncate" title={row.source_name}>
                  {row.source_type === 'website' ? (
                    <a
                      href={row.source_name}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 hover:underline"
                    >
                      {row.source_name}
                    </a>
                  ) : (
                    row.source_name
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500">{row.source_type}</td>
                <td className="px-4 py-3 text-gray-500">{row.section ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{row.chunk_count}</td>
                <td className="px-4 py-3 text-gray-500">{new Date(row.last_updated).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
