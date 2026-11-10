import type { Action, AppState } from '../protocol';
import type {} from './renderer';

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
  control('handle').hidden = state.controlsExpanded;
  control('strip').hidden = !state.controlsExpanded;
  control('sidebar').textContent = state.preferredLayout.sidebar ? '隐藏侧栏' : '显示侧栏';
  control('toolbar').textContent = state.preferredLayout.toolbar ? '隐藏工具栏' : '显示工具栏';
  control('fullscreen').textContent = state.fullscreen ? '退出全屏' : '进入全屏';
  const keys = state.platform.labels;
  control('handle').title = `展开会话操作 · ${keys.focus} 常规模式`;
  control('sidebar').title = keys.sidebar;
  control('toolbar').title = keys.toolbar;
  control('fullscreen').title = keys.fullscreen;
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
