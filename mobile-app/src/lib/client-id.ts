import * as Crypto from 'expo-crypto';

// Per-launch id. Sent as x-client-id on every API write so the live-sync
// firehose can echo-suppress this device's own mutations (same trick as the
// web app's per-tab id).
export const CLIENT_ID = Crypto.randomUUID();
