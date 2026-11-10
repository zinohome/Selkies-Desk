import { z } from 'zod';
import { connectionSchema, connectionID, type Connection } from './model';
import type { Layout } from './layout';

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
  z.object({ type: z.literal('modal'), open: z.boolean() }).strict(),
  z.object({ type: z.literal('clearPassword'), id: connectionID }).strict(),
  z.object({ type: z.literal('revokeCertificate'), id: connectionID }).strict(),
  z.object({ type: z.literal('export') }).strict(),
  z.object({ type: z.literal('import') }).strict(),
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
export type RemoteStatus = { id?: string; phase: 'idle' | 'loading' | 'loaded' | 'disconnected' | 'failed'; detail: string };
export type AppState = {
  connections: (Connection & { savedPassword: boolean; certificateTrusted: boolean })[];
  status: RemoteStatus;
  prompt?: Prompt;
  fullscreen: boolean;
  encryptionAvailable: boolean;
  layout: Layout;
  preferredLayout: Layout;
  controlsExpanded: boolean;
};
export type Result = { ok: boolean; error?: string; state?: AppState; id?: string; text?: string; count?: number; message?: string };
