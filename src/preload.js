const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Opens a native "Save As" dialog and writes the given base64-encoded
   * bytes to the chosen path.
   * @param {string} base64 - base64-encoded .ico file bytes
   * @param {string} suggestedName - default filename shown in the dialog
   * @returns {Promise<{ok: boolean, path?: string, canceled?: boolean, error?: string}>}
   */
  saveIco: (base64, suggestedName) =>
    ipcRenderer.invoke('save-ico', { base64, suggestedName }),

  /**
   * Opens a native "Save As" dialog and writes the given base64-encoded
   * PNG bytes to the chosen path.
   * @param {string} base64 - base64-encoded .png file bytes
   * @param {string} suggestedName - default filename shown in the dialog
   * @returns {Promise<{ok: boolean, path?: string, canceled?: boolean, error?: string}>}
   */
  savePng: (base64, suggestedName) =>
    ipcRenderer.invoke('save-png', { base64, suggestedName }),

  /**
   * Opens a native "choose folder" dialog and writes every given PNG
   * (base64-encoded) into it, one file per extracted ICO resolution.
   * @param {Array<{name: string, base64: string}>} files
   * @returns {Promise<{ok: boolean, folder?: string, count?: number, canceled?: boolean, error?: string}>}
   */
  savePngBatch: (files) =>
    ipcRenderer.invoke('save-png-batch', { files })
});
