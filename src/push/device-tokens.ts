/** How a push sender turns recipients into device tokens. */
export interface DeviceTokenLookup {
  tokensFor(userIds: string[]): Promise<{ userId: string; fcmToken: string }[]>;
  /** FR-PUSH-2: FCM reported these as unregistered, so the rows are dead. */
  forget(fcmTokens: string[]): Promise<void>;
}
