const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  whipCrack: () => ipcRenderer.send('whip-crack'),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  onSpawnWhip: (fn) => ipcRenderer.on('spawn-whip', () => fn()),
  onDropWhip: (fn) => ipcRenderer.on('drop-whip', () => fn()),
  onCursor: (fn) => ipcRenderer.on('cursor', (_e, pos) => fn(pos)),
  onSetSkin: (fn) => ipcRenderer.on('set-skin', (_e, id) => fn(id)),
  // The renderer is sandboxed, so this preload can't use fs/path. Ask the main
  // process to read the sound bytes (for Web Audio decoding). Returns a Promise
  // resolving to a Uint8Array, or null if the file is missing.
  readSound: (name) => ipcRenderer.invoke('read-sound', name),
});
