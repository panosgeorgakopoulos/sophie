import { Pool, type QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Create a single connection pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Helper to query the database
export const query = <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => {
  return pool.query<T>(text, params);
};
