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
/** Size of the opened view: the half ring plus the ball's own half on the edge side. */
export const fanSize = { width: ballSize / 2 + fanReach, height: 2 * fanReach };
/** Angle between neighbouring buttons, wide enough that they never touch. */
const stepDegrees = 41;

/** Centre of the ball inside the opened view. */
export function fanCentre(side: 'left' | 'right') {
  return { x: side === 'left' ? ballSize / 2 : fanSize.width - ballSize / 2, y: fanReach };
}
/** Centres of `count` buttons, top to bottom, spread evenly around the inward direction. */
export function fanPositions(count: number, side: 'left' | 'right') {
  const centre = fanCentre(side);
  const inward = side === 'left' ? 1 : -1;
  return Array.from({ length: count }, (_unused, index) => {
    const angle = (index - (count - 1) / 2) * stepDegrees * Math.PI / 180;
    return { x: centre.x + inward * fanRadius * Math.cos(angle), y: centre.y + fanRadius * Math.sin(angle) };
  });
}

/**
 * SVG path of the band behind `count` buttons: an arc centred on the ball that covers exactly the
 * buttons, to be stroked `2 * fanBand` wide with round caps so both ends are rounded.
 */
export function fanArc(count: number, side: 'left' | 'right') {
  const points = fanPositions(count, side);
  const first = points[0];
  const last = points[points.length - 1];
  const round = (value: number) => Math.round(value * 100) / 100;
  // Drawn top to bottom: clockwise when the ball is on the right edge, counter-clockwise on the left.
  return `M ${round(first.x)} ${round(first.y)} A ${fanRadius} ${fanRadius} 0 0 ${side === 'left' ? 1 : 0} ${round(last.x)} ${round(last.y)}`;
}
