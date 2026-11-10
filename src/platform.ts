export type OS = 'mac' | 'windows' | 'linux';
export const commands = ['new', 'switcher', 'settings', 'reconnect', 'sidebar', 'toolbar', 'focus', 'fullscreen'] as const;
export type Command = typeof commands[number];
export type Shortcuts = Record<Command, string>;
export type KeyInput = { code: string; control?: boolean; meta?: boolean; alt?: boolean; shift?: boolean };

export const osOf = (platform: string): OS => platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : 'linux';
export const platformName = (os: OS) => ({ mac: 'macOS', windows: 'Windows', linux: 'Linux' })[os];

/**
 * Management shortcuts carry an extra Alt/Option modifier so that plain
 * Ctrl/Cmd combinations keep reaching the remote desktop. Ubuntu reserves
 * Ctrl+Alt+T for the terminal, so Windows and Linux use H for the toolbar.
 */
export function defaultShortcuts(os: OS): Shortcuts {
  const prefix = os === 'mac' ? 'Command+Alt+' : 'Control+Alt+';
  return {
    new: `${prefix}N`, switcher: `${prefix}K`, settings: `${prefix},`, reconnect: `${prefix}R`,
    sidebar: `${prefix}B`, toolbar: `${prefix}${os === 'mac' ? 'T' : 'H'}`, focus: `${prefix}Enter`,
    fullscreen: os === 'mac' ? 'Control+Command+F' : 'F11'
  };
}

const punctuation: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: '\'', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`'
};
const named: Record<string, string> = {
  Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right'
};
function keyToken(code: string) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return punctuation[code] || named[code];
}

/** Builds an Electron accelerator from a physical key press; undefined for modifier-only or unsupported keys. */
export function acceleratorFromInput(input: KeyInput) {
  const key = keyToken(input.code);
  if (!key) return undefined;
  return [input.control && 'Control', input.meta && 'Command', input.alt && 'Alt', input.shift && 'Shift', key].filter(Boolean).join('+');
}
/** A shortcut must not swallow ordinary typing: it needs Ctrl, Alt or Cmd, or must be a function key. */
export function validShortcut(accelerator: string) {
  const parts = accelerator.split('+');
  const key = parts.at(-1) || '';
  const modifiers = parts.slice(0, -1);
  if (!key || modifiers.some(modifier => !['Control', 'Command', 'Alt', 'Shift'].includes(modifier))) return false;
  if (new Set(modifiers).size !== modifiers.length) return false;
  const known = /^[A-Z0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || Object.values(punctuation).includes(key) || Object.values(named).includes(key);
  if (!known) return false;
  if (/^F\d+$/.test(key)) return true;
  return modifiers.some(modifier => modifier !== 'Shift');
}
export function matchShortcut(input: KeyInput, shortcuts: Shortcuts): Command | undefined {
  const pressed = acceleratorFromInput(input);
  if (!pressed) return undefined;
  return commands.find(command => shortcuts[command] === pressed);
}
export function effectiveShortcuts(os: OS, overrides: Partial<Record<Command, string>>): Shortcuts {
  const result = defaultShortcuts(os);
  for (const command of commands) {
    const custom = overrides[command];
    if (custom && validShortcut(custom)) result[command] = custom;
  }
  return result;
}
export function shortcutLabel(os: OS, accelerator: string) {
  const parts = accelerator.split('+');
  if (os === 'mac') {
    const symbols: Record<string, string> = { Control: '⌃', Command: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↩', Up: '↑', Down: '↓', Left: '←', Right: '→' };
    return parts.map(part => symbols[part] || part).join('');
  }
  const names: Record<string, string> = { Control: 'Ctrl', Command: os === 'windows' ? 'Win' : 'Super' };
  return parts.map(part => names[part] || part).join('+');
}

/**
 * On Linux Electron falls back to a hard-coded key (`basic_text`) when no
 * keyring is present. That is not real protection, so passwords then stay in
 * memory for the current session only.
 */
export function trustedStorage(platform: string, available: boolean, linuxBackend: () => string) {
  if (!available) return false;
  if (osOf(platform) !== 'linux') return true;
  return ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(linuxBackend());
}
