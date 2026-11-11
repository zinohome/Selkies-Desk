import {
  createElement, PanelLeftOpen, PanelLeftClose, SlidersHorizontal, Settings, RotateCw, Square, Play, Focus,
  Maximize, Minimize, ChevronUp, Plus, Search, Monitor, Ellipsis, Keyboard, FolderInput, PanelLeft, PanelTop, PanelsTopLeft, X, ChevronRight, ChevronDown, Video, CircleArrowUp
} from 'lucide';

const icons = {
  sidebarOpen: PanelLeftOpen, sidebarClose: PanelLeftClose, connectionSettings: SlidersHorizontal, settings: Settings,
  reconnect: RotateCw, disconnect: Square, connect: Play, focus: Focus, maximize: Maximize, minimize: Minimize,
  collapse: ChevronUp, plus: Plus, search: Search, monitor: Monitor, more: Ellipsis, keyboard: Keyboard, data: FolderInput,
  panelLeft: PanelLeft, panelTop: PanelTop, regular: PanelsTopLeft, close: X, chevronRight: ChevronRight, chevronDown: ChevronDown, video: Video, update: CircleArrowUp
};
export type IconName = keyof typeof icons;

export function icon(name: IconName, size = 20) {
  return createElement(icons[name], {
    width: size, height: size, 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMidYMid meet'
  });
}
function set(target: HTMLElement, name: IconName, size = 20) {
  if (target.dataset.iconShown === name) return;
  target.replaceChildren(icon(name, size));
  target.dataset.iconShown = name;
}
/** Fills every static `data-icon` placeholder in the page. */
export function renderStaticIcons() {
  for (const target of document.querySelectorAll<HTMLElement>('[data-icon]')) {
    const name = target.dataset.icon as IconName;
    set(target, name, target.classList.contains('empty-icon') ? 40 : target.classList.contains('icon-button') ? 20 : 16);
  }
}
export function setIcon(target: HTMLElement, name: IconName, size = 20) { set(target, name, size); }
export function renderToolbarIcons(fullscreen: boolean, sidebar: boolean) {
  const names: Record<string, IconName> = {
    'toggle-sidebar': sidebar ? 'sidebarClose' : 'sidebarOpen',
    settings: 'connectionSettings', reconnect: 'reconnect', disconnect: 'disconnect', connect: 'connect',
    focus: 'focus', fullscreen: fullscreen ? 'minimize' : 'maximize', 'toggle-toolbar': 'collapse'
  };
  for (const [id, name] of Object.entries(names)) set(document.getElementById(id)!, name);
}
