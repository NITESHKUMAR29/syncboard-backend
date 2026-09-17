import type { DeviceTokenLookup } from './device-tokens.js';
import type { PushMessage, PushSender } from './push-sender.js';

export interface PushLogger {
  info: (details: unknown, message: string) => void;
  error: (details: unknown, message: string) => void;
}

/**
 * The default sender (A9): writes what it would have sent to the log, so the project runs
 * with no Firebase account. The payload is identical to what FirebasePushSender delivers,
 * which makes the log a faithful preview of production behaviour.
 */
export function createLoggingPushSender(
  logger: PushLogger,
  devices: DeviceTokenLookup,
): PushSender {
  return {
    send(message: PushMessage) {
      if (message.userIds.length === 0) return;

      // Fire-and-forget: sending must never delay the API response (Part B §7.4).
      void devices
        .tokensFor(message.userIds)
        .then((tokens) => {
          logger.info(
            {
              type: message.data.type,
              recipients: message.userIds.length,
              devices: tokens.length,
              data: message.data,
            },
            'push notification (logging sender)',
          );
        })
        .catch((error: unknown) => {
          logger.error({ err: error }, 'failed to resolve push recipients');
        });
    },
  };
}
