import type { PushMessage, PushSender } from '../../src/push/push-sender.js';

/** Records what would have been sent, so tests can assert on recipients and payload. */
export interface FakePushSender extends PushSender {
  readonly sent: PushMessage[];
  /** Messages of one type, for readable assertions. */
  ofType(type: string): PushMessage[];
  clear(): void;
}

export function createFakePushSender(): FakePushSender {
  const sent: PushMessage[] = [];

  return {
    sent,
    send(message: PushMessage) {
      sent.push(message);
    },
    ofType(type: string) {
      return sent.filter((message) => message.data.type === type);
    },
    clear() {
      sent.length = 0;
    },
  };
}
