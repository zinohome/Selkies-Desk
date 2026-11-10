import { z } from 'zod';
import { ballSize, fanCentre, fanReach, fanSize, type Side } from './fan';
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
 * In macOS full screen, system chrome slides over the top of the window only while the pointer is
 * on the very top edge of the screen. The assistive ball is used without going there, so it can
 * sit right at the top of the window. The one case worth avoiding is a display without a camera
 * housing, where the full-screen window starts at the screen edge itself: there the ball stays
 * one menu-bar height down, so reaching for it does not bring the menu bar down on top of it.
 */
export const menuBarReveal = 24;
/** Pixels at the top of a full-screen window that the floating controls keep out of. */
export function fullscreenInset(windowTop: number, displayTop: number) {
  return windowTop > displayTop ? 0 : menuBarReveal;
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
/**
 * `at` is where the ball sits along its edge, as a fraction of that edge (down a side edge,
 * across the top or bottom edge), so it survives resizing. Files written before the ball could
 * rest on all four edges called it `y`.
 */
export const ballSchema = z.preprocess(value => {
  const legacy = value as { side?: unknown; y?: unknown; at?: unknown } | null;
  return legacy && typeof legacy === 'object' && legacy.y !== undefined && legacy.at === undefined ? { side: legacy.side, at: legacy.y } : value;
}, z.object({ side: z.enum(['left', 'right', 'top', 'bottom']), at: z.number().min(0).max(1) }).strict());
export type Ball = { side: Side; at: number };
export const defaultBall: Ball = { side: 'right', at: 0.3 };
type Rect = { x: number; y: number; width: number; height: number };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/**
 * Where the controls sit inside the desktop. `topInset` is the strip macOS covers at the top of a
 * full-screen window; the usable area starts below it. The resting ball keeps enough room along
 * its edge for the arc, so opening never has to move it or cut the arc off. Opened, the view
 * grows around the ball towards the inside of the desktop; the ball's centre stays put.
 */
export function ballBounds(desktop: Rect, ball: Ball, expanded: boolean, topInset = 0): Rect {
  const area = { x: desktop.x, y: desktop.y + topInset, width: desktop.width, height: Math.max(ballSize, desktop.height - topInset) };
  const room = fanReach - ballSize / 2;
  const along = (start: number, length: number) =>
    clamp(start + Math.round(ball.at * length), start + room, Math.max(start + room, start + length - ballSize - room));
  const rest = {
    left: { x: area.x + ballMargin, y: along(area.y, area.height) },
    right: { x: area.x + area.width - ballSize - ballMargin, y: along(area.y, area.height) },
    top: { x: along(area.x, area.width), y: area.y + ballMargin },
    bottom: { x: along(area.x, area.width), y: area.y + area.height - ballSize - ballMargin }
  }[ball.side];
  if (!expanded) return { ...rest, width: ballSize, height: ballSize };
  const centre = fanCentre(ball.side);
  return { x: rest.x + ballSize / 2 - centre.x, y: rest.y + ballSize / 2 - centre.y, ...fanSize(ball.side) };
}
/** While being dragged the ball follows the pointer freely, but never leaves the desktop. */
export function draggedBall(desktop: Rect, start: Rect, dx: number, dy: number, topInset = 0): Rect {
  return {
    x: clamp(start.x + dx, desktop.x, desktop.x + desktop.width - ballSize),
    y: clamp(start.y + dy, desktop.y + topInset, desktop.y + desktop.height - ballSize),
    width: ballSize, height: ballSize
  };
}
/** On release the ball settles against whichever of the four edges is nearest, where it was dropped along it. */
export function snapBall(desktop: Rect, dropped: Rect, topInset = 0): Ball {
  const area = { x: desktop.x, y: desktop.y + topInset, width: desktop.width, height: Math.max(ballSize, desktop.height - topInset) };
  const cx = dropped.x + dropped.width / 2;
  const cy = dropped.y + dropped.height / 2;
  const distance: Record<Side, number> = {
    left: cx - area.x, right: area.x + area.width - cx, top: cy - area.y, bottom: area.y + area.height - cy
  };
  const side = (Object.keys(distance) as Side[]).reduce((nearest, candidate) => distance[candidate] < distance[nearest] ? candidate : nearest);
  const at = side === 'left' || side === 'right'
    ? (dropped.y - area.y) / Math.max(1, area.height)
    : (dropped.x - area.x) / Math.max(1, area.width);
  return { side, at: clamp(at, 0, 1) };
}
