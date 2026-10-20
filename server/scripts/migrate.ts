// Applies db/migrations/*.sql in order, tracking applied files in schema_migrations.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../db/migrations');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(f)) continue;
  await client.query('BEGIN');
  await client.query(readFileSync(join(dir, f), 'utf8'));
  await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
  await client.query('COMMIT');
  console.log('applied', f);
}
await client.end();
