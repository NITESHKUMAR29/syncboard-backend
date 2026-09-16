import { z } from 'zod';

/** GET /health (Part B §8): { "status": "UP", "database": "UP", "version": "1.4.0" } */
export const healthResponseSchema = z.object({
  status: z.literal('UP'),
  database: z.enum(['UP', 'DOWN']),
  version: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
