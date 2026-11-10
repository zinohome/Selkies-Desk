import type { Action, AppState } from '../protocol';
import type {} from './renderer';
import { setLanguage, t } from '../i18n';
import { icon, type IconName } from './icons';

const control = (id: string) => document.getElementById(id) as HTMLButtonElement;
let collapseTimer: ReturnType<typeof setTimeout>;
async function invoke(action: Action) {
  const result = await window.desk.invoke(action);
  if (result.state) render(result.state);
}
function expand() {
  clearTimeout(collapseTimer);
  void invoke({ type: 'controls', expanded: true });
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
  control('handle').hidden = state.controlsExpanded;
  control('handle').setAttribute('aria-label', t('controls.expand'));
  control('handle').title = t('controls.expand');
  control('strip').hidden = !state.controlsExpanded;
  control('strip').setAttribute('aria-label', t('controls.label'));
  control('strip').style.marginTop = `${state.controlsInset + 5}px`;
  // Full screen on macOS has no toolbar to show, so the button would do nothing there.
  control('toolbar').hidden = state.controlsInset > 0;
  label('restore', 'regular', t('controls.regular'), keys.focus);
  label('sidebar', 'panelLeft', t(state.preferredLayout.sidebar ? 'ui.hideSidebar' : 'ui.showSidebar'), keys.sidebar);
  label('toolbar', 'panelTop', t(state.preferredLayout.toolbar ? 'ui.hideToolbar' : 'ui.showToolbar'), keys.toolbar);
  label('fullscreen', state.fullscreen ? 'minimize' : 'maximize', t(state.fullscreen ? 'ui.exitFullscreen' : 'ui.enterFullscreen'), keys.fullscreen);
  label('reconnect', 'reconnect', t('ui.reconnect'), keys.reconnect);
  label('disconnect', 'disconnect', t('ui.disconnect'));
  label('collapse', 'collapse', t('controls.collapse'));
}
control('handle').onclick = expand;
control('handle').onmouseenter = expand;
control('handle').onfocus = expand;
for (const target of ['restore', 'sidebar', 'toolbar'] as const) control(target).onclick = () => { void invoke({ type: 'layout', target }); };
for (const type of ['fullscreen', 'reconnect', 'disconnect'] as const) control(type).onclick = () => { void invoke({ type }); };
control('collapse').onclick = () => { void invoke({ type: 'controls', expanded: false }); };
document.body.onmouseenter = () => clearTimeout(collapseTimer);
document.body.onmouseleave = () => {
  collapseTimer = setTimeout(() => {
    if (!document.hasFocus()) void invoke({ type: 'controls', expanded: false });
  }, 650);
};
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') void invoke({ type: 'controls', expanded: false });
});
window.desk.onState(render);
void invoke({ type: 'state' });
