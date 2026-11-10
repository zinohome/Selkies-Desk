/** Chromium network errors worth retrying; certificate, authentication and blocked requests are not. */
const retryableCodes = new Set([-7, -15, -21, -100, -101, -102, -104, -105, -106, -108, -109, -118, -137, -324]);
export const retryable = (code: number) => retryableCodes.has(code);
export const maxRetries = 6;
/** Seconds to wait before the given attempt (1-based): 2, 4, 8, 16, then 30. */
export const retryDelay = (attempt: number) => Math.min(30, 2 ** attempt);
