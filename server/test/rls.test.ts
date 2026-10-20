import { afterAll, describe, expect, it } from 'vitest';
import { pool } from './helpers';

describe('row-level security', () => {
  afterAll(() => pool.end());

  it('is enabled on every public table the app owns (a new table needs ALTER TABLE ... ENABLE ROW LEVEL SECURITY)', async () => {
    const { rows } = await pool.query<{ tbl: string }>(
      `SELECT c.relname AS tbl FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'spatial_ref_sys'
          AND pg_get_userbyid(c.relowner) = current_user AND NOT c.relrowsecurity`,
    );
    expect(rows.map((r) => r.tbl)).toEqual([]);
  });
});
