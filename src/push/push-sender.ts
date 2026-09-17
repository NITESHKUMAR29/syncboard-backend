/**
 * Push notifications (Part B §7.4).
 *
 * Data messages, not notification messages, so the Android app decides how to display
 * them. Every value is a string, because that is all FCM data payloads carry.
 */

export const PushType = {
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  MENTIONED: 'MENTIONED',
  WORKSPACE_INVITE: 'WORKSPACE_INVITE',
  TASK_DUE_SOON: 'TASK_DUE_SOON',
} as const;

export type PushTypeValue = (typeof PushType)[keyof typeof PushType];

export interface PushMessage {
  /** Recipients, by user id. The actor is never among them (FR-PUSH-1). */
  userIds: string[];
  data: {
    type: PushTypeValue;
    title: string;
    body: string;
    deepLink: string;
  } & Record<string, string>;
}

export interface PushSender {
  /**
   * Fire-and-forget: sending must never slow down the API response, so callers do not
   * await delivery and failures are logged rather than surfaced.
   */
  send(message: PushMessage): void;
}

export function createNoopPushSender(): PushSender {
  return { send: () => undefined };
}
