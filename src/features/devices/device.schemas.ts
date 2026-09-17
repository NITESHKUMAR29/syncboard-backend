import { z } from 'zod';

/** Device registration for push (Part B §5.2). */

export const registerDeviceBodySchema = z.object({
  fcmToken: z.string().min(1).max(4096),
  platform: z.string().min(1).max(20).default('ANDROID'),
});

export const deviceSchema = z.object({
  id: z.string().uuid(),
});

export const deviceIdParamsSchema = z.object({
  deviceId: z.string().uuid(),
});

export type RegisterDeviceBody = z.infer<typeof registerDeviceBodySchema>;
export type DeviceDto = z.infer<typeof deviceSchema>;
