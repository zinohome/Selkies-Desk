/**
 * Video settings the app applies to a Selkies connection.
 *
 * The Selkies web client keeps the user's own picks in localStorage, under a prefix derived from
 * the page address, and sends them to the server when the stream starts. Writing the same keys
 * before the page's scripts run is therefore the same as picking the values in its settings panel.
 * The server still has the last word: a value outside what it allows, or a setting it has locked,
 * falls back to the server's own.
 */
export const videoEncoders = ['h264enc', 'h265enc', 'av1enc', 'vp9enc', 'vp8enc', 'jpeg'] as const;
export type VideoEncoder = typeof videoEncoders[number];
export type VideoSettings = { encoder: VideoEncoder; framerate: number; rateControl: 'cbr' | 'crf'; bitrateMbps: number };
export const videoEncoderNames: Record<VideoEncoder, string> = {
  h264enc: 'H.264', h265enc: 'H.265 (HEVC)', av1enc: 'AV1', vp9enc: 'VP9', vp8enc: 'VP8', jpeg: 'JPEG'
};

/** The client's storage namespace for a page: origin plus path, with everything but letters, digits, `.`, `_` and `-` replaced. */
export function storagePrefix(origin: string, pathname: string) {
  return `${origin}${pathname}`.replace(/[^a-zA-Z0-9._-]/g, '_');
}
/** The localStorage entries that express these settings as the user's picks. Bitrate is stored in kbit/s. */
export function videoStorage(prefix: string, video: VideoSettings): Record<string, string> {
  return {
    [`${prefix}_encoder`]: video.encoder,
    [`${prefix}_framerate`]: String(video.framerate),
    [`${prefix}_rate_control_mode`]: video.rateControl,
    [`${prefix}_rate_control_mode_explicit_choice`]: 'true',
    [`${prefix}_video_bitrate`]: String(video.bitrateMbps * 1000)
  };
}
/** Keys under which the client parks a pick it has temporarily replaced; left in place they would undo ours. */
export function heldPickKeys(prefix: string) {
  return ['encoder', 'framerate', 'rate_control_mode', 'video_bitrate'].map(name => `${prefix}_${name}_pick`);
}
export const videoArgument = '--selkies-desk-video=';
export function encodeVideoArgument(origin: string, video: VideoSettings) {
  return `${videoArgument}${Buffer.from(JSON.stringify({ origin, video })).toString('base64')}`;
}
