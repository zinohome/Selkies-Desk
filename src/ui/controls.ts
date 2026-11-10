import type { Action, AppState } from '../protocol';
import type {} from './renderer';
import { setLanguage, t } from '../i18n';
import { icon, type IconName } from './icons';

const control = (id: string) => document.getElementById(id) as HTMLButtonElement;
const ball = control('ball');
let collapseTimer: ReturnType<typeof setTimeout>;
let inside = false;
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
    target.replaceChildren(icon(name, 18));
    target.dataset.icon = name;
  }
  target.setAttribute('aria-label', text);
  target.title = shortcut ? `${text} · ${shortcut}` : text;
}
function render(state: AppState) {
  setLanguage(state.language);
  const keys = state.shortcutLabels;
  document.body.className = state.ballSide;
  ball.hidden = state.controlsExpanded;
  ball.setAttribute('aria-label', t('controls.expand'));
  ball.title = t('controls.expand');
  control('strip').hidden = !state.controlsExpanded;
  control('strip').setAttribute('aria-label', t('controls.label'));
  // Full screen always shows the desktop alone, so the layout buttons would do nothing there.
  for (const id of ['restore', 'sidebar', 'toolbar', 'layout-separator']) control(id).hidden = state.fullscreen;
  label('restore', 'regular', t('controls.regular'), keys.focus);
  label('sidebar', 'panelLeft', t(state.preferredLayout.sidebar ? 'ui.hideSidebar' : 'ui.showSidebar'), keys.sidebar);
  label('toolbar', 'panelTop', t(state.preferredLayout.toolbar ? 'ui.hideToolbar' : 'ui.showToolbar'), keys.toolbar);
  label('fullscreen', state.fullscreen ? 'minimize' : 'maximize', t(state.fullscreen ? 'ui.exitFullscreen' : 'ui.enterFullscreen'), keys.fullscreen);
  label('reconnect', 'reconnect', t('ui.reconnect'), keys.reconnect);
  label('disconnect', 'disconnect', t('ui.disconnect'));
  label('collapse', 'close', t('controls.collapse'));
}

// A press that moves is a drag; a press that stays put opens the controls.
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
  void invoke({ type: 'controls', expanded: true });
};

for (const target of ['restore', 'sidebar', 'toolbar'] as const) control(target).onclick = () => { void invoke({ type: 'layout', target }); };
for (const type of ['fullscreen', 'reconnect', 'disconnect'] as const) control(type).onclick = () => { void invoke({ type }); };
control('collapse').onclick = () => { void invoke({ type: 'controls', expanded: false }); };
document.documentElement.onmouseenter = () => { inside = true; clearTimeout(collapseTimer); };
document.documentElement.onmouseleave = () => { inside = false; collapseSoon(1500); };
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') void invoke({ type: 'controls', expanded: false });
});
window.desk.onState(render);
void invoke({ type: 'state' });
