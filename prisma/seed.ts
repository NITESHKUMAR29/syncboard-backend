import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createDatabase, type Database } from '../src/plugins/prisma.js';

/**
 * Seed data for local development and staging (A9). Never production: the passwords are
 * published in the README.
 *
 * Running it twice is safe — existing seed accounts are reused rather than duplicated.
 */

try {
  process.loadEnvFile();
} catch {
  // No .env file; the environment already carries the variables.
}

const SEED_PASSWORD = 'Password123';

const SEED_USERS = [
  { email: 'owner@taskflow.dev', name: 'Olivia Owner', role: 'OWNER' as const },
  { email: 'admin@taskflow.dev', name: 'Adam Admin', role: 'ADMIN' as const },
  { email: 'member@taskflow.dev', name: 'Mia Member', role: 'MEMBER' as const },
];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is not set. Copy .env.example to .env first.\n');
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production') {
    process.stderr.write('Refusing to seed a production database.\n');
    process.exit(1);
  }

  const database = createDatabase(databaseUrl);
  const db = database.prisma;
  const now = new Date();

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);

  const users = [];
  for (const seed of SEED_USERS) {
    const user = await db.user.upsert({
      where: { email: seed.email },
      update: { name: seed.name },
      create: {
        id: randomUUID(),
        email: seed.email,
        name: seed.name,
        passwordHash,
        createdAt: now,
        updatedAt: now,
      },
    });

    users.push({ ...seed, id: user.id });
  }

  const owner = users[0];
  if (!owner) throw new Error('seed users missing');

  const existing = await db.workspace.findFirst({ where: { name: 'Mobile Team' } });

  if (existing) {
    process.stdout.write('Seed data already present; nothing to do.\n');
    await database.close();
    return;
  }

  const workspaceId = randomUUID();

  await db.workspace.create({
    data: {
      id: workspaceId,
      name: 'Mobile Team',
      ownerId: owner.id,
      createdAt: now,
      updatedAt: now,
      members: {
        create: users.map((user) => ({ userId: user.id, role: user.role, joinedAt: now })),
      },
      labels: {
        create: [
          { id: randomUUID(), name: 'Bug', colorHex: '#E5484D' },
          { id: randomUUID(), name: 'Feature', colorHex: '#3E63DD' },
          { id: randomUUID(), name: 'Chore', colorHex: '#8E8C99' },
        ],
      },
    },
  });

  await seedBoard(db, workspaceId, owner.id, users, now);

  // A second workspace, so the workspace list is not a list of one.
  const designId = randomUUID();
  await db.workspace.create({
    data: {
      id: designId,
      name: 'Design',
      ownerId: owner.id,
      createdAt: now,
      updatedAt: now,
      members: { create: [{ userId: owner.id, role: 'OWNER', joinedAt: now }] },
    },
  });

  process.stdout.write(
    [
      'Seeded 3 users, 2 workspaces and sample tasks.',
      '',
      'Sign in with any of these (password: ' + SEED_PASSWORD + '):',
      ...SEED_USERS.map((user) => `  ${user.role.padEnd(6)} ${user.email}`),
      '',
    ].join('\n'),
  );

  await database.close();
}

async function seedBoard(
  db: Database,
  workspaceId: string,
  ownerId: string,
  users: { id: string; role: string }[],
  now: Date,
): Promise<void> {
  const member = users.find((user) => user.role === 'MEMBER') ?? users[0];
  if (!member) return;

  const sprintId = randomUUID();
  const backlogId = randomUUID();

  await db.board.createMany({
    data: [
      {
        id: sprintId,
        workspaceId,
        title: 'Sprint 12',
        position: 1000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: backlogId,
        workspaceId,
        title: 'Backlog',
        position: 2000,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });

  const tasks = [
    {
      title: 'Implement login screen',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignee: member.id,
    },
    { title: 'Wire up token refresh', status: 'TODO', priority: 'URGENT', assignee: member.id },
    { title: 'Board drag and drop', status: 'TODO', priority: 'MEDIUM', assignee: null },
    { title: 'Offline outbox', status: 'IN_REVIEW', priority: 'HIGH', assignee: ownerId },
    { title: 'Ship 1.0 to Play Store', status: 'DONE', priority: 'LOW', assignee: ownerId },
  ];

  await db.task.createMany({
    data: tasks.map((task, index) => ({
      id: randomUUID(),
      boardId: sprintId,
      title: task.title,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assignee,
      createdBy: ownerId,
      position: (index + 1) * 1000,
      createdAt: now,
      updatedAt: now,
    })),
  });
}

await main();
