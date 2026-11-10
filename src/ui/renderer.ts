import type { Action, AppState, Result } from '../protocol';
import type { Connection } from '../model';
import { setLanguage, t, type Language, type MessageKey } from '../i18n';
import { acceleratorFromInput, commands, type Command } from '../platform';
import { videoEncoderNames, videoEncoders } from '../video';
import { icon, renderStaticIcons, renderToolbarIcons, setIcon, type IconName } from './icons';

declare global {
  interface Window {
    desk: {
      invoke: (action: Action) => Promise<Result>;
      onState: (callback: (state: AppState) => void) => void;
      onCommand: (callback: (command: string) => void) => void;
    };
  }
}
type Entry = AppState['connections'][number];
const element = <ElementType extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as ElementType;
const button = (id: string) => element<HTMLButtonElement>(id);
const input = (id: string) => element<HTMLInputElement>(id);
const editor = element<HTMLDialogElement>('editor');
const authDialog = element<HTMLDialogElement>('auth-dialog');
const certificateDialog = element<HTMLDialogElement>('certificate-dialog');
const deleteDialog = element<HTMLDialogElement>('delete-dialog');
const settingsDialog = element<HTMLDialogElement>('settings-dialog');
const switcher = element<HTMLDialogElement>('switcher');
const form = element<HTMLFormElement>('connection-form');
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
const toggles = ['autoFocus', 'autoReconnect', 'thumbnails', 'passSystemKeys', 'videoApply'] as const;
const numbers = ['retryCount', 'connectTimeout', 'videoFramerate', 'videoBitrate'] as const;
const choices = ['videoEncoder', 'videoRateControl'] as const;
let current: AppState;
let selected: string | undefined;
/** Connection the user just asked for; it stays selected while the previous session is still closing. */
let pending: string | undefined;
let editing: string | undefined;
let shownPrompt: string | undefined;
let shownLanguage: Language | undefined;
let recording: Command | undefined;
let switcherIndex = 0;
let toastTimer: ReturnType<typeof setTimeout>;
const previews = new Map<string, { stamp: number; url: string }>();
/** Names of the sidebar groups the user has folded; remembered on this computer. */
const collapsed = new Set<string>(loadCollapsed());
function loadCollapsed(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem('collapsedGroups') || '[]');
    return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string').slice(0, 200) : [];
  } catch { return []; }
}
function saveCollapsed() {
  try { localStorage.setItem('collapsedGroups', JSON.stringify([...collapsed])); } catch { /* folding still works for this session */ }
}

