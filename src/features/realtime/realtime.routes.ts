import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createAccessGuard } from '../workspaces/access.js';
import { createMembershipRepository } from '../workspaces/membership.repository.js';
import { CloseCode } from './events.js';
import type { Session, SessionRegistry } from './session-registry.js';

/**
 * WebSocket endpoint (Part B §7.3).
 *
 * Clients never send data changes through the socket; they use REST and receive the
 * resulting events here. After a reconnect they call /sync to catch up, because events
 * are not stored.
 */

export const PING_INTERVAL_MS = 30_000;
export const IDLE_TIMEOUT_MS = 60_000;

export interface RealtimeOptions {
  registry: SessionRegistry;
}

export async function registerRealtime(
  app: FastifyInstance,
  options: RealtimeOptions,
): Promise<void> {
  await app.register(websocket);

  const access = createAccessGuard(createMembershipRepository(app.prisma));
  const { registry } = options;

  // One timer for every connection, rather than one per socket.
  const sweeper = setInterval(() => {
    registry.sweep(Date.now(), IDLE_TIMEOUT_MS);
  }, PING_INTERVAL_MS);
  sweeper.unref();

  app.addHook('onClose', async () => {
    clearInterval(sweeper);
    registry.closeAll();
  });

  app.get(
    '/ws/workspaces/:id',
    { websocket: true, schema: { hide: true } },
    async (socket, request: FastifyRequest<{ Params: { id: string } }>) => {
      const workspaceId = request.params.id;

      // The handshake carries an ordinary Authorization header, so the same access token
      // works here as on the REST endpoints.
      let userId: string;
      try {
        const payload = await request.jwtVerify<{ sub?: string }>();
        if (!payload.sub) throw new Error('missing subject');
        userId = payload.sub;
      } catch {
        // FR-RT-3: the client refreshes its token and reconnects.
        socket.close(CloseCode.TOKEN_INVALID, 'token expired or invalid');
        return;
      }

      const role = await access.roleOf(workspaceId, userId);
      if (!role) {
        socket.close(CloseCode.NOT_A_MEMBER, 'not a member of this workspace');
        return;
      }

      const session: Session = { socket, userId, workspaceId, lastSeenAt: Date.now() };
      registry.add(session);

      const touch = () => {
        session.lastSeenAt = Date.now();
      };

      // Anything arriving proves the link is alive. Inbound messages are ignored on
      // purpose: writes go through REST, where they are validated and authorized.
      socket.on('message', touch);
      socket.on('pong', touch);
      socket.on('close', () => {
        registry.remove(session);
      });
      socket.on('error', () => {
        registry.remove(session);
      });
    },
  );
}
