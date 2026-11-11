import { z } from 'zod';
import { connectionSchema, connectionID, settingsPatchSchema, type Connection, type Settings } from './model';
import type { Language } from './i18n';
import { commands, type OS, type Shortcuts } from './platform';
import type { Layout } from './layout';
import type { Side } from './fan';
import type { UpdateState } from './updater';

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state') }).strict(),
  z.object({ type: z.literal('save'), connection: connectionSchema }).strict(),
  z.object({ type: z.literal('delete'), id: connectionID }).strict(),
  z.object({ type: z.literal('connect'), id: connectionID }).strict(),
  z.object({ type: z.literal('disconnect') }).strict(),
  z.object({ type: z.literal('reconnect') }).strict(),
  z.object({ type: z.literal('fullscreen') }).strict(),
  z.object({ type: z.literal('layout'), target: z.enum(['sidebar', 'toolbar', 'focus', 'restore']) }).strict(),
  z.object({ type: z.literal('controls'), expanded: z.boolean() }).strict(),
  // Dragging the assistive ball: offset from where the drag started; `done` drops it.
  z.object({ type: z.literal('ballDrag'), dx: z.number().min(-20000).max(20000), dy: z.number().min(-20000).max(20000), done: z.boolean() }).strict(),
  z.object({ type: z.literal('modal'), open: z.boolean() }).strict(),
  z.object({ type: z.literal('clearPassword'), id: connectionID }).strict(),
  z.object({ type: z.literal('revokeCertificate'), id: connectionID }).strict(),
  z.object({ type: z.literal('export') }).strict(),
  z.object({ type: z.literal('import') }).strict(),
  z.object({ type: z.literal('settings'), settings: settingsPatchSchema }).strict(),
  // `accelerator: null` restores the default for that command.
  z.object({ type: z.literal('shortcut'), command: z.enum(commands), accelerator: z.string().max(60).nullable() }).strict(),
  // While the settings page records a new shortcut, key presses must reach it untouched.
  z.object({ type: z.literal('recording'), active: z.boolean() }).strict(),
  z.object({ type: z.literal('thumbnail'), id: connectionID }).strict(),
  z.object({ type: z.literal('update'), step: z.enum(['check', 'download', 'install', 'notes']) }).strict(),
  z.object({
    type: z.literal('answer'), token: z.uuid(),
    accept: z.boolean(), username: z.string().max(200).optional(),
    password: z.string().max(4096).optional(), remember: z.boolean().optional()
  }).strict()
]);
export type Action = z.infer<typeof actionSchema>;
export type Answer = Extract<Action, { type: 'answer' }>;
export type Prompt = {
  type: 'auth' | 'certificate';
  token: string;
  origin: string;
  username?: string;
  retry?: boolean;
  fingerprint?: string;
  error?: string;
  subject?: string;
  issuer?: string;
  validExpiry?: number;
};
export type RemoteStatus = { id?: string; phase: 'idle' | 'loading' | 'loaded' | 'disconnected' | 'failed' | 'waiting'; detail: string; /** When the current session became usable (epoch ms); shown as elapsed time. */ since?: number };
export type AppState = {
  /** `thumbnail` is a cache key (0 = none); the image itself is fetched with the `thumbnail` action. */
  connections: (Connection & { savedPassword: boolean; certificateTrusted: boolean; thumbnail: number })[];
  status: RemoteStatus;
  prompt?: Prompt;
  fullscreen: boolean;
  encryptionAvailable: boolean;
  layout: Layout;
  preferredLayout: Layout;
  controlsExpanded: boolean;
  /** Strip at the top of the desktop the floating controls keep out of (macOS full screen). */
  controlsInset: number;
  /** Which edge the assistive ball rests against; the opened row grows away from it. */
  ballSide: Side;
  platform: { os: OS; name: string; /** The app draws its own title bar (macOS). */ integratedTitleBar: boolean };
  version: string;
  update: UpdateState;
  language: Language;
  settings: Settings;
  shortcuts: Shortcuts;
  /** Shortcut text for tooltips, already formatted for this platform. */
  shortcutLabels: Shortcuts;
};
export type Result = { ok: boolean; error?: string; state?: AppState; id?: string; text?: string; count?: number; message?: string };
