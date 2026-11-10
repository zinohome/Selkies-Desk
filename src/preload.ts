import { contextBridge, ipcRenderer } from 'electron';
import type { Action, AppState, Result } from './protocol';

contextBridge.exposeInMainWorld('desk', {
  invoke: (action: Action): Promise<Result> => ipcRenderer.invoke('desk:invoke', action),
  onState: (listener: (state: AppState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AppState) => listener(state);
    ipcRenderer.on('desk:state', handler);
    return () => ipcRenderer.removeListener('desk:state', handler);
  },
  onCommand: (listener: (command: string) => void) => {
    ipcRenderer.on('desk:command', (_event, command: string) => listener(command));
  }
});
