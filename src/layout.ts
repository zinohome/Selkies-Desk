import { z } from 'zod';

export const layoutSchema = z.object({ sidebar: z.boolean(), toolbar: z.boolean() }).strict();
export type Layout = z.infer<typeof layoutSchema>;
export const defaultLayout: Layout = { sidebar: true, toolbar: true };
/** Layout of the management window while no remote desktop is on screen. */
export const homeLayout: Layout = { sidebar: true, toolbar: true };
export const sidebarWidth = 232;
export const toolbarHeight = 52;
/** Height of the slim drag strip that replaces the native title bar in focus mode. */
export const stripHeight = 28;

/**
 * `strip` is the height kept free above the desktop when the toolbar is hidden.
 * It is non-zero only where the app draws its own title bar and is not full screen.
 */
export function desktopBounds(width: number, height: number, layout: Layout, strip = 0) {
  const x = layout.sidebar ? sidebarWidth : 0;
  const y = layout.toolbar ? toolbarHeight : strip;
  return { x, y, width: Math.max(1, width - x), height: Math.max(1, height - y) };
}

/**
 * In macOS full screen, moving the pointer to the top edge slides the system menu bar and
 * the window's title strip over the top of the window, which makes anything placed there
 * impossible to click. This is the height kept clear of our own controls.
 */
export const fullscreenRevealZone = 56;
/** The toolbar would sit entirely inside that zone, so full screen on macOS always uses the floating controls instead. */
export function effectiveLayout(layout: Layout, macFullscreen: boolean): Layout {
  return macFullscreen ? { ...layout, toolbar: false } : { ...layout };
}
/**
 * Bounds of the floating session controls, centred over the desktop. Collapsed, they are a small
 * handle on the top edge. Expanded, the buttons hang `inset` pixels lower so they stay clickable.
 */
export const controlsWidth = 320;
export function controlsBounds(desktop: { x: number; width: number }, expanded: boolean, inset: number) {
  // Only as wide as the pill itself, so the desktop on either side stays clickable.
  const width = expanded ? Math.min(controlsWidth, desktop.width) : 64;
  return { x: desktop.x + Math.round((desktop.width - width) / 2), y: 0, width, height: expanded ? 52 + inset : 22 };
}
