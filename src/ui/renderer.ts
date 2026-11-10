import type { Action, AppState, Result } from '../protocol';
import type { Connection } from '../model';
import { renderToolbarIcons } from './icons';

declare global {
  interface Window {
    desk: {
      invoke: (action: Action) => Promise<Result>;
      onState: (callback: (state: AppState) => void) => void;
      onCommand: (callback: (command: string) => void) => void;
    };
  }
}
const element = <ElementType extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as ElementType;
const button = (id: string) => element<HTMLButtonElement>(id);
const input = (id: string) => element<HTMLInputElement>(id);
const editor = element<HTMLDialogElement>('editor');
const authDialog = element<HTMLDialogElement>('auth-dialog');
const certificateDialog = element<HTMLDialogElement>('certificate-dialog');
const deleteDialog = element<HTMLDialogElement>('delete-dialog');
const form = element<HTMLFormElement>('connection-form');
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
let current: AppState;
let selected: string | undefined;
let editing: string | undefined;
let shownPrompt: string | undefined;
let toastTimer: ReturnType<typeof setTimeout>;

function toast(text: string) {
  element('toast').textContent = text;
  element('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element('toast').hidden = true; }, 6500);
}
async function invoke(action: Action) {
  const result = await window.desk.invoke(action);
  if (result.state) render(result.state);
  if (!result.ok) toast(result.error || '操作失败，请重试。');
  if (result.message) toast(result.message);
  return result;
}
function selection() { return current?.connections.find(connection => connection.id === selected); }
function list() {
  const container = element('connections');
  container.replaceChildren();
  const search = input('search').value.trim().toLocaleLowerCase();
  const connections = current.connections.filter(connection => `${connection.name} ${connection.url} ${connection.group} ${connection.notes}`.toLocaleLowerCase().includes(search));
  element('count').textContent = String(current.connections.length);
  const groups = [...new Set(connections.map(connection => connection.group || '未分组'))];
  for (const group of groups) {
    const heading = document.createElement('p');
    heading.className = 'group-title';
    heading.textContent = group;
    container.append(heading);
    for (const connection of connections.filter(connection => (connection.group || '未分组') === group)) {
      const row = document.createElement('button');
      row.className = `connection-button${connection.id === selected ? ' selected' : ''}`;
      row.setAttribute('aria-label', connection.name);
      row.title = `${connection.name}\n${connection.url}`;
      const icon = document.createElement('span');
      icon.className = 'server-icon';
      icon.textContent = '▤';
      icon.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      copy.className = 'connection-copy';
      const name = document.createElement('strong');
      name.textContent = connection.name;
      const address = document.createElement('small');
      address.textContent = new URL(connection.url).host;
      copy.append(name, address);
      const indicator = document.createElement('i');
      indicator.className = 'connection-light';
      row.append(icon, copy, indicator);
      row.onclick = () => {
        selected = connection.id;
        render(current);
        void invoke({ type: 'connect', id: connection.id });
      };
      container.append(row);
    }
  }
  if (!connections.length) {
    const message = document.createElement('p');
    message.className = 'list-empty';
    message.textContent = search ? '没有找到匹配的连接' : '还没有连接\n添加你的第一台服务器';
    container.append(message);
  }
}
function render(state: AppState) {
  current = state;
  if (state.status.id && state.connections.some(connection => connection.id === state.status.id)) selected = state.status.id;
  if (selected && !state.connections.some(connection => connection.id === selected)) selected = undefined;
  const connection = selection();
  const active = connection?.id === state.status.id;
  const phase = active ? state.status.phase : 'idle';
  const phases = { idle: '未连接', loading: '连接中', loaded: '页面已加载', disconnected: '已断开', failed: '连接失败' };
  document.body.classList.toggle('sidebar-hidden', !state.layout.sidebar);
  document.body.classList.toggle('toolbar-hidden', !state.layout.toolbar);
  element('title').textContent = connection?.name || '设备';
  element('address').textContent = connection?.url || '你的远程工作空间';
  element('status').textContent = phases[phase];
  element('status-dot').className = phase;
  const keys = state.platform.labels;
  const sidebarLabel = state.layout.sidebar ? '隐藏侧栏' : '显示侧栏';
  button('toggle-sidebar').setAttribute('aria-label', sidebarLabel);
  button('toggle-sidebar').title = `${sidebarLabel} · ${keys.sidebar}`;
  button('settings').disabled = !connection;
  button('connect').disabled = !connection || phase === 'loading' || phase === 'loaded';
  button('disconnect').disabled = !active || !['loading', 'loaded', 'failed'].includes(phase);
  button('reconnect').disabled = !connection;
  button('fullscreen').setAttribute('aria-label', state.fullscreen ? '退出全屏' : '进入全屏');
  button('fullscreen').title = `${state.fullscreen ? '退出' : '进入'}全屏 · ${keys.fullscreen}`;
  button('reconnect').title = `重连 · ${keys.reconnect}`;
  button('toggle-toolbar').title = `隐藏工具栏 · ${keys.toolbar}`;
  element('focus-hint').textContent = `${keys.focus} 专注模式`;
  element('build').textContent = `${state.version} · ${state.platform.name}`;
  renderToolbarIcons(state.fullscreen, state.layout.sidebar);
  element('empty').hidden = active && ['loading', 'loaded'].includes(phase);
  element('connection-state').hidden = phase !== 'failed' && phase !== 'loading';
  element('state-title').textContent = { idle: '准备连接', loading: '正在连接服务器', loaded: '远程页面已加载', disconnected: '连接已断开', failed: '暂时无法连接' }[phase];
  element('state-detail').textContent = active ? state.status.detail : connection?.notes || '点击连接，加载服务器页面。';
  button('state-connect').hidden = phase === 'loaded' || phase === 'loading';
  element('no-devices').hidden = state.connections.length > 0;
  devices();
  list();
  const saved = current.connections.find(connection => connection.id === editing);
  if (saved && editor.open) {
    element('password-status').textContent = saved.savedPassword ? '密码已加密保存' : '未在磁盘记住密码';
    element('certificate-status').textContent = saved.certificateTrusted ? '已固定信任一个服务器证书' : '使用系统证书验证';
    button('revoke-certificate').disabled = !saved.certificateTrusted;
  }
  prompts();
}
function devices() {
  const container = element('devices');
  container.replaceChildren();
  const search = input('search').value.trim().toLocaleLowerCase();
  for (const connection of current.connections.filter(connection => `${connection.name} ${connection.url} ${connection.group} ${connection.notes}`.toLocaleLowerCase().includes(search))) {
    const card = document.createElement('article');
    card.className = 'device-card';
    const preview = document.createElement('button');
    preview.className = 'device-preview';
    preview.setAttribute('aria-label', `连接 ${connection.name}`);
    const monitor = document.createElement('span');
    monitor.className = 'device-monitor';
    monitor.setAttribute('aria-hidden', 'true');
    monitor.textContent = '▣';
    const group = document.createElement('span');
    group.textContent = connection.group || '未分组';
    preview.append(monitor, group);
    preview.onclick = () => { selected = connection.id; void invoke({ type: 'connect', id: connection.id }); };
    const details = document.createElement('div');
    details.className = 'device-details';
    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = connection.name;
    const address = document.createElement('small');
    address.textContent = new URL(connection.url).host;
    copy.append(name, address);
    const edit = document.createElement('button');
    edit.className = 'device-edit';
    edit.textContent = '···';
    edit.setAttribute('aria-label', `编辑 ${connection.name}`);
    edit.onclick = () => { selected = connection.id; void openEditor(connection); };
    details.append(copy, edit);
    card.append(preview, details);
    container.append(card);
  }
}
function prompts() {
  const prompt = current.prompt;
  if (!prompt) {
    authDialog.close();
    certificateDialog.close();
    input('auth-password').value = '';
    shownPrompt = undefined;
    return;
  }
  if (shownPrompt === prompt.token) return;
  authDialog.close();
  certificateDialog.close();
  shownPrompt = prompt.token;
  if (prompt.type === 'auth') {
    element('auth-origin').textContent = prompt.origin;
    element('auth-retry').hidden = !prompt.retry;
    input('auth-username').value = prompt.username || '';
    input('auth-password').value = '';
    input('remember').checked = false;
    input('remember').disabled = !current.encryptionAvailable;
    element('encryption-note').textContent = current.encryptionAvailable
      ? current.platform.storageNote
      : '加密存储不可用。密码仅用于本次会话，不会明文落盘。';
    if (prompt.origin.startsWith('http:')) element('encryption-note').textContent += ' 当前为 HTTP，认证信息在网络中不加密。';
    authDialog.showModal();
    (prompt.username ? input('auth-password') : input('auth-username')).focus();
  } else {
    element('certificate-origin').textContent = prompt.origin;
    element('certificate-fingerprint').textContent = prompt.fingerprint || '';
    element('certificate-names').textContent = `${prompt.subject || '未知'} / ${prompt.issuer || '未知'}`;
    element('certificate-error').textContent = `${prompt.error} / ${prompt.validExpiry ? new Date(prompt.validExpiry * 1000).toLocaleString('zh-CN') : '未知'}`;
    certificateDialog.showModal();
  }
}
async function openEditor(connection?: Connection) {
  editing = connection?.id;
  await invoke({ type: 'modal', open: true });
  form.reset();
  for (const name of ['name', 'url', 'group', 'username', 'notes'] as const) field(name).value = connection?.[name] || '';
  element('editor-title').textContent = connection ? '编辑连接' : '新增连接';
  element('security-settings').hidden = !connection;
  button('delete').hidden = !connection;
  element('form-error').textContent = '';
  element('http-warning').hidden = !field('url').value.startsWith('http:');
  editor.showModal();
  render(current);
  field('name').focus();
}
async function closeEditor() {
  editor.close();
  deleteDialog.close();
  editing = undefined;
  await invoke({ type: 'modal', open: false });
}
button('new').onclick = button('empty-new').onclick = () => { void openEditor(); };
button('settings').onclick = () => { if (selection()) void openEditor(selection()); };
button('editor-cancel').onclick = () => { void closeEditor(); };
editor.oncancel = event => { event.preventDefault(); void closeEditor(); };
field('url').oninput = () => { element('http-warning').hidden = !field('url').value.startsWith('http:'); };
input('search').oninput = () => { list(); devices(); };
form.onsubmit = async event => {
  event.preventDefault();
  const connection = Object.fromEntries(new FormData(form)) as Record<string, string>;
  const result = await invoke({ type: 'save', connection: { ...connection, ...(editing ? { id: editing } : {}) } as Connection });
  if (!result.ok) { element('form-error').textContent = result.error || '保存失败'; return; }
  selected = result.id;
  await closeEditor();
  render(current);
};
button('delete').onclick = () => {
  element('delete-name').textContent = `即将删除“${selection()?.name || field('name').value}”。`;
  editor.close();
  deleteDialog.showModal();
};
button('keep').onclick = () => { deleteDialog.close(); editor.showModal(); };
deleteDialog.oncancel = event => { event.preventDefault(); deleteDialog.close(); editor.showModal(); };
button('delete-confirm').onclick = async () => {
  if (editing) {
    const result = await invoke({ type: 'delete', id: editing });
    if (result.ok) await closeEditor();
  }
};
button('clear-password').onclick = () => { if (editing) void invoke({ type: 'clearPassword', id: editing }).then(result => { if (result.ok) toast('已清除保存的密码及 HTTP 认证缓存。'); }); };
button('revoke-certificate').onclick = () => { if (editing) void invoke({ type: 'revokeCertificate', id: editing }).then(result => { if (result.ok) toast('已撤销信任；下次连接将重新验证证书。'); }); };
button('connect').onclick = button('state-connect').onclick = () => { if (selected) void invoke({ type: 'connect', id: selected }); };
button('disconnect').onclick = () => { void invoke({ type: 'disconnect' }); };
button('reconnect').onclick = () => { if (selected) void invoke({ type: 'connect', id: selected }); };
button('fullscreen').onclick = () => { void invoke({ type: 'fullscreen' }); };
button('toggle-sidebar').onclick = () => { void invoke({ type: 'layout', target: 'sidebar' }); };
button('toggle-toolbar').onclick = () => { void invoke({ type: 'layout', target: 'toolbar' }); };
button('focus').onclick = () => { void invoke({ type: 'layout', target: 'focus' }); };
button('import').onclick = () => { void invoke({ type: 'import' }); };
button('export').onclick = () => { void invoke({ type: 'export' }); };
element<HTMLFormElement>('auth-form').onsubmit = async event => {
  event.preventDefault();
  if (!current.prompt) return;
  const action: Action = {
    type: 'answer', token: current.prompt.token, accept: true,
    username: input('auth-username').value, password: input('auth-password').value,
    remember: input('remember').checked
  };
  input('auth-password').value = '';
  await invoke(action);
};
function answer(accept: boolean) { if (current.prompt) void invoke({ type: 'answer', token: current.prompt.token, accept }); }
button('auth-cancel').onclick = () => answer(false);
authDialog.oncancel = event => { event.preventDefault(); answer(false); };
button('certificate-accept').onclick = () => answer(true);
button('certificate-deny').onclick = () => answer(false);
certificateDialog.oncancel = event => { event.preventDefault(); answer(false); };
window.desk.onState(render);
window.desk.onCommand(command => {
  if (command === 'new' && !current.prompt) void openEditor();
  else if (command === 'search') input('search').focus();
  else if (command.endsWith('Error')) toast('配置操作失败，请检查 JSON 版本、字段与文件权限。');
});
void invoke({ type: 'state' });
