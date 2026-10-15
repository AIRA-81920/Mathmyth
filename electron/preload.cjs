const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mathmythDesktop', Object.freeze({
  paths: ipcRenderer.sendSync('mathmyth:paths'),
  start: (options) => ipcRenderer.invoke('mathmyth:stream-start', options),
  cancel: ({ id }) => ipcRenderer.invoke('mathmyth:stream-cancel', id),
  saveBackup: (bytes, filename) => ipcRenderer.invoke('mathmyth:save-backup', { bytes, filename }),
  onBeforeClose: (callback) => {
    const listener = () => Promise.resolve().then(callback).then(()=>ipcRenderer.send('mathmyth:close-ready',true),()=>ipcRenderer.send('mathmyth:close-ready',false));
    ipcRenderer.on('mathmyth:prepare-close',listener);
    return () => ipcRenderer.removeListener('mathmyth:prepare-close',listener);
  },
  addListener: async (_event, callback) => {
    const listener = (_source, data) => callback(data);
    ipcRenderer.on('mathmyth:stream', listener);
    return { remove: async () => { ipcRenderer.removeListener('mathmyth:stream', listener); } };
  },
}));
