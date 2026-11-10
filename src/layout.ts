import { z } from 'zod';
import { ballSize, fanReach, fanSize } from './fan';
export { ballSize };

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
 * In macOS full screen, moving the pointer to the top edge slides system chrome over the top of
 * the window, and nothing underneath can be clicked while the pointer is on it.
 * - The window's own title strip always slides in: measured at 31 px, kept clear with a margin.
 * - The menu bar slides in above it. On a display with a camera housing the full-screen window
 *   starts below that band, so the menu bar stays outside the window and costs nothing.
 */
export const titleStripReveal = 34;
export const menuBarReveal = 24;
/** Pixels the full-screen controls must hang below the top of the window to stay clickable. */
export function fullscreenInset(windowTop: number, displayTop: number) {
  return titleStripReveal + (windowTop > displayTop ? 0 : menuBarReveal);
}
/**
 * Full screen means the desktop alone: no sidebar and no toolbar, whatever the saved preference.
 * On macOS the toolbar could not be used there anyway, because it would sit inside the reveal zone.
 */
export function effectiveLayout(layout: Layout, fullscreen: boolean): Layout {
  return fullscreen ? { sidebar: false, toolbar: false } : { ...layout };
}
/**
 * The floating session controls are an assistive ball, like the one on phones: a small round
 * button that rests against the left or right edge of the desktop, can be dragged along it, and
 * opens an arc of buttons around itself when clicked. Nothing depends on the top of the screen.
 */
const ballMargin = 10;
export const ballSchema = z.object({ side: z.enum(['left', 'right']), y: z.number().min(0).max(1) }).strict();
/** `y` is the top of the ball as a fraction of the desktop height, so it survives resizing. */
export type Ball = z.infer<typeof ballSchema>;
export const defaultBall: Ball = { side: 'right', y: 0.3 };
type Rect = { x: number; y: number; width: number; height: number };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/**
 * Where the controls sit inside the desktop. The resting ball keeps enough room above and below
 * for its arc, so opening never has to move it. `topInset` is the strip macOS covers at the top
 * of a full-screen window. Opened, the view grows around the ball; the ball's centre stays put.
 */
export function ballBounds(desktop: Rect, ball: Ball, expanded: boolean, topInset = 0): Rect {
  const room = fanReach - ballSize / 2;
  const top = desktop.y + topInset + room;
  const bottom = Math.max(top, desktop.y + desktop.height - ballSize - room);
  const rest = {
    x: ball.side === 'left' ? desktop.x + ballMargin : desktop.x + desktop.width - ballSize - ballMargin,
    y: clamp(desktop.y + Math.round(ball.y * desktop.height), top, bottom),
    width: ballSize, height: ballSize
  };
  if (!expanded) return rest;
  return {
    x: ball.side === 'left' ? rest.x : rest.x + ballSize - fanSize.width,
    y: rest.y - room, width: fanSize.width, height: fanSize.height
  };
}
/** While being dragged the ball follows the pointer freely, but never leaves the desktop. */
export function draggedBall(desktop: Rect, start: Rect, dx: number, dy: number, topInset = 0): Rect {
  return {
    x: clamp(start.x + dx, desktop.x, desktop.x + desktop.width - ballSize),
    y: clamp(start.y + dy, desktop.y + topInset, desktop.y + desktop.height - ballSize),
    width: ballSize, height: ballSize
  };
}
/** On release the ball settles against whichever side edge is nearer and keeps its height. */
export function snapBall(desktop: Rect, dropped: Rect): Ball {
  const centre = dropped.x + dropped.width / 2;
  return {
    side: centre < desktop.x + desktop.width / 2 ? 'left' : 'right',
    y: clamp((dropped.y - desktop.y) / Math.max(1, desktop.height), 0, 1)
  };
}
