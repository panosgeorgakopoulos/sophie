import { readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({path:'.env.local',quiet:true});
async function main() {
  // Separate credential required: the application and public reader must not own DDL.
  if(!process.env.MIGRATION_DATABASE_URL) throw new Error('Set MIGRATION_DATABASE_URL explicitly.');
  const pool=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL,max:1,connectionTimeoutMillis:5000});
  const client=await pool.connect();
  try {
    await client.query("SET lock_timeout='30s'");
    await client.query('SELECT pg_advisory_lock(721805412)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`);
    const {rows:[state]}=await client.query<{exists:boolean}>("SELECT to_regclass('public.documents') IS NOT NULL AS exists");
    if(!state.exists) {
      await client.query('BEGIN');
      try {await client.query(await readFile('schema.sql','utf8'));await client.query('COMMIT');}
      catch(error){await client.query('ROLLBACK');throw error;}
    }
    // 000 is a historical annotation; schema.sql already contains its columns.
    for(const name of (await readdir('migrations')).filter(n=>/^\d+.*\.sql$/.test(n)&&!n.startsWith('000_')).sort()) {
      const sql=await readFile(path.join('migrations',name),'utf8');
      const hash=createHash('sha256').update(sql).digest('hex');
      const previous=await client.query<{sha256:string}>('SELECT sha256 FROM schema_migrations WHERE name=$1',[name]);
      if(previous.rows[0]) {
        if(previous.rows[0].sha256!==hash)throw new Error(`Applied migration checksum changed: ${name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[name,hash]);
        await client.query('COMMIT');console.log(`Applied ${name}`);
      } catch(error){await client.query('ROLLBACK');throw error;}
    }
  } finally {await client.query('SELECT pg_advisory_unlock(721805412)').catch(()=>undefined);client.release();await pool.end();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Migration failed');process.exitCode=1;});
