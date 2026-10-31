import { PLUGIN_NAME, VERSION } from '../shared/identity.js';
export { ENDPOINT } from '../shared/identity.js';
export const CLIENT_INFO = { name: PLUGIN_NAME, title: 'MakeEpoch Codex', version: VERSION };
export const HANDSHAKE_TIMEOUT_MS = 20_000;
export const MAX_BODY_BYTES = 8 << 20; // 8 MiB (image upload)
export const KILL_GRACE_MS = 3_000;
export const APPROVAL_TIMEOUT_MS = 120_000;
export const EVENT_BUFFER_PER_THREAD = 4_000;
export const MAX_PAGE = 100;
export const MAX_TURNS_PAGE = 50;
