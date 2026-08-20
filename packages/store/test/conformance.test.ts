import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core';
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { ALL_ENUMS } from '../src/schema/enums.js';
import { pgTables } from '../src/schema/pg.js';
import { sqliteTables } from '../src/schema/sqlite.js';

const EXPECTED_TABLES = [
  'project',
  'api_key',
  'handle',
  'test_case',
  'test_case_revision',
  'test_step',
  'step_fingerprint',
  'run',
  'run_attempt',
  'step_result',
  'artifact',
  'action_log',
  'heal_proposal',
  'flaky_stat',
  'quarantine',
  'coverage_map',
  'task',
] as const;

const ACTION_LOG_COLUMNS = [
  'id',
  'ts_start',
  'duration_ms',
  'run_id',
  'transport',
  'protocol_era',
  'principal',
  'upstream',
  'tool',
  'upstream_tool',
  'args_shape',
  'args_redacted',
  'args_hash',
  'is_error',
  'error_code',
  'error_message',
  'result_chars',
  'result_kinds',
  'result_digest',
  'traceparent',
  'client_name',
  'created_at',
];

type AnyTable = (typeof sqliteTables)[keyof typeof sqliteTables] | (typeof pgTables)[keyof typeof pgTables];

function columnMeta(table: AnyTable) {
  return Object.fromEntries(
    Object.entries(getTableColumns(table)).map(([prop, col]) => [
      prop,
      {
        name: col.name,
        notNull: col.notNull,
        primary: col.primary,
        hasDefault: col.hasDefault,
        enumValues: col.enumValues ?? null,
      },
    ]),
  );
}

function indexMeta(dialect: 'sqlite' | 'pg', table: AnyTable) {
  const cfg =
    dialect === 'sqlite'
      ? getSqliteTableConfig(table as (typeof sqliteTables)[keyof typeof sqliteTables])
      : getPgTableConfig(table as (typeof pgTables)[keyof typeof pgTables]);
  return cfg.indexes
    .map((ix) => ({
      // Every index in both schemas is named explicitly; an unnamed one would fail the comparison below.
      name: ix.config.name ?? '<unnamed>',
      unique: ix.config.unique,
      partial: ix.config.where !== undefined,
      columns: ix.config.columns.map((c) => ('name' in c ? c.name : String(c))),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe('dialect conformance (sqlite ⇔ pg)', () => {
  it('both schemas define exactly the 17 design tables', () => {
    expect(Object.keys(sqliteTables).sort()).toEqual([...EXPECTED_TABLES].sort());
    expect(Object.keys(pgTables).sort()).toEqual([...EXPECTED_TABLES].sort());
  });

  for (const key of EXPECTED_TABLES) {
    describe(key, () => {
      const s = sqliteTables[key];
      const p = pgTables[key];

      it('has the same SQL table name', () => {
        expect(getTableName(s)).toBe(key);
        expect(getTableName(p)).toBe(key);
      });

      it('has the same column set (property keys and SQL names)', () => {
        expect(Object.keys(getTableColumns(s)).sort()).toEqual(Object.keys(getTableColumns(p)).sort());
        const sNames = Object.values(getTableColumns(s))
          .map((c) => c.name)
          .sort();
        const pNames = Object.values(getTableColumns(p))
          .map((c) => c.name)
          .sort();
        expect(sNames).toEqual(pNames);
        for (const name of sNames) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      });

      it('agrees on nullability, primary keys, defaults and enum members per column', () => {
        expect(columnMeta(s)).toEqual(columnMeta(p));
      });

      it('has the same indexes (name, uniqueness, partiality, column set)', () => {
        expect(indexMeta('sqlite', s)).toEqual(indexMeta('pg', p));
      });
    });
  }

  it('action_log has exactly the contract columns', () => {
    const names = Object.values(getTableColumns(sqliteTables.action_log)).map((c) => c.name);
    expect(names).toEqual(ACTION_LOG_COLUMNS);
  });

  it('run supports every Run interface field', () => {
    const names = Object.values(getTableColumns(pgTables.run)).map((c) => c.name);
    for (const col of [
      'id',
      'project_id',
      'name',
      'status',
      'trigger',
      'meta',
      'summary',
      'principal',
      'created_at',
      'started_at',
      'finished_at',
      'git_sha',
      'branch',
      'base_sha',
      'platforms',
      'selection',
      'idempotency_key',
      'infra_outage',
      'task_id',
    ]) {
      expect(names).toContain(col);
    }
  });

  it('handle supports every HandleRecord field', () => {
    const names = Object.values(getTableColumns(pgTables.handle)).map((c) => c.name);
    for (const col of [
      'handle',
      'kind',
      'owner',
      'state',
      'created_at',
      'expires_at',
      'last_used_at',
      'revoked_at',
      'project_id',
      'platform',
      'upstream_ref',
      'ttl_s',
    ]) {
      expect(names).toContain(col);
    }
  });

  it('required indexes exist', () => {
    const has = (table: AnyTable, name: string) => indexMeta('sqlite', table).some((ix) => ix.name === name);
    expect(has(sqliteTables.handle, 'handle_expires_at_idx')).toBe(true);
    expect(has(sqliteTables.action_log, 'action_log_run_ts_idx')).toBe(true);
    expect(indexMeta('sqlite', sqliteTables.run)).toContainEqual({
      name: 'run_idempotency_key_uq',
      unique: true,
      partial: true,
      columns: ['idempotency_key'],
    });
    expect(indexMeta('sqlite', sqliteTables.test_case)).toContainEqual({
      name: 'test_case_project_key_uq',
      unique: true,
      partial: false,
      columns: ['project_id', 'key'],
    });
    expect(has(sqliteTables.step_fingerprint, 'step_fingerprint_cache_key_idx')).toBe(true);
    expect(has(sqliteTables.heal_proposal, 'heal_proposal_status_idx')).toBe(true);
  });

  it('enum arrays are non-empty, unique and snake/upper-case tokens', () => {
    for (const [name, values] of Object.entries(ALL_ENUMS)) {
      expect(values.length, name).toBeGreaterThan(0);
      expect(new Set(values).size, name).toBe(values.length);
      for (const v of values) expect(v, name).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
    }
  });
});
