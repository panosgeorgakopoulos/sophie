import { Pool, type QueryResultRow } from 'pg';
import dotenv from 'dotenv';
import { integerEnv } from './env';

dotenv.config({ path: '.env.local', quiet: true });

// Create a single connection pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: integerEnv('DB_POOL_MAX', 5, 1, 50),
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 8_000,
  query_timeout: 10_000,
  application_name: 'sophie-app',
});
pool.on('error', () => console.error(JSON.stringify({event:'database_pool_error'})));

let publicPool: Pool | undefined;
let publicRoleChecked: Promise<void> | undefined;

function getPublicPool(): Pool {
  if (!process.env.PUBLIC_DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') throw new Error('PUBLIC_DATABASE_URL is required');
    return pool;
  }
  if (!publicPool) {
    publicPool = new Pool({connectionString:process.env.PUBLIC_DATABASE_URL,max:5,
      connectionTimeoutMillis:5_000,idleTimeoutMillis:30_000,statement_timeout:8_000,
      query_timeout:10_000,application_name:'sophie-public'});
    publicPool.on('error', () => console.error(JSON.stringify({event:'public_database_pool_error'})));
  }
  return publicPool;
}

/** Public retrieval must run with a role that cannot select the raw corpus. */
export async function queryPublic<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
  const reader = getPublicPool();
  if (process.env.NODE_ENV === 'production') {
    publicRoleChecked ??= reader.query<{unsafe:boolean}>(
      "SELECT has_any_column_privilege(current_user,'documents','SELECT') OR has_any_column_privilege(current_user,'knowledge_facts','SELECT') AS unsafe",
    ).then(({rows}) => {if (rows[0]?.unsafe !== false) throw new Error('Public database role has excessive permissions');});
    try { await publicRoleChecked; } catch(error) { publicRoleChecked=undefined; throw error; }
  }
  return reader.query<T>(text,params);
}

// Helper to query the database
export const query = <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => {
  return pool.query<T>(text, params);
};

/** CLI/integration-test shutdown; server requests keep their pools alive. */
export async function closeDatabases(): Promise<void> {
  await Promise.all([pool.end(),publicPool?.end()]);
  publicPool=undefined; publicRoleChecked=undefined;
}
