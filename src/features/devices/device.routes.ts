import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUserId } from '../../plugins/auth.js';
import { createDeviceRepository } from './device.repository.js';
import { deviceIdParamsSchema, deviceSchema, registerDeviceBodySchema } from './device.schemas.js';
import { createDeviceService } from './device.service.js';

/** FCM device registration (Part B §5.1). */
export const deviceRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createDeviceService(createDeviceRepository(app.prisma), app.clock);

  app.post(
    '/devices',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['devices'],
        summary: 'Register or refresh an FCM token',
        description:
          'Upserts by fcmToken, re-assigning it to the caller if it belonged to someone else.',
        security: [{ bearerAuth: [] }],
        body: registerDeviceBodySchema,
        response: { 200: deviceSchema },
      },
    },
    async (request) => service.register(requireUserId(request), request.body),
  );

  app.delete(
    '/devices/:deviceId',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['devices'],
        summary: 'Unregister a device',
        security: [{ bearerAuth: [] }],
        params: deviceIdParamsSchema,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      await service.unregister(requireUserId(request), request.params.deviceId);
      return reply.status(204).send();
    },
  );
};
