import type { Device } from '../../generated/prisma/client.js';
import type { Database } from '../../plugins/prisma.js';

export interface DeviceRepository {
  upsertByFcmToken(input: {
    id: string;
    userId: string;
    fcmToken: string;
    platform: string;
    now: Date;
  }): Promise<Device>;
  deleteOwnedBy(deviceId: string, userId: string): Promise<number>;
  findTokensForUsers(userIds: string[]): Promise<Device[]>;
  deleteByFcmTokens(fcmTokens: string[]): Promise<void>;
}

export function createDeviceRepository(db: Database): DeviceRepository {
  return {
    upsertByFcmToken({ id, userId, fcmToken, platform, now }) {
      // FR-DEV-1: the token is the identity. If it already exists it is re-assigned to
      // the caller, which is what happens when two people share a device.
      return db.device.upsert({
        where: { fcmToken },
        create: { id, userId, fcmToken, platform, updatedAt: now },
        update: { userId, platform, updatedAt: now },
      });
    },

    async deleteOwnedBy(deviceId, userId) {
      // Scoped to the caller so one user cannot unregister another's device.
      const { count } = await db.device.deleteMany({ where: { id: deviceId, userId } });
      return count;
    },

    findTokensForUsers(userIds) {
      return db.device.findMany({ where: { userId: { in: userIds } } });
    },

    async deleteByFcmTokens(fcmTokens) {
      if (fcmTokens.length === 0) return;
      await db.device.deleteMany({ where: { fcmToken: { in: fcmTokens } } });
    },
  };
}
