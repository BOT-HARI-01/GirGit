const {contextBridge, ipcRenderer} =  require('electron');
contextBridge.exposeInMainWorld('api', {
    onShowScreenshots: (callback) => ipcRenderer.on('show-screenshots', callback),
    showText: (callback) => ipcRenderer.on('get-text',callback),
    captureMode: (callback) => ipcRenderer.on('captureMode',callback),
    scroller: (callback) => ipcRenderer.on('do-scroll',callback),
    message: (callback) => ipcRenderer.on('message-col',callback),
    commands: (callback) => ipcRenderer.on('commands',callback),
    apiSetup: (callback) => ipcRenderer.on('apiSetup',callback),
    voice: (callback) =>ipcRenderer.on('voiceMode',callback),
    llm:(callback) =>  ipcRenderer.on('llm',callback)
});