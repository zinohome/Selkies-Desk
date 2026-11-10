/**
 * Runs in the remote page's isolated preload world, before any of the page's own scripts.
 * Its only job is to store the app's video settings where the Selkies client reads its picks.
 * It exposes nothing to the page and has no channel back to the app: the values arrive as a
 * launch argument of this view.
 */
import { heldPickKeys, storagePrefix, videoArgument, videoStorage, type VideoSettings } from './video';

try {
  const argument = process.argv.find(value => value.startsWith(videoArgument));
  if (argument && window.top === window) {
    const { origin, video } = JSON.parse(atob(argument.slice(videoArgument.length))) as { origin: string; video: VideoSettings };
    // Only the configured server's own pages are touched, never a page it redirected to.
    if (location.origin === origin) {
      const prefix = storagePrefix(location.origin, location.pathname);
      for (const [key, value] of Object.entries(videoStorage(prefix, video))) {
        if (localStorage.getItem(key) !== value) localStorage.setItem(key, value);
      }
      for (const key of heldPickKeys(prefix)) localStorage.removeItem(key);
    }
  }
} catch { /* Storage can be unavailable; the page then simply keeps its own settings. */ }
