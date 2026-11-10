import { z } from 'zod';

export const layoutSchema = z.object({ sidebar: z.boolean(), toolbar: z.boolean() }).strict();
export type Layout = z.infer<typeof layoutSchema>;
export const defaultLayout: Layout = { sidebar: true, toolbar: true };

export function desktopBounds(width: number, height: number, layout: Layout) {
  const x = layout.sidebar ? 232 : 0;
  const y = layout.toolbar ? 52 : 0;
  return { x, y, width: Math.max(1, width - x), height: Math.max(1, height - y) };
}
