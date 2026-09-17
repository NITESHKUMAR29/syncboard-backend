import { toDateOnlyOrNull } from '../../common/dates.js';
import type { Label, Task, User } from '../../generated/prisma/client.js';
import { toUserSummaryDto } from '../users/user.mapper.js';
import { toLabelDto } from '../workspaces/workspace.mapper.js';
import type { TaskDto, TaskPriority, TaskStatus } from './task.schemas.js';

/** A task loaded with everything its DTO needs. */
export type TaskWithRelations = Task & {
  assignee: User | null;
  creator: User;
  labels: { label: Label }[];
  board: { workspaceId: string };
  _count: { comments: number; attachments: number };
};

export function toTaskDto(task: TaskWithRelations): TaskDto {
  return {
    id: task.id,
    boardId: task.boardId,
    workspaceId: task.board.workspaceId,
    title: task.title,
    description: task.description,
    status: task.status as TaskStatus,
    priority: task.priority as TaskPriority,
    assignee: task.assignee ? toUserSummaryDto(task.assignee) : null,
    createdBy: toUserSummaryDto(task.creator),
    // A DATE column formatted from UTC parts, never local time.
    dueDate: toDateOnlyOrNull(task.dueDate),
    position: task.position,
    labels: task.labels.map((link) => toLabelDto(link.label)),
    commentCount: task._count.comments,
    attachmentCount: task._count.attachments,
    version: task.version,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

/** The sync feed adds deletedAt to the standard DTO (Part B §7.1). */
export function toSyncTaskDto(task: TaskWithRelations) {
  return {
    ...toTaskDto(task),
    deletedAt: task.deletedAt ? task.deletedAt.toISOString() : null,
  };
}