function toast(text: string) {
  element('toast').textContent = text;
  element('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element('toast').hidden = true; }, 6500);
}
async function invoke(action: Action) {
  const result = await window.desk.invoke(action);
  if (result.state) render(result.state);
  if (!result.ok) toast(result.error || t('error.failed'));
  if (result.message) toast(result.message);
  return result;
}
/** Applies the current language to every element that declares a `data-i18n` key. */
function translate() {
  document.documentElement.lang = current.language === 'zh' ? 'zh-CN' : 'en';
  for (const target of document.querySelectorAll<HTMLElement>('[data-i18n]')) target.textContent = t(target.dataset.i18n as MessageKey);
  for (const target of document.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
    for (const pair of target.dataset.i18nAttr!.split(';')) {
      const [attribute, key] = pair.split(':');
      target.setAttribute(attribute, t(key as MessageKey));
    }
  }
}
/** Elapsed time of the current session, shown beside the status as 12:34 or 1:02:03. */
let since: number | undefined;
function clock() {
  const target = element('status-time');
  target.hidden = since === undefined;
  if (since === undefined) return;
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(seconds / 3600);
  target.textContent = `${hours ? `${hours}:` : ''}${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
setInterval(clock, 1000);
function selection() { return current?.connections.find(connection => connection.id === selected); }
function matches(connection: Entry, search: string) {
  return `${connection.name} ${connection.url} ${connection.group} ${connection.notes}`.toLocaleLowerCase().includes(search);
}
function connect(id: string) {
  selected = pending = id;
  render(current);
  void invoke({ type: 'connect', id }).finally(() => { if (pending === id) pending = undefined; });
}
function phaseOf(connection: Entry) { return connection.id === current.status.id ? current.status.phase : 'idle'; }

function list() {
  const container = element('connections');
  container.replaceChildren();
  const search = input('search').value.trim().toLocaleLowerCase();
  const visible = current.connections.filter(connection => matches(connection, search));
  const groups = [...new Set(visible.map(connection => connection.group || t('ui.ungrouped')))];
  for (const group of groups) {
    const members = visible.filter(connection => (connection.group || t('ui.ungrouped')) === group);
    // A search looks inside every group, so collapsing only applies to the unfiltered list.
    const folded = groups.length > 1 && !search && collapsed.has(group);
    if (groups.length > 1) {
      const heading = document.createElement('button');
      heading.className = 'group-title';
      heading.setAttribute('aria-expanded', String(!folded));
      heading.setAttribute('aria-label', group);
      const name = document.createElement('span');
      name.textContent = group;
      const count = document.createElement('small');
      count.textContent = String(members.length);
      heading.append(icon(folded ? 'chevronRight' : 'chevronDown', 12), name, count);
      // A folded group still shows that it holds the live connection.
      if (folded && members.some(connection => connection.id === current.status.id)) {
        const light = document.createElement('i');
        light.className = `connection-light ${current.status.phase}`;
        heading.append(light);
      }
      heading.onclick = () => {
        if (collapsed.has(group)) collapsed.delete(group); else collapsed.add(group);
        saveCollapsed();
        list();
      };
      container.append(heading);
    }
    if (folded) continue;
    for (const connection of members) {
      const row = document.createElement('button');
      row.className = `connection-button${connection.id === selected ? ' selected' : ''}`;
      row.setAttribute('aria-label', connection.name);
      row.title = connection.url;
      const tile = document.createElement('span');
      tile.className = 'server-icon';
      tile.append(icon('monitor', 16));
      const indicator = document.createElement('i');
      indicator.className = `connection-light ${phaseOf(connection)}`;
      const copy = document.createElement('span');
      copy.className = 'connection-copy';
      const name = document.createElement('strong');
      name.textContent = connection.name;
      const address = document.createElement('small');
      address.textContent = new URL(connection.url).host;
      copy.append(name, address);
      row.append(tile, copy, indicator);
      row.onclick = () => connect(connection.id);
      // The row connects; the three dots beside it open that connection's settings.
      const more = document.createElement('button');
      more.className = 'connection-more';
      more.append(icon('more', 16));
      more.setAttribute('aria-label', t('ui.edit', { name: connection.name }));
      more.title = t('ui.connectionSettings');
      more.onclick = () => { selected = connection.id; void openEditor(connection); };
      const line = document.createElement('div');
      line.className = 'connection-row';
      line.append(row, more);
      container.append(line);
    }
  }
}
function preview(connection: Entry, holder: HTMLElement) {
  const show = (url: string) => {
    const image = document.createElement('img');
    image.alt = '';
    image.src = url;
    holder.replaceChildren(image);
  };
  holder.replaceChildren(icon('monitor', 36));
  if (!connection.thumbnail) { previews.delete(connection.id); return; }
  const cached = previews.get(connection.id);
  if (cached?.stamp === connection.thumbnail) { show(cached.url); return; }
  void window.desk.invoke({ type: 'thumbnail', id: connection.id }).then(result => {
    if (!result.ok || !result.text) return;
    previews.set(connection.id, { stamp: connection.thumbnail, url: result.text });
    if (holder.isConnected) show(result.text);
  });
}
function devices() {
  const container = element('devices');
  container.replaceChildren();
  const search = input('search').value.trim().toLocaleLowerCase();
  const visible = current.connections.filter(connection => matches(connection, search));
  for (const connection of visible) {
    const card = document.createElement('article');
    card.className = 'device-card';
    const open = document.createElement('button');
    open.className = 'device-preview';
    open.setAttribute('aria-label', t('ui.connectTo', { name: connection.name }));
    open.title = connection.url;
    preview(connection, open);
    open.onclick = () => connect(connection.id);
    const details = document.createElement('div');
    details.className = 'device-details';
    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = connection.name;
    const address = document.createElement('small');
    address.textContent = [new URL(connection.url).host, connection.group].filter(Boolean).join(' · ');
    copy.append(name, address);
    const edit = document.createElement('button');
    edit.className = 'icon-button';
    edit.append(icon('more', 18));
    edit.setAttribute('aria-label', t('ui.edit', { name: connection.name }));
    edit.onclick = () => { selected = connection.id; void openEditor(connection); };
    details.append(copy, edit);
    card.append(open, details);
    container.append(card);
  }
  element('count').textContent = String(current.connections.length);
  element('version').textContent = current.version;
  element('no-devices').hidden = current.connections.length > 0;
  element('no-match').hidden = !current.connections.length || visible.length > 0;
}
function shortcutRows() {
  const container = element('shortcut-list');
  container.replaceChildren();
  for (const command of commands) {
    const row = document.createElement('div');
    row.className = `shortcut-row${recording === command ? ' recording' : ''}`;
    const name = document.createElement('span');
    name.textContent = t(`command.${command}`);
    const keys = document.createElement('kbd');
    keys.textContent = recording === command ? t('settings.recording') : current.shortcutLabels[command];
    const change = document.createElement('button');
    change.textContent = t('settings.record');
    change.setAttribute('aria-label', `${t('settings.record')} ${t(`command.${command}`)}`);
    change.onclick = () => { void record(command); };
    const reset = document.createElement('button');
    reset.textContent = t('settings.reset');
    reset.setAttribute('aria-label', `${t('settings.reset')} ${t(`command.${command}`)}`);
    reset.disabled = !current.settings.shortcuts[command];
    reset.onclick = () => { void saveShortcut(command, null); };
    row.append(name, keys, change, reset);
    container.append(row);
  }
}
async function record(command: Command | undefined) {
  recording = command;
  element('shortcut-error').textContent = '';
  await window.desk.invoke({ type: 'recording', active: !!command });
  shortcutRows();
}
async function saveShortcut(command: Command, accelerator: string | null) {
  const result = await window.desk.invoke({ type: 'shortcut', command, accelerator });
  await record(undefined);
  if (result.state) render(result.state);
  element('shortcut-error').textContent = result.ok ? '' : result.error || t('error.failed');
}
function settingsForm() {
  element<HTMLSelectElement>('set-language').value = current.settings.language;
  element<HTMLSelectElement>('set-theme').value = current.settings.theme;
  for (const name of toggles) input(`set-${name}`).checked = current.settings[name];
  for (const name of numbers) if (document.activeElement !== input(`set-${name}`)) input(`set-${name}`).value = String(current.settings[name]);
  input('set-retryCount').disabled = !current.settings.autoReconnect;
  const encoder = element<HTMLSelectElement>('set-videoEncoder');
  if (!encoder.options.length) for (const value of videoEncoders) encoder.add(new Option(videoEncoderNames[value], value));
  for (const name of choices) element<HTMLSelectElement>(`set-${name}`).value = current.settings[name];
  // The video fields are only meaningful while the app manages them; bitrate only with constant bitrate.
  for (const id of ['videoEncoder', 'videoFramerate', 'videoRateControl', 'videoBitrate']) input(`set-${id}`).disabled = !current.settings.videoApply;
  if (current.settings.videoRateControl !== 'cbr') input('set-videoBitrate').disabled = true;
  element('build').textContent = t('settings.version', { version: current.version });
  shortcutRows();
}
function switcherItems() {
  const search = input('switcher-input').value.trim().toLocaleLowerCase();
  return current.connections.filter(connection => matches(connection, search)).slice(0, 50);
}
function switcherList() {
  const container = element('switcher-list');
  container.replaceChildren();
  const items = switcherItems();
  switcherIndex = Math.max(0, Math.min(switcherIndex, items.length - 1));
  items.forEach((connection, index) => {
    const row = document.createElement('button');
    row.className = `switcher-item${index === switcherIndex ? ' current' : ''}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === switcherIndex));
    const name = document.createElement('span');
    name.textContent = connection.name;
    const address = document.createElement('small');
    address.textContent = new URL(connection.url).host;
    row.append(name, address);
    row.onclick = () => { void choose(connection.id); };
    container.append(row);
  });
  container.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
}
async function choose(id: string) {
  await closeModal(switcher);
  connect(id);
}
function render(state: AppState) {
  current = state;
  setLanguage(state.language);
  if (shownLanguage !== state.language) {
    shownLanguage = state.language;
    translate();
  }
  if (state.status.id === pending) pending = undefined;
  if (!pending && state.status.id && state.connections.some(connection => connection.id === state.status.id)) selected = state.status.id;
  if (selected && !state.connections.some(connection => connection.id === selected)) selected = undefined;
  const connection = selection();
  const active = connection?.id === state.status.id;
  const phase = active ? state.status.phase : 'idle';
  const onDesktop = active && ['loading', 'loaded'].includes(phase);
  const keys = state.shortcutLabels;
  document.body.classList.toggle('sidebar-hidden', !state.layout.sidebar);
  document.body.classList.toggle('toolbar-hidden', !state.layout.toolbar);
  document.body.classList.toggle('titlebar', state.platform.integratedTitleBar);
  document.body.classList.toggle('fullscreen', state.fullscreen);
  document.body.classList.toggle('home-visible', !onDesktop);
  element('title').textContent = connection?.name || 'Selkies Desk';
  element('address').textContent = connection?.url || '';
  element('strip-title').textContent = connection?.name || 'Selkies Desk';
  element('status').textContent = t(`status.${phase}`);
  element('status-dot').className = phase;
  since = active && phase === 'loaded' ? state.status.since : undefined;
  clock();
  const sidebarLabel = t(state.layout.sidebar ? 'ui.hideSidebar' : 'ui.showSidebar');
  button('toggle-sidebar').setAttribute('aria-label', sidebarLabel);
  button('toggle-sidebar').title = `${sidebarLabel} · ${keys.sidebar}`;
  button('settings').disabled = !connection;
  button('connect').disabled = !connection || ['loading', 'loaded', 'waiting'].includes(phase);
  button('disconnect').disabled = !active || !['loading', 'loaded', 'failed', 'waiting'].includes(phase);
  button('reconnect').disabled = !connection;
  button('reconnect').title = `${t('ui.reconnect')} · ${keys.reconnect}`;
  const fullscreenLabel = t(state.fullscreen ? 'ui.exitFullscreen' : 'ui.enterFullscreen');
  button('fullscreen').setAttribute('aria-label', fullscreenLabel);
  button('fullscreen').title = `${fullscreenLabel} · ${keys.fullscreen}`;
  button('focus').title = t('ui.focus');
  button('toggle-toolbar').title = `${t('ui.hideToolbar')} · ${keys.toolbar}`;
  renderToolbarIcons(state.fullscreen, state.layout.sidebar);
  // The slim title strip of windowed focus mode carries the same session actions as small icons.
  const stripButton = (id: string, name: IconName, text: string, shortcut = '') => {
    setIcon(button(id), name, 16);
    button(id).setAttribute('aria-label', text);
    button(id).title = shortcut ? `${text} · ${shortcut}` : text;
  };
  stripButton('strip-restore', 'regular', t('controls.regular'), keys.focus);
  stripButton('strip-sidebar', 'panelLeft', sidebarLabel, keys.sidebar);
  stripButton('strip-toolbar', 'panelTop', t('ui.showToolbar'), keys.toolbar);
  stripButton('strip-fullscreen', 'maximize', t('ui.enterFullscreen'), keys.fullscreen);
  stripButton('strip-reconnect', 'reconnect', t('ui.reconnect'), keys.reconnect);
  stripButton('strip-disconnect', 'disconnect', t('ui.disconnect'));
  element('home').hidden = onDesktop;
  element('connection-state').hidden = !['failed', 'loading', 'waiting', 'disconnected'].includes(phase);
  element('state-title').textContent = t(`stateTitle.${phase}`);
  element('state-detail').textContent = active ? state.status.detail : '';
  button('state-connect').hidden = phase === 'loading';
  button('state-connect').textContent = t(phase === 'waiting' ? 'ui.reconnectNow' : 'ui.connectThis');
  button('state-stop').hidden = phase !== 'waiting';
  devices();
  list();
  const saved = current.connections.find(connection => connection.id === editing);
  if (saved && editor.open) {
    element('password-status').textContent = t(saved.savedPassword ? 'editor.passwordSaved' : 'editor.passwordNone');
    element('certificate-status').textContent = t(saved.certificateTrusted ? 'editor.certPinned' : 'editor.certSystem');
    button('clear-password').disabled = !saved.savedPassword;
    button('revoke-certificate').disabled = !saved.certificateTrusted;
  }
  if (settingsDialog.open) settingsForm();
  if (switcher.open) switcherList();
  prompts();
}
/** Encrypted storage can become available after the dialog is already open, so this runs on every update. */
function storageNote() {
  const prompt = current.prompt;
  if (prompt?.type !== 'auth') return;
  input('remember').disabled = !current.encryptionAvailable;
  if (!current.encryptionAvailable) input('remember').checked = false;
  const notes = [current.encryptionAvailable ? t(`storage.${current.platform.os}`) : t('auth.unavailable')];
  if (prompt.origin.startsWith('http:')) notes.push(t('auth.http'));
  element('encryption-note').textContent = notes.join(' ');
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
  if (shownPrompt === prompt.token) { storageNote(); return; }
  authDialog.close();
  certificateDialog.close();
  shownPrompt = prompt.token;
  if (prompt.type === 'auth') {
    element('auth-origin').textContent = prompt.origin;
    element('auth-retry').hidden = !prompt.retry;
    input('auth-username').value = prompt.username || '';
    input('auth-password').value = '';
    input('remember').checked = false;
    storageNote();
    authDialog.showModal();
    (prompt.username ? input('auth-password') : input('auth-username')).focus();
  } else {
    element('certificate-origin').textContent = prompt.origin;
    element('certificate-fingerprint').textContent = prompt.fingerprint || '';
    element('certificate-names').textContent = `${prompt.subject || t('cert.unknown')} / ${prompt.issuer || t('cert.unknown')}`;
    const expiry = prompt.validExpiry ? new Date(prompt.validExpiry * 1000).toLocaleString(current.language === 'zh' ? 'zh-CN' : 'en') : t('cert.unknown');
    element('certificate-error').textContent = `${prompt.error} / ${expiry}`;
    certificateDialog.showModal();
  }
}
/** Dialogs live in the management page, so the remote desktop is hidden while one is open. */
async function openModal(dialog: HTMLDialogElement) {
  if (current.prompt || dialog.open) return false;
  for (const other of [editor, deleteDialog, settingsDialog, switcher]) if (other.open) other.close();
  await invoke({ type: 'modal', open: true });
  dialog.showModal();
  return true;
}
async function closeModal(dialog: HTMLDialogElement) {
  dialog.close();
  recording = undefined;
  await invoke({ type: 'modal', open: false });
}
async function openEditor(connection?: Connection) {
  editing = connection?.id;
  if (!await openModal(editor)) return;
  form.reset();
  for (const name of ['name', 'url', 'group', 'username', 'notes'] as const) field(name).value = connection?.[name] || '';
  field('fullscreen').checked = !!connection?.fullscreen;
  field('autoConnect').checked = !!connection?.autoConnect;
  element('editor-title').textContent = t(connection ? 'editor.edit' : 'editor.new');
  element('security-settings').hidden = !connection;
  button('delete').hidden = !connection;
  element('form-error').textContent = '';
  element('http-warning').hidden = !field('url').value.startsWith('http:');
  render(current);
  field('name').focus();
}
async function closeEditor() {
  deleteDialog.close();
  editing = undefined;
  await closeModal(editor);
}
/** Settings are split into panes; only one is on screen at a time. */
function showPane(name: string) {
  for (const tab of settingsDialog.querySelectorAll<HTMLElement>('[role=tab]')) tab.setAttribute('aria-selected', String(tab.dataset.pane === name));
  for (const pane of settingsDialog.querySelectorAll<HTMLElement>('[role=tabpanel]')) pane.hidden = pane.dataset.pane !== name;
  if (recording) void record(undefined);
}
for (const tab of settingsDialog.querySelectorAll<HTMLElement>('[role=tab]')) tab.onclick = () => showPane(tab.dataset.pane!);
async function openSettings() {
  if (!await openModal(settingsDialog)) return;
  element('shortcut-error').textContent = '';
  showPane('general');
  settingsForm();
}
async function openSwitcher() {
  if (!current.connections.length || !await openModal(switcher)) return;
  input('switcher-input').value = '';
  switcherIndex = Math.max(0, current.connections.findIndex(connection => connection.id !== current.status.id));
  switcherList();
  input('switcher-input').focus();
}

