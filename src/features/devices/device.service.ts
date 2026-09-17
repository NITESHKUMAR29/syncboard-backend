import { randomUUID } from 'node:crypto';
import type { Clock } from '../../common/clock.js';
import { NotFoundError } from '../../common/errors.js';
import type { DeviceRepository } from './device.repository.js';
import type { DeviceDto, RegisterDeviceBody } from './device.schemas.js';

export interface DeviceService {
  register(userId: string, body: RegisterDeviceBody): Promise<DeviceDto>;
  unregister(userId: string, deviceId: string): Promise<void>;
}

export function createDeviceService(repository: DeviceRepository, clock: Clock): DeviceService {
  return {
    async register(userId, body) {
      const device = await repository.upsertByFcmToken({
        id: randomUUID(),
        userId,
        fcmToken: body.fcmToken,
        platform: body.platform,
        now: clock.now(),
      });

      return { id: device.id };
    },

    async unregister(userId, deviceId) {
      const deleted = await repository.deleteOwnedBy(deviceId, userId);

      // FR-DEV-2: someone else's device is indistinguishable from one that never existed.
      if (deleted === 0) throw new NotFoundError('Device not found');
    },
  };
}
