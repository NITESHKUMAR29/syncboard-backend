import cron from 'node-cron';
import type { Clock } from '../common/clock.js';
import type { Database } from '../plugins/prisma.js';
import { PushType, type PushSender } from '../push/push-sender.js';

/**
 * Daily due-soon notifications (FR-PUSH-3).
 *
 * At 09:00 UTC, every task due the next UTC day that is not deleted and not DONE sends
 * one push to its assignee. The window is a whole UTC day rather than "24 hours from now"
 * so the job is idempotent within a day: running it twice notifies about the same set,
 * and the schedule guarantees one run.
 */

export const DUE_SOON_CRON = '0 9 * * *';

export interface DueSoonJob {
  /** Runs the sweep immediately; exposed so tests do not wait for a scheduler. */
  runOnce(): Promise<number>;
  stop(): void;
}

export interface DueSoonDeps {
  db: Database;
  push: PushSender;
  clock: Clock;
  logger: {
    info: (details: unknown, message: string) => void;
    error: (details: unknown, message: string) => void;
  };
}

export function createDueSoonJob({ db, push, clock, logger }: DueSoonDeps): DueSoonJob {
  async function runOnce(): Promise<number> {
    const tomorrow = nextUtcDay(clock.now());

    const tasks = await db.task.findMany({
      where: {
        deletedAt: null,
        status: { not: 'DONE' },
        assigneeId: { not: null },
        dueDate: tomorrow,
      },
      select: {
        id: true,
        title: true,
        boardId: true,
        assigneeId: true,
        board: { select: { workspaceId: true } },
      },
    });

    for (const task of tasks) {
      if (!task.assigneeId) continue;

      push.send({
        userIds: [task.assigneeId],
        data: {
          type: PushType.TASK_DUE_SOON,
          title: 'Task due tomorrow',
          body: `"${task.title}" is due tomorrow`,
          workspaceId: task.board.workspaceId,
          boardId: task.boardId,
          taskId: task.id,
          deepLink: `taskflow://tasks/${task.id}`,
        },
      });
    }

    logger.info({ count: tasks.length }, 'due-soon notifications queued');
    return tasks.length;
  }

  const task = cron.schedule(
    DUE_SOON_CRON,
    () => {
      void runOnce().catch((error: unknown) => {
        logger.error({ err: error }, 'due-soon job failed');
      });
    },
    { timezone: 'UTC' },
  );

  return {
    runOnce,
    stop: () => {
      void task.stop();
    },
  };
}

/** Midnight UTC of the day after `now`, which is how a DATE column stores it. */
export function nextUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  );
}
