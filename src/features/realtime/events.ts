/**
 * WebSocket events (Part B §7.3).
 *
 * Every committed write produces one. They are collected inside the transaction and
 * dispatched only after it resolves, so a client never hears about a write that then
 * rolled back (NFR-6).
 */

export const EventType = {
  BOARD_CREATED: 'BOARD_CREATED',
  BOARD_UPDATED: 'BOARD_UPDATED',
  BOARD_DELETED: 'BOARD_DELETED',
  TASK_CREATED: 'TASK_CREATED',
  TASK_UPDATED: 'TASK_UPDATED',
  TASK_DELETED: 'TASK_DELETED',
  TASKS_REORDERED: 'TASKS_REORDERED',
  COMMENT_CREATED: 'COMMENT_CREATED',
  COMMENT_UPDATED: 'COMMENT_UPDATED',
  COMMENT_DELETED: 'COMMENT_DELETED',
  MEMBER_ADDED: 'MEMBER_ADDED',
  MEMBER_UPDATED: 'MEMBER_UPDATED',
  MEMBER_REMOVED: 'MEMBER_REMOVED',
} as const;

export type EventTypeValue = (typeof EventType)[keyof typeof EventType];

export interface WorkspaceEvent {
  type: EventTypeValue;
  workspaceId: string;
  /** Who caused it. Their other devices still receive it (FR-RT-2). */
  actorId: string;
  occurredAt: string;
  payload: unknown;
}

/** Close codes (Part B §7.3). */
export const CloseCode = {
  TOKEN_INVALID: 4401,
  NOT_A_MEMBER: 4403,
  WORKSPACE_GONE: 4404,
} as const;

export interface EventBroadcaster {
  /** Sends an event to every open connection for its workspace. */
  broadcast(event: WorkspaceEvent): void;
  /** Disconnects one member, e.g. after they are removed (FR-RT-3). */
  closeUserSockets(workspaceId: string, userId: string, code: number): void;
  /** Disconnects everyone, e.g. when the workspace is deleted. */
  closeWorkspaceSockets(workspaceId: string, code: number): void;
}

/** Used until the WebSocket layer is wired up, and in tests that ignore events. */
export function createNoopBroadcaster(): EventBroadcaster {
  return {
    broadcast: () => undefined,
    closeUserSockets: () => undefined,
    closeWorkspaceSockets: () => undefined,
  };
}
