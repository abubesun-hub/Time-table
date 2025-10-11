// Preload with contextIsolation enabled.
// Expose a minimal safe API to the renderer if needed later.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('env', {
  platform: process.platform,
});

// Securely expose a print-to-pdf bridge (only available in Electron runtime)
contextBridge.exposeInMainWorld('native', {
  printToPDF: async ({ html, title, pageSize, landscape, fileNameBase }) => {
    try {
      const res = await ipcRenderer.invoke('print:to-pdf', { html, title, pageSize, landscape, fileNameBase });
      return res;
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  },
  openInBrowser: async ({ html, fileNameBase, title }) => {
    try {
      const res = await ipcRenderer.invoke('print:open-in-browser', { html, fileNameBase, title });
      return res;
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }
});