for (const id of ['new', 'empty-new']) button(id).onclick = () => { void openEditor(); };
button('open-settings').onclick = () => { void openSettings(); };
button('settings').onclick = () => { if (selection()) void openEditor(selection()); };
button('editor-cancel').onclick = () => { void closeEditor(); };
editor.oncancel = event => { event.preventDefault(); void closeEditor(); };
field('url').oninput = () => { element('http-warning').hidden = !field('url').value.startsWith('http:'); };
input('search').oninput = () => { list(); devices(); };
form.onsubmit = async event => {
  event.preventDefault();
  const text = Object.fromEntries(['name', 'url', 'group', 'username', 'notes'].map(name => [name, field(name).value]));
  const connection = { ...text, fullscreen: field('fullscreen').checked, autoConnect: field('autoConnect').checked, ...(editing ? { id: editing } : {}) };
  const result = await invoke({ type: 'save', connection: connection as Connection });
  if (!result.ok) { element('form-error').textContent = result.error || t('editor.saveFailed'); return; }
  selected = result.id;
  await closeEditor();
  render(current);
};
button('delete').onclick = () => {
  element('delete-name').textContent = t('delete.body', { name: selection()?.name || field('name').value });
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
button('clear-password').onclick = () => { if (editing) void invoke({ type: 'clearPassword', id: editing }).then(result => { if (result.ok) toast(t('editor.passwordCleared')); }); };
button('revoke-certificate').onclick = () => { if (editing) void invoke({ type: 'revokeCertificate', id: editing }).then(result => { if (result.ok) toast(t('editor.revoked')); }); };
button('connect').onclick = button('state-connect').onclick = () => { if (selected) connect(selected); };
button('disconnect').onclick = button('state-stop').onclick = () => { void invoke({ type: 'disconnect' }); };
button('reconnect').onclick = () => { if (selected) connect(selected); };
button('fullscreen').onclick = () => { void invoke({ type: 'fullscreen' }); };
button('toggle-sidebar').onclick = () => { void invoke({ type: 'layout', target: 'sidebar' }); };
button('toggle-toolbar').onclick = () => { void invoke({ type: 'layout', target: 'toolbar' }); };
button('focus').onclick = () => { void invoke({ type: 'layout', target: 'focus' }); };
button('strip-restore').onclick = () => { void invoke({ type: 'layout', target: 'restore' }); };
button('strip-sidebar').onclick = () => { void invoke({ type: 'layout', target: 'sidebar' }); };
button('strip-toolbar').onclick = () => { void invoke({ type: 'layout', target: 'toolbar' }); };
button('strip-fullscreen').onclick = () => { void invoke({ type: 'fullscreen' }); };
button('strip-reconnect').onclick = () => { if (selected) connect(selected); };
button('strip-disconnect').onclick = () => { void invoke({ type: 'disconnect' }); };
button('import').onclick = () => { void invoke({ type: 'import' }); };
button('export').onclick = () => { void invoke({ type: 'export' }); };

button('settings-close').onclick = () => { void closeModal(settingsDialog); };
settingsDialog.oncancel = event => {
  event.preventDefault();
  if (recording) void record(undefined);
  else void closeModal(settingsDialog);
};
element<HTMLSelectElement>('set-language').onchange = event => { void invoke({ type: 'settings', settings: { language: (event.target as HTMLSelectElement).value as AppState['settings']['language'] } }); };
element<HTMLSelectElement>('set-theme').onchange = event => { void invoke({ type: 'settings', settings: { theme: (event.target as HTMLSelectElement).value as AppState['settings']['theme'] } }); };
for (const name of toggles) input(`set-${name}`).onchange = () => { void invoke({ type: 'settings', settings: { [name]: input(`set-${name}`).checked } }); };
for (const name of choices) element<HTMLSelectElement>(`set-${name}`).onchange = event => { void invoke({ type: 'settings', settings: { [name]: (event.target as HTMLSelectElement).value } }); };
// A number outside the allowed range is put back to the nearest allowed value rather than rejected.
for (const name of numbers) input(`set-${name}`).onchange = () => {
  const field = input(`set-${name}`);
  const value = Math.round(Number(field.value));
  const bounded = Number.isFinite(value) ? Math.max(Number(field.min), Math.min(Number(field.max), value)) : current.settings[name];
  field.value = String(bounded);
  void invoke({ type: 'settings', settings: { [name]: bounded } });
};
// While recording, the next complete key combination becomes the shortcut.
// Listening on the document keeps this working after the clicked button is re-rendered and loses focus.
document.addEventListener('keydown', event => {
  if (!recording) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') { void record(undefined); return; }
  const accelerator = acceleratorFromInput({ code: event.code, control: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey });
  if (accelerator) void saveShortcut(recording, accelerator);
}, true);

switcher.oncancel = event => { event.preventDefault(); void closeModal(switcher); };
input('switcher-input').oninput = () => { switcherIndex = 0; switcherList(); };
input('switcher-input').onkeydown = event => {
  const items = switcherItems();
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (items.length) switcherIndex = (switcherIndex + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    switcherList();
  } else if (event.key === 'Enter' && items[switcherIndex]) {
    event.preventDefault();
    void choose(items[switcherIndex].id);
  }
};

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
renderStaticIcons();
window.desk.onState(render);
window.desk.onCommand(command => {
  if (command === 'new') void openEditor();
  else if (command === 'settings') void openSettings();
  else if (command === 'switcher') void openSwitcher();
  else if (command.endsWith('Error')) toast(t('error.config'));
});
void invoke({ type: 'state' });
