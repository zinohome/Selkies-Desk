/**
 * Geometry of the assistive ball and the arc of buttons that opens around it.
 * The ball rests against a side edge of the desktop; the buttons sit on a half ring that wraps
 * the ball on the inward side, so the ball itself never moves when the menu opens.
 */
export const ballSize = 44;
/** Distance from the centre of the ball to the centre of each button: the band hugs the ball with a 7 px gap. */
export const fanRadius = 46;
export const fanItem = 30;
/** Half the thickness of the ring the buttons sit on. */
export const fanBand = 19;
/** Furthest drawn point from the centre of the ball. */
export const fanReach = fanRadius + fanBand + 3;
/** Angle between neighbouring buttons, wide enough that they never touch. */
const stepDegrees = 41;
export type Side = 'left' | 'right' | 'top' | 'bottom';
const vertical = (side: Side) => side === 'left' || side === 'right';
/** Unit vector pointing from the edge into the desktop. */
const inward = (side: Side) => ({ left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] })[side];

/** Size of the opened view: the half ring on the inward side plus the ball's own half on the edge side. */
export function fanSize(side: Side) {
  const deep = ballSize / 2 + fanReach;
  return vertical(side) ? { width: deep, height: 2 * fanReach } : { width: 2 * fanReach, height: deep };
}
/** Centre of the ball inside the opened view. */
export function fanCentre(side: Side) {
  const size = fanSize(side);
  const half = ballSize / 2;
  return {
    left: { x: half, y: fanReach }, right: { x: size.width - half, y: fanReach },
    top: { x: fanReach, y: half }, bottom: { x: fanReach, y: size.height - half }
  }[side];
}
/**
 * Centres of `count` buttons spread evenly around the inward direction, in reading order:
 * top to bottom beside a side edge, left to right below the top edge or above the bottom edge.
 */
export function fanPositions(count: number, side: Side) {
  const centre = fanCentre(side);
  const [ix, iy] = inward(side);
  const [tx, ty] = vertical(side) ? [0, 1] : [1, 0];
  return Array.from({ length: count }, (_unused, index) => {
    const angle = (index - (count - 1) / 2) * stepDegrees * Math.PI / 180;
    const along = fanRadius * Math.sin(angle);
    const out = fanRadius * Math.cos(angle);
    return { x: centre.x + ix * out + tx * along, y: centre.y + iy * out + ty * along };
  });
}
/**
 * SVG path of the band behind `count` buttons: an arc centred on the ball that covers exactly the
 * buttons, to be stroked `2 * fanBand` wide with round caps so both ends are rounded.
 */
export function fanArc(count: number, side: Side) {
  const centre = fanCentre(side);
  const points = fanPositions(count, side);
  const first = points[0];
  const last = points[points.length - 1];
  const round = (value: number) => Math.round(value * 100) / 100;
  // In screen coordinates a positive cross product means the short way round is clockwise.
  const cross = (first.x - centre.x) * (last.y - centre.y) - (first.y - centre.y) * (last.x - centre.x);
  return `M ${round(first.x)} ${round(first.y)} A ${fanRadius} ${fanRadius} 0 0 ${cross > 0 ? 1 : 0} ${round(last.x)} ${round(last.y)}`;
}
