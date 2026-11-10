export type OS = 'mac' | 'windows' | 'linux';
export type PlatformInfo = {
  os: OS;
  name: string;
  /** Electron menu accelerators for connection management. */
  accelerators: Record<ShortcutName, string>;
  /** Human readable shortcut labels shown in tooltips. */
  labels: Record<ShortcutName | 'fullscreen', string>;
  storageNote: string;
};
type ShortcutName = 'new' | 'search' | 'reconnect' | 'sidebar' | 'toolbar' | 'focus';

export const osOf = (platform: string): OS => platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : 'linux';

/**
 * Management shortcuts always carry an extra Alt/Option modifier so that plain
 * Ctrl/Cmd combinations keep reaching the remote desktop. Ubuntu reserves
 * Ctrl+Alt+T for the terminal, so Windows and Linux use H for the toolbar.
 */
export function platformInfo(platform: string): PlatformInfo {
  const os = osOf(platform);
  const mac = os === 'mac';
  const keys: Record<ShortcutName, string> = { new: 'N', search: 'L', reconnect: 'R', sidebar: 'B', toolbar: mac ? 'T' : 'H', focus: 'Enter' };
  const names = Object.keys(keys) as ShortcutName[];
  const accelerators = Object.fromEntries(names.map(name => [name, `${mac ? 'Command' : 'Control'}+Alt+${keys[name]}`])) as Record<ShortcutName, string>;
  const labels = {
    ...Object.fromEntries(names.map(name => [name, mac ? `⌘⌥${keys[name]}` : `Ctrl+Alt+${keys[name]}`])),
    fullscreen: mac ? '⌃⌘F' : 'F11'
  } as PlatformInfo['labels'];
  return {
    os, accelerators, labels,
    name: { mac: 'macOS', windows: 'Windows', linux: 'Linux' }[os],
    storageNote: {
      mac: '使用由 macOS Keychain 保护密钥的加密存储；不会把明文密码写入配置。',
      windows: '使用由当前 Windows 账户（DPAPI）保护密钥的加密存储；不会把明文密码写入配置。',
      linux: '使用由系统密钥环（GNOME Keyring 或 KWallet）保护密钥的加密存储；不会把明文密码写入配置。'
    }[os]
  };
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
