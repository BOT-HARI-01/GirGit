const { app, BrowserWindow, Tray, Menu, ipcMain, screen
 } = require('electron')
const path = require('path')
const blocker = require('../native/build/Release/blocker')
const recorder = require('../native/build/Release/listener')
const { registerShortCuts, unregisterShortcuts } = require('./shortcut')
const { WindowsScreenShotHelper } = require('./screenshotHelper');
const { extractTextFromImage } = require('./ocrHelper')
const helper = new WindowsScreenShotHelper();
const { executePYCode } = require('../api/loc_text');
const { transcribeAndStream } = require('../api/recorder')
const { watchChunks } = require('../api/chunks')
const {cohereV2} = require('../OnlineModels/cohereV2')
function separateTextAndCode(output) {
    const codeBlocks = output.match(/```[\s\S]*?```/g) || [];
    let text = output;
    // codeBlocks.forEach(block => console.log(block));
    const code = codeBlocks.map(block => {
        text = text.replace(block, '');
        return block.replace(/^```[\w]*\n|```$/g, '').trim();
    });
    // console.log(text)
    return {
        text: text.trim(),
        code: code.join('\n\n'),
    };
}

function onScreenShotTriggered(mode) {
    helper.takeScreenShot(mode).then(async (path) => {
        mainWindow.webContents.send('message-col', 'Screenshot taken saved to ' + path);
        win.webContents.send('show-screenshots', [path]);
        const text = await extractTextFromImage(path);
        mainWindow.webContents.send('message-col', 'extracted text');
        // console.log('Extracted Text:', text);
    }).catch(err => {
        console.error('Failed to take screenshot:', err);
    });
}

function startRecord(){
    const res = recorder.startCapture();
    console.log(res);
    watchChunks({
    onData: (text) => console.log('[TRANSCRIBED]', text),
    onError: (err) => console.error('[ERROR]', err),
    onEnd: (chunkName) => console.log('[DONE]', chunkName)
});
}
function stopRecord(){
    const res = recorder.stopCapture();
    console.log(res);
    transcribeAndStream({
        onData: (data) => win.webContents.send('voiceMode',data), 
        onError: (err) => win.webContents.send('voiceMode',err),  
        onEnd: (end) => win.webContents.send('voiceMode',end),  

    })
}

async function onEvaluate() {
    mainWindow.webContents.send('message-col', 'Evaluating...');
    const result = await cohereV2();
    // const result = await executePYCode();
    const rawOutput = result?.output ?? '';
    // console.log(rawOutput)
    const separatedOutput = separateTextAndCode(rawOutput);
    // const code = separatedOutput.code.join('\n\n');
    // console.log(code);
    win.webContents.send('get-text', separatedOutput);
    win.showInactive();
}
function getCaptureMode(mode) {
    // console.log("in getcapture mode function",mode)
    mainWindow.webContents.send('captureMode','CaptureMode ' + mode);
}

function scrollControl(direction){
    win.webContents.send('do-scroll',direction);
}
let win,mainWindow;
function CreateWindow() {
    const {width: screenWidth, height: screenHeight} = screen.getPrimaryDisplay().workAreaSize;

    const mainWindowHeight = 80; // Height of the main window
    const mainWindowWidth = 1000; // Width of the main window

    const winHeight = 800; // Height of the main window
    const winWidth = 1280; // Width of the main window

    const centerX = Math.floor((screenWidth - mainWindowWidth) / 2);
    const winCenterX = Math.floor((screenWidth - winWidth) / 2);
    mainWindow = new BrowserWindow({
        width: mainWindowWidth,
        height: mainWindowHeight,
        x: winCenterX,
        y: 0,
        show: true,
        frame: false,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        transparent: true,
        focusable: false,
        webPreferences: {
            preload: path.join(__dirname, '../preload.js'),
            nodeIntegration: true,
            contextIsolation: true,
        },
    });
    mainWindow.loadFile(path.join(__dirname,'../ui/load.html'))
    
    win = new BrowserWindow({
        width: winWidth,
        height: winHeight,
        x: winCenterX,
        y: mainWindowHeight + 1, 
        show: true,
        frame: false,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        transparent: true,
        focusable: false,
        webPreferences: {
            preload: path.join(__dirname, '../preload.js'),
            nodeIntegration: true,
            // contextIsolation: true,
        },
    })

    win.loadFile(path.join(__dirname, '../ui/index.html'));
    // win.webContents.openDevTools({ mode: 'detach' });

    const iconPath = path.join(__dirname, '../assets', 'icon.png');
    console.log(iconPath)
    const tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show', click: () => { win.showInactive(); mainWindow.showInactive(); } },
        { label: 'Hide', click: () => { win.hide(); mainWindow.hide(); } },
        { label: 'Quit', click: () => app.quit() },
    ]);
    tray.setContextMenu(contextMenu);
    tray.setToolTip('GirGit');

    win.setContentProtection(true);
    win.setIgnoreMouseEvents(true);
    mainWindow.setContentProtection(true);
    mainWindow.setIgnoreMouseEvents(true);
    
    win.on('ready-to-show', () => {
        const hwndBuffer = win.getNativeWindowHandle();
        const hwnd1Buffer = mainWindow.getNativeWindowHandle();
        let hwnd,hwnd1;
        if (process.arch === "x64") {
            hwnd = hwndBuffer.readBigUInt64LE();
            hwnd1 = hwnd1Buffer.readBigUInt64LE();
        } else {
            hwnd = hwndBuffer.readUInt32LE();
            hwnd1 = hwnd1Buffer.readUInt32LE();
        }
        console.log(`HWND: ${hwnd}, HWND1: ${hwnd1}`);

        // blocker.disableScreenCapture(Number(hwnd));
        // blocker.disableScreenCapture(Number(hwnd1));
        registerShortCuts(win,mainWindow, onScreenShotTriggered, getCaptureMode,
                onEvaluate,scrollControl,startRecord,stopRecord,haltMouseEvent);
    });
}

function haltMouseEvent(toggleMouse){
    if(toggleMouse){
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
    else{
        mainWindow.setIgnoreMouseEvents(false, { forward: true });    
    }
    mainWindow.webContents.send('message-col','Mouse Toggle: '+ toggleMouse);
}

app.whenReady().then(() => {
    CreateWindow();
});

app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.on('window-all-closed', () => {
    unregisterShortcuts();
    if (process.platform !== 'darwin') app.quit();
});