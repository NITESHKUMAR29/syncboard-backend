import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database.js';

/**
 * Creating the test database applies every migration from zero, so reaching these tests
 * already proves the migrations run. They check the resulting schema is the one Part B §3
 * specifies.
 */

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const EXPECTED_TABLES = [
  'activity_logs',
  'attachments',
  'boards',
  'comments',
  'devices',
  'labels',
  'refresh_tokens',
  'task_labels',
  'tasks',
  'users',
  'workspace_members',
  'workspaces',
];

describe('migrations', () => {
  it('creates every table from Part B §3 with snake_case names', async () => {
    const rows = await database.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name NOT LIKE '\\_%'
      ORDER BY table_name
    `;

    expect(rows.map((row) => row.table_name)).toEqual(EXPECTED_TABLES);
  });

  it('creates the documented indexes', async () => {
    const rows = await database.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `;

    expect(rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'idx_tasks_board_updated',
        'idx_comments_task_created',
        'idx_boards_ws_updated',
        'idx_activity_ws_created',
      ]),
    );
  });

  it('enforces case-insensitive label names per workspace (FR-LBL-1)', async () => {
    const rows = await database.prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'uq_labels_workspace_lower_name'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain('lower');
  });

  it('stores timestamps as timestamptz (A9: all times UTC)', async () => {
    const rows = await database.prisma.$queryRaw<{ data_type: string }[]>`
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'created_at'
    `;

    expect(rows.every((row) => row.data_type === 'timestamp with time zone')).toBe(true);
  });

  it('stores due_date as a plain DATE', async () => {
    const rows = await database.prisma.$queryRaw<{ data_type: string }[]>`
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'due_date'
    `;

    expect(rows[0]?.data_type).toBe('date');
  });
});
