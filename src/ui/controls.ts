import type { Action, AppState } from '../protocol';
import type {} from './renderer';
import { setLanguage, t } from '../i18n';
import { icon, type IconName } from './icons';
import { ballSize, fanArc, fanBand, fanCentre, fanPositions, fanSize } from '../fan';

const control = (id: string) => document.getElementById(id) as HTMLButtonElement;
const ball = control('ball');
let collapseTimer: ReturnType<typeof setTimeout>;
let inside = false;
let expanded = false;
const buttons = ['restore', 'fullscreen', 'reconnect', 'disconnect'];
async function invoke(action: Action) {
  const result = await window.desk.invoke(action);
  if (result.state) render(result.state);
}
function collapseSoon(delay: number) {
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    if (!inside) void invoke({ type: 'controls', expanded: false });
  }, delay);
}
/** Icon button whose name is exposed to assistive technology and shown as a tooltip. */
function label(id: string, name: IconName, text: string, shortcut = '') {
  const target = control(id);
  if (target.dataset.icon !== name) {
    target.replaceChildren(icon(name, 16));
    target.dataset.icon = name;
  }
  target.setAttribute('aria-label', text);
  target.title = shortcut ? `${text} · ${shortcut}` : text;
}
const place = (target: HTMLElement, point: { x: number; y: number }) => {
  target.style.left = `${point.x}px`;
  target.style.top = `${point.y}px`;
};
function render(state: AppState) {
  setLanguage(state.language);
  const keys = state.shortcutLabels;
  const open = state.controlsExpanded;
  expanded = open;
  // Collapsed, the view is exactly the ball. Opened, it grows around the ball, which stays where it was.
  place(ball, open ? fanCentre(state.ballSide) : { x: ballSize / 2, y: ballSize / 2 });
  ball.classList.toggle('open', open);
  ball.setAttribute('aria-label', t(open ? 'controls.collapse' : 'controls.expand'));
  ball.setAttribute('aria-expanded', String(open));
  ball.title = t(open ? 'controls.collapse' : 'controls.expand');
  control('strip').hidden = !open;
  control('strip').setAttribute('aria-label', t('controls.label'));
  // Full screen always shows the desktop alone, so the layout buttons would do nothing there.
  control('restore').hidden = state.fullscreen;
  label('restore', 'regular', t('controls.regular'), keys.focus);
  label('fullscreen', state.fullscreen ? 'minimize' : 'maximize', t(state.fullscreen ? 'ui.exitFullscreen' : 'ui.enterFullscreen'), keys.fullscreen);
  label('reconnect', 'reconnect', t('ui.reconnect'), keys.reconnect);
  label('disconnect', 'disconnect', t('ui.disconnect'));
  if (!open) return;
  const shown = buttons.map(control).filter(target => !target.hidden);
  fanPositions(shown.length, state.ballSide).forEach((point, index) => {
    place(shown[index], point);
    shown[index].style.animationDelay = `${index * 22}ms`;
  });
  // The band behind the buttons: an arc around the ball that covers just the buttons, with round ends.
  const path = fanArc(shown.length, state.ballSide);
  const ring = control('ring');
  if (ring.dataset.path !== path) {
    ring.dataset.path = path;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(fanSize.width));
    svg.setAttribute('height', String(fanSize.height));
    for (const [stroke, width] of [['#ffffff38', 2 * fanBand + 2], ['#1f2229', 2 * fanBand]] as const) {
      const band = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      band.setAttribute('d', path);
      band.setAttribute('fill', 'none');
      band.setAttribute('stroke', stroke);
      band.setAttribute('stroke-width', String(width));
      band.setAttribute('stroke-linecap', 'round');
      svg.append(band);
    }
    ring.replaceChildren(svg);
  }
}

// A press that moves is a drag; a press that stays put opens or closes the controls.
let press: { x: number; y: number; dragging: boolean } | undefined;
let frame = 0;
let suppressClick = false;
ball.onpointerdown = event => {
  if (event.button !== 0) return;
  ball.setPointerCapture(event.pointerId);
  press = { x: event.screenX, y: event.screenY, dragging: false };
};
ball.onpointermove = event => {
  if (!press) return;
  const dx = event.screenX - press.x;
  const dy = event.screenY - press.y;
  if (!press.dragging && Math.hypot(dx, dy) < 5) return;
  press.dragging = true;
  ball.classList.add('dragging');
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => { void window.desk.invoke({ type: 'ballDrag', dx, dy, done: false }); });
};
function release(event: PointerEvent) {
  if (!press) return;
  const { dragging, x, y } = press;
  press = undefined;
  cancelAnimationFrame(frame);
  ball.classList.remove('dragging');
  if (!dragging) return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  void invoke({ type: 'ballDrag', dx: event.screenX - x, dy: event.screenY - y, done: true });
}
ball.onpointerup = release;
ball.onpointercancel = release;
// `click` also covers the keyboard; the click that ends a drag must not open the controls.
ball.onclick = () => {
  if (suppressClick) { suppressClick = false; return; }
  clearTimeout(collapseTimer);
  void invoke({ type: 'controls', expanded: !expanded });
};

control('restore').onclick = () => { void invoke({ type: 'layout', target: 'restore' }); };
for (const type of ['fullscreen', 'reconnect', 'disconnect'] as const) control(type).onclick = () => { void invoke({ type }); };
document.documentElement.onmouseenter = () => { inside = true; clearTimeout(collapseTimer); };
document.documentElement.onmouseleave = () => { inside = false; collapseSoon(1500); };
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') void invoke({ type: 'controls', expanded: false });
});
window.desk.onState(render);
void invoke({ type: 'state' });
