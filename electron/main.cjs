const { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const PROFILE = process.env.MATHMYTH_QA_PROFILE;
const dataDir = PROFILE ? path.resolve(PROFILE) : path.join(app.getPath('appData'), 'Mathmyth');
require('node:fs').mkdirSync(dataDir,{recursive:true});
app.setPath('userData', dataDir);
protocol.registerSchemesAsPrivileged([{ scheme: 'mathmyth', privileges: { standard:true, secure:true, supportFetchAPI:true, stream:true, codeCache:true } }]);
const pending = new Map();
let window;
let closing=false,closeTimer;
const trusted = (event) => event.sender === window?.webContents && event.senderFrame?.url.startsWith('mathmyth://app/');
const paths = { DATA_DIR:dataDir, DB_PATH:path.join(dataDir,'IndexedDB'), UPLOADS_DIR:null, ENV_PATH:null };
ipcMain.on('mathmyth:paths', (event) => { event.returnValue = trusted(event) ? paths : null; });
ipcMain.on('mathmyth:close-ready', (event,saved) => {
  if (!trusted(event) || !closing) return;
  clearTimeout(closeTimer);
  if (saved) window.destroy(); else closing=false;
});
ipcMain.handle('mathmyth:stream-start', (event, options) => {
  if (!trusted(event) || typeof options?.id !== 'string' || typeof options.body !== 'string') throw new Error('Invalid request');
  const url = new URL(options.url);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || pending.has(options.id)) throw new Error('Invalid request');
  const controller = new AbortController(); pending.set(options.id, controller);
  const timeout = setTimeout(() => controller.abort(), Math.min(options.readTimeout || 120000,120000));
  const send = (type, fields={}) => { if (pending.get(options.id) === controller && !window?.webContents.isDestroyed()) event.sender.send('mathmyth:stream', {id:options.id,type,...fields}); };
  (async () => {
    try {
      const response = await net.fetch(url.toString(), { method:'POST', headers:options.headers, body:options.body,
        signal:controller.signal, credentials:'omit', redirect:'error' });
      send('start',{status:response.status,contentType:response.headers.get('content-type') || ''});
      const reader = response.body.getReader(), decoder = new TextDecoder();
      try { while (true) { const {done,value} = await reader.read(); if (done) break; const text = decoder.decode(value,{stream:true}); if (text) send('chunk',{text}); } const text=decoder.decode(); if(text)send('chunk',{text}); }
      finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
      send('end');
    } catch { send('error',{code:controller.signal.aborted ? 'timeout' : 'network'}); }
    finally { clearTimeout(timeout); if(pending.get(options.id)===controller)pending.delete(options.id); }
  })();
  return { started:true };
});
ipcMain.handle('mathmyth:stream-cancel', (event,id) => { if(!trusted(event))return; const controller=pending.get(id); pending.delete(id); controller?.abort(); });
ipcMain.handle('mathmyth:save-backup', async (event,{bytes,filename}) => {
  if (!trusted(event) || !(bytes instanceof Uint8Array)) throw new Error('Invalid backup');
  const result=await dialog.showSaveDialog(window,{title:'导出 Mathmyth 备份',defaultPath:path.join(app.getPath('documents'),path.basename(filename)),filters:[{name:'Mathmyth SQLite',extensions:['sqlite']}]});
  if(result.canceled || !result.filePath)return {saved:false};
  const temporary=`${result.filePath}.mathmyth-${require('node:crypto').randomUUID()}.tmp`;
  try { await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,result.filePath);return {saved:true}; }
  finally { await fs.unlink(temporary).catch(()=>{}); }
});
const dist = path.resolve(__dirname,'../dist');
app.whenReady().then(async () => {
  protocol.handle('mathmyth', async (request) => {
    const url = new URL(request.url);
    if(url.hostname!=='app')return new Response('',{status:404});
    let relative;
    try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'; } catch { return new Response('',{status:400}); }
    const file = path.resolve(dist,relative);
    if(file!==dist && !file.startsWith(dist+path.sep))return new Response('',{status:403});
    return net.fetch(pathToFileURL(file).toString());
  });
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details) => callback(contents===window?.webContents && permission==='media' && !(details.mediaTypes || []).includes('audio')));
  session.defaultSession.setPermissionCheckHandler((contents,permission,origin) => contents===window?.webContents && permission==='media' && origin.startsWith('mathmyth://app'));
  window = new BrowserWindow({ title:'Mathmyth',width:1000,height:780,minWidth:360,minHeight:520,show:!process.argv.includes('--mathmyth-headless'),
    icon:path.join(dist,'mathmyth.png'),
    backgroundColor:nativeTheme.shouldUseDarkColors ? '#171717' : '#fafafa', autoHideMenuBar:true,
    webPreferences:{ preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false } });
  window.setMenu(null);
  window.on('close',event=>{
    event.preventDefault();
    if (closing)return;
    closing=true;window.webContents.send('mathmyth:prepare-close');
    closeTimer=setTimeout(()=>{if(!window.isDestroyed())window.destroy();},2000);
  });
  window.webContents.setWindowOpenHandler(({url}) => { if(/^https?:\/\//.test(url))shell.openExternal(url);return {action:'deny'}; });
  window.webContents.on('will-navigate',(event,url) => { if(!url.startsWith('mathmyth://app/')) {event.preventDefault();if(/^https?:\/\//.test(url))shell.openExternal(url);} });
  window.webContents.session.webRequest.onHeadersReceived((details,callback) => {
    if (!details.url.startsWith('mathmyth://app/')) { callback({responseHeaders:details.responseHeaders}); return; }
    callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':["default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self' https: http:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'"]}});
  });
  await window.loadURL('mathmyth://app/');
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{pending.forEach(controller=>controller.abort());pending.clear();});
