import type { Action, AppState } from '../protocol';
import type {} from './renderer';
import { setLanguage, t } from '../i18n';

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
function render(state: AppState) {
  setLanguage(state.language);
  const keys = state.shortcutLabels;
  control('handle').hidden = state.controlsExpanded;
  control('handle').setAttribute('aria-label', t('controls.expand'));
  control('handle').title = t('controls.expand');
  control('strip').hidden = !state.controlsExpanded;
  control('strip').style.marginTop = `${state.controlsInset}px`;
  control('strip').classList.toggle('floating', state.controlsInset > 0);
  // Full screen on macOS has no toolbar to show, so the button would do nothing there.
  control('toolbar').hidden = state.controlsInset > 0;
  control('strip').setAttribute('aria-label', t('controls.label'));
  control('restore').textContent = t('controls.regular');
  control('sidebar').textContent = t(state.preferredLayout.sidebar ? 'ui.hideSidebar' : 'ui.showSidebar');
  control('sidebar').title = keys.sidebar;
  control('toolbar').textContent = t(state.preferredLayout.toolbar ? 'ui.hideToolbar' : 'ui.showToolbar');
  control('toolbar').title = keys.toolbar;
  control('fullscreen').textContent = t(state.fullscreen ? 'ui.exitFullscreen' : 'ui.enterFullscreen');
  control('fullscreen').title = keys.fullscreen;
  control('reconnect').textContent = t('ui.reconnect');
  control('reconnect').title = keys.reconnect;
  control('disconnect').textContent = t('ui.disconnect');
  control('collapse').setAttribute('aria-label', t('controls.collapse'));
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
