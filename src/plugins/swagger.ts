import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import type { Env } from '../config/env.js';

/**
 * OpenAPI generation (Part B §2).
 *
 * The document is produced from the same Zod schemas that validate requests, so the
 * published contract cannot drift from the code. `npm run openapi:export` writes it to
 * openapi.yaml.
 */

export const OPENAPI_VERSION = '1.0.0';

export async function registerSwagger(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'TaskFlow API',
        description:
          'REST and WebSocket API for the TaskFlow Android app. All paths are relative to /api/v1.',
        version: OPENAPI_VERSION,
      },
      servers: [
        { url: 'http://localhost:8080/api/v1', description: 'Local development' },
        { url: 'http://10.0.2.2:8080/api/v1', description: 'Android emulator host loopback' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Access token from /auth/login or /auth/register.',
          },
        },
      },
      tags: [
        { name: 'health', description: 'Liveness and readiness' },
        { name: 'auth', description: 'Registration, login and token rotation' },
        { name: 'users', description: 'Profile and avatar' },
        { name: 'devices', description: 'FCM device registration' },
        { name: 'workspaces', description: 'Workspaces, members and labels' },
        { name: 'boards', description: 'Boards' },
        { name: 'tasks', description: 'Tasks' },
        { name: 'comments', description: 'Comments' },
        { name: 'attachments', description: 'File attachments' },
        { name: 'activity', description: 'Activity feed' },
        { name: 'sync', description: 'Delta sync' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  if (env.ENABLE_SWAGGER_UI) {
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true },
    });
  }
}
