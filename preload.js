// Preload with contextIsolation enabled.
// Expose a minimal safe API to the renderer if needed later.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('env', {
  platform: process.platform,
});
