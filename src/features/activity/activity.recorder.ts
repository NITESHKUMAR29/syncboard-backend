import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Activity log writes (FR-ACT-1).
 *
 * Every successful write on boards, tasks, comments and members inserts one row in the
 * same transaction as the write itself, so the feed can never disagree with the data.
 * The human-readable summary is built here, at write time, because it describes what
 * happened then — renaming a board later must not rewrite history.
 */

export const EntityType = {
  BOARD: 'BOARD',
  TASK: 'TASK',
  COMMENT: 'COMMENT',
  MEMBER: 'MEMBER',
} as const;

export type EntityTypeValue = (typeof EntityType)[keyof typeof EntityType];

export const ActivityAction = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  MOVED: 'MOVED',
  DELETED: 'DELETED',
  ASSIGNED: 'ASSIGNED',
} as const;

export type ActivityActionValue = (typeof ActivityAction)[keyof typeof ActivityAction];

export interface ActivityInput {
  workspaceId: string;
  actorId: string;
  entityType: EntityTypeValue;
  entityId: string;
  action: ActivityActionValue;
  summary: string;
  extra?: Record<string, unknown>;
}

/** Any Prisma client or transaction client. */
type Writer = Pick<Prisma.TransactionClient, 'activityLog'>;

export async function recordActivity(tx: Writer, input: ActivityInput, now: Date): Promise<void> {
  await tx.activityLog.create({
    data: {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      payload: { summary: input.summary, ...input.extra },
      createdAt: now,
    },
  });
}
