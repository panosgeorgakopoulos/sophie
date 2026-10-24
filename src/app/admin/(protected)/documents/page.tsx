import { requireAdminSession } from '@/lib/adminSession';
import { query } from '@/lib/db';

interface DocumentSourceRow {
  id: string; source_name: string; source_type: string; sections: string[];
  audience: string; approval_status: string; status: string;
  active_version_id: string | null; chunk_count: string; public_fact_count: string;
  last_verified_at: string | null;
}

function publicSourceUrl(name: string): string | undefined {
  try {
    const url = new URL(name);
    return url.protocol === 'https:' && ['ifg.gr', 'www.ifg.gr'].includes(url.hostname) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export default async function DocumentsPage() {
  await requireAdminSession();
  const { rows } = await query<DocumentSourceRow>(`
    SELECT s.id, s.source_name, s.source_type, s.sections, s.audience, s.approval_status,
      s.status, s.active_version_id, s.last_verified_at,
      (SELECT count(*) FROM documents d WHERE d.source_id=s.id AND d.version_id=s.active_version_id) AS chunk_count,
      (SELECT count(*) FROM public_knowledge_facts f WHERE f.source_id=s.id AND f.version_id=s.active_version_id) AS public_fact_count
    FROM knowledge_sources s
    ORDER BY s.last_verified_at DESC NULLS LAST, s.created_at DESC
    LIMIT 200
  `);

  return (
    <div className="max-w-6xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Knowledge base</h1>
      <p className="text-sm text-gray-500 mb-6">
        Up to 200 most recently verified sources. Private, pending, rejected, withdrawn, and quarantined
        sources are unavailable to public answers. Public facts also need current, separately approved evidence.
        Use the documented staff ingestion and review workflow to add or approve content.
      </p>
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              {['Source', 'Category', 'Visibility', 'Approval', 'Status', 'Version', 'Chunks', 'Public facts', 'Verified'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(row => {
              const url = publicSourceUrl(row.source_name);
              return (
                <tr key={row.id}>
                  <td className="px-4 py-3 max-w-xs truncate" title={row.source_name}>
                    {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">{row.source_name}</a> : row.source_name}
                    <p className="text-xs text-gray-500">{row.source_type}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{row.sections.join(', ') || 'Unmapped'}</td>
                  <td className="px-4 py-3">{row.audience}</td>
                  <td className="px-4 py-3">{row.approval_status}</td>
                  <td className="px-4 py-3">{row.status}</td>
                  <td className="px-4 py-3" title={row.active_version_id ?? undefined}>{row.active_version_id?.slice(0, 8) ?? 'None'}</td>
                  <td className="px-4 py-3">{row.chunk_count}</td>
                  <td className="px-4 py-3">{row.public_fact_count}</td>
                  <td className="px-4 py-3">{row.last_verified_at ? new Date(row.last_verified_at).toLocaleDateString('en-GB', { timeZone: 'Europe/Athens' }) : 'Unverified'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-sm text-gray-500">No governed sources yet. Legacy chunks are unavailable publicly until re-ingested and approved.</p>}
      </div>
    </div>
  );
}
