import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireUserId } from '../../plugins/auth.js';
import { createUserRepository } from './user.repository.js';
import { updateMeBodySchema, userSchema } from './user.schemas.js';
import { createUserService } from './user.service.js';

/** Profile endpoints (Part B §5.1). */
export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createUserService(createUserRepository(app.prisma), app.clock);

  app.get(
    '/users/me',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['users'],
        summary: 'Current user profile',
        security: [{ bearerAuth: [] }],
        response: { 200: userSchema },
      },
    },
    async (request) => service.getMe(requireUserId(request)),
  );

  app.patch(
    '/users/me',
    {
      onRequest: [app.requireAuth],
      schema: {
        tags: ['users'],
        summary: 'Update my name',
        security: [{ bearerAuth: [] }],
        body: updateMeBodySchema,
        response: { 200: userSchema },
      },
    },
    async (request) => service.updateMe(requireUserId(request), request.body),
  );
};
