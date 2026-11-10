import { createElement, PanelLeftOpen, PanelLeftClose, Settings, RotateCw, Square, Play, Focus, Maximize, Minimize, ChevronUp } from 'lucide';

const icons = {
  sidebarOpen: PanelLeftOpen, sidebarClose: PanelLeftClose,
  settings: Settings, reconnect: RotateCw, disconnect: Square, connect: Play,
  focus: Focus, maximize: Maximize, minimize: Minimize, collapse: ChevronUp
};

export function renderToolbarIcons(fullscreen: boolean, sidebar: boolean) {
  const names: Record<string, keyof typeof icons> = {
    'toggle-sidebar': sidebar ? 'sidebarClose' : 'sidebarOpen',
    settings: 'settings', reconnect: 'reconnect', disconnect: 'disconnect', connect: 'connect',
    focus: 'focus', fullscreen: fullscreen ? 'minimize' : 'maximize', 'toggle-toolbar': 'collapse'
  };
  for (const [id, name] of Object.entries(names)) {
    const button = document.getElementById(id)!;
    if (button.dataset.icon === name) continue;
    button.replaceChildren(createElement(icons[name], {
      width: 20, height: 20, 'aria-hidden': 'true', focusable: 'false',
      preserveAspectRatio: 'xMidYMid meet'
    }));
    button.dataset.icon = name;
  }
}
