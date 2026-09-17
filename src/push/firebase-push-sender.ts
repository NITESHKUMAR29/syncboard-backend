import type { App } from 'firebase-admin/app';
import type { DeviceTokenLookup } from './device-tokens.js';
import type { PushMessage, PushSender } from './push-sender.js';
import type { PushLogger } from './logging-push-sender.js';

/**
 * FCM data messages (Part B §7.4).
 *
 * Data messages, not notification messages, so the Android app decides how and whether to
 * display each one. Every value must be a string: FCM data payloads carry nothing else.
 */

const UNREGISTERED_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Decodes the base64 service account in FIREBASE_CREDENTIALS_JSON.
 *
 * firebase-admin is imported here rather than at module scope, so a deployment with no
 * push credentials never loads it.
 */
export async function createFirebaseApp(credentialsBase64: string): Promise<App> {
  const { cert, getApps, initializeApp } = await import('firebase-admin/app');

  const existing = getApps()[0];
  if (existing) return existing;

  const json: unknown = JSON.parse(Buffer.from(credentialsBase64, 'base64').toString('utf8'));

  return initializeApp({ credential: cert(json as Parameters<typeof cert>[0]) });
}

export async function createFirebasePushSender(
  app: App,
  devices: DeviceTokenLookup,
  logger: PushLogger,
): Promise<PushSender> {
  const { getMessaging } = await import('firebase-admin/messaging');
  const messaging = getMessaging(app);

  return {
    send(message: PushMessage) {
      if (message.userIds.length === 0) return;

      void deliver(message).catch((error: unknown) => {
        // A failed notification must never surface as a failed API request.
        logger.error({ err: error, type: message.data.type }, 'push delivery failed');
      });
    },
  };

  async function deliver(message: PushMessage): Promise<void> {
    const rows = await devices.tokensFor(message.userIds);
    if (rows.length === 0) return;

    const tokens = rows.map((row) => row.fcmToken);

    const response = await messaging.sendEachForMulticast({
      tokens,
      data: message.data,
      android: { priority: 'high' },
    });

    // FR-PUSH-2: tokens FCM rejects as unregistered belong to uninstalled apps and will
    // never work again, so the rows go.
    const dead = response.responses.flatMap((result, index) => {
      if (result.success) return [];

      const code = result.error?.code;
      const token = tokens[index];

      return code && UNREGISTERED_CODES.has(code) && token ? [token] : [];
    });

    if (dead.length > 0) {
      await devices.forget(dead);
      logger.info({ count: dead.length }, 'removed unregistered device tokens');
    }
  }
}
