import type { WebSocket } from 'ws';
import { CloseCode, type EventBroadcaster, type WorkspaceEvent } from './events.js';

/**
 * In-memory WebSocket sessions (A9: one server instance; scaling out later needs Redis
 * pub/sub).
 *
 * Sessions are indexed by workspace and, within that, by user, because the three things
 * this has to do are: send an event to a whole workspace, disconnect one member who was
 * removed, and disconnect everyone when the workspace is deleted.
 */

export interface Session {
  socket: WebSocket;
  userId: string;
  workspaceId: string;
  /** Bumped on every frame from the client, including pongs, to detect dead links. */
  lastSeenAt: number;
}

export interface SessionRegistry extends EventBroadcaster {
  add(session: Session): void;
  remove(session: Session): void;
  /** Sessions in a workspace, for tests and diagnostics. */
  countFor(workspaceId: string): number;
  /** Pings everyone and drops links that stopped answering. */
  sweep(now: number, idleTimeoutMs: number): void;
  closeAll(): void;
}

export function createSessionRegistry(logger?: {
  warn: (details: unknown, message: string) => void;
}): SessionRegistry {
  // workspaceId -> userId -> sessions. A user can have several devices connected.
  const byWorkspace = new Map<string, Map<string, Set<Session>>>();

  function sessionsIn(workspaceId: string): Session[] {
    const users = byWorkspace.get(workspaceId);
    if (!users) return [];

    return [...users.values()].flatMap((sessions) => [...sessions]);
  }

  function send(session: Session, payload: string) {
    try {
      session.socket.send(payload);
    } catch (error) {
      // A socket that died between the lookup and the write must not take down the
      // request that triggered the broadcast.
      logger?.warn({ err: error, userId: session.userId }, 'failed to deliver event');
    }
  }

  return {
    add(session) {
      const users = byWorkspace.get(session.workspaceId) ?? new Map<string, Set<Session>>();
      const sessions = users.get(session.userId) ?? new Set<Session>();

      sessions.add(session);
      users.set(session.userId, sessions);
      byWorkspace.set(session.workspaceId, users);
    },

    remove(session) {
      const users = byWorkspace.get(session.workspaceId);
      const sessions = users?.get(session.userId);

      sessions?.delete(session);

      if (sessions && sessions.size === 0) users?.delete(session.userId);
      if (users && users.size === 0) byWorkspace.delete(session.workspaceId);
    },

    broadcast(event: WorkspaceEvent) {
      const payload = JSON.stringify(event);

      // FR-RT-2: everyone in the workspace, including the actor's other devices, which
      // is how a phone and a tablet stay in step.
      for (const session of sessionsIn(event.workspaceId)) {
        send(session, payload);
      }
    },

    closeUserSockets(workspaceId, userId, code) {
      const sessions = byWorkspace.get(workspaceId)?.get(userId);
      if (!sessions) return;

      for (const session of [...sessions]) {
        session.socket.close(code, 'no longer a member');
      }
    },

    closeWorkspaceSockets(workspaceId, code) {
      for (const session of sessionsIn(workspaceId)) {
        session.socket.close(code, 'workspace gone');
      }
    },

    countFor(workspaceId) {
      return sessionsIn(workspaceId).length;
    },

    sweep(now, idleTimeoutMs) {
      for (const [workspaceId] of byWorkspace) {
        for (const session of sessionsIn(workspaceId)) {
          if (now - session.lastSeenAt > idleTimeoutMs) {
            // Silent for longer than the timeout: the link is gone even if TCP has not
            // noticed, so free the slot rather than broadcasting into a void.
            session.socket.terminate();
            continue;
          }

          try {
            session.socket.ping();
          } catch {
            session.socket.terminate();
          }
        }
      }
    },

    closeAll() {
      for (const [workspaceId] of byWorkspace) {
        for (const session of sessionsIn(workspaceId)) {
          session.socket.close(CloseCode.WORKSPACE_GONE, 'server shutting down');
        }
      }
      byWorkspace.clear();
    },
  };
}
