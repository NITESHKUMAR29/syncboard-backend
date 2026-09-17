import type { Env } from '../config/env.js';
import type { Database } from '../plugins/prisma.js';
import { createDeviceRepository } from '../features/devices/device.repository.js';
import type { DeviceTokenLookup } from './device-tokens.js';
import { createFirebaseApp, createFirebasePushSender } from './firebase-push-sender.js';
import { createLoggingPushSender, type PushLogger } from './logging-push-sender.js';
import type { PushSender } from './push-sender.js';

/**
 * A9: Firebase when FIREBASE_CREDENTIALS_JSON is set, otherwise the logging sender, so
 * the project runs with no paid account.
 */
export async function createPushSender(
  env: Env,
  db: Database,
  logger: PushLogger,
): Promise<PushSender> {
  const devices = createDeviceTokenLookup(db);

  if (!env.FIREBASE_CREDENTIALS_JSON) {
    return createLoggingPushSender(logger, devices);
  }

  try {
    return await createFirebasePushSender(
      await createFirebaseApp(env.FIREBASE_CREDENTIALS_JSON),
      devices,
      logger,
    );
  } catch (error) {
    // Bad credentials should not stop the server booting: everything except push still
    // works, and the log says exactly what is wrong.
    logger.error({ err: error }, 'invalid Firebase credentials, falling back to logged pushes');
    return createLoggingPushSender(logger, devices);
  }
}

export function createDeviceTokenLookup(db: Database): DeviceTokenLookup {
  const repository = createDeviceRepository(db);

  return {
    async tokensFor(userIds) {
      if (userIds.length === 0) return [];

      const devices = await repository.findTokensForUsers(userIds);
      return devices.map((device) => ({ userId: device.userId, fcmToken: device.fcmToken }));
    },

    forget(fcmTokens) {
      return repository.deleteByFcmTokens(fcmTokens);
    },
  };
}
