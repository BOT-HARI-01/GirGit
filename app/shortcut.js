import { globalShortcut, app, shell } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { switchModel } from "./modelManager.js";

let currModeIndex = 0;
const modes = ["Left", "Right", "Full"];

let toggleMouse = false;

function getCurrentMode() {
  return modes[currModeIndex];
}

function cycleMode() {
  currModeIndex = (currModeIndex + 1) % modes.length;
  const mode = getCurrentMode();
}
export function registerShortCuts(
  win,
  mainWindow,
  onScreenShotTriggered,
  getCaptureMode,
  onEvaluate,
  scrollControl,
  startRecord,
  stopRecord,
  haltMouseEvent,
  evaluteRecording,
  liveTranscript,
) {
  const step = 50;
  //movement
globalShortcut.register("Control+Up", () => {
  const [x, y] = win.getPosition();
  win.setPosition(x, y - step);
  const [mainX, mainY] = mainWindow.getPosition();
  mainWindow.setPosition(mainX, mainY - step);
});

  globalShortcut.register("Control+down", () => {
    const [ x, y ] = win.getPosition();
    const [ mainX, mainY ] = mainWindow.getPosition();
    win.setPosition( x, y + step );
    mainWindow.setPosition( mainX, mainY + step );
  });

  globalShortcut.register("Control+left", () => {
    const [ x, y ] = win.getPosition();
    const [ mainX, mainY ] = mainWindow.getPosition();
    win.setPosition( x - step, y );
    mainWindow.setPosition( mainX - step, mainY );
  });

  globalShortcut.register("Control+right", () => {
    const [ x, y ] = win.getPosition();
    const [ mainX, mainY ] = mainWindow.getPosition();
    win.setPosition( x + step, y );
    mainWindow.setPosition( mainX + step, mainY );
  });

  //scroll page
  globalShortcut.register("Control+Shift+Up", () => {
    scrollControl("Up");
  });
  globalShortcut.register("Control+Shift+Down", () => {
    scrollControl("Down");
  });

  //off or on
  globalShortcut.register("Control+H", () => {
    win.hide(); 
    mainWindow.hide();
  });
  globalShortcut.register("Control+S", () => {
    win.showInactive();
    mainWindow.showInactive();
  });
  globalShortcut.register("Control+Q", () => {
    app.quit();
  });

  //capture
  globalShortcut.register("Control+Shift+S", async () => {
    console.log("shortcut triggered");
    const mode = getCurrentMode();
    onScreenShotTriggered(mode);
  });
  //open model folder
  globalShortcut.register("Control+Shift+O", async () =>{
    const modelDir = app.isPackaged
      ? path.join(process.resourcesPath, "native", "models",)
      : path.join(__dirname, "../native/models");
      shell.openPath(modelDir);
  })
  //clear ocrdata
  const isDev = !app.isPackaged;
  globalShortcut.register("Ctrl+Shift+C", () => {
    const filePath = isDev? path.join(__dirname, "../ocr_output.txt") : path.join(app.getPath("userData"),'ocr_output.txt'); 
    fs.writeFileSync(filePath, "", "utf-8");
    win.webContents.send("get-text", { text: "", code: "" });
    win.webContents.send("voiceMode", "__CLEAR__");
    mainWindow.webContents.send("message-col", "OCR CLEARED");
    console.log("OCR output cleared");
    liveTranscript = "";21
  });
  //Evaulate captured images
  globalShortcut.register("Control+Enter", async () => {
    console.log("evalute triggered");
    onEvaluate();
  });
  //cycle Capture modes
  globalShortcut.register("Control+M", () => {
    cycleMode();
    const mode = getCurrentMode(); 
    getCaptureMode(mode);
  });
  //record
  globalShortcut.register("Control+R", () => {
    startRecord();
  });
  globalShortcut.register("Control+E", () => {
    evaluteRecording();
  });
  globalShortcut.register("Control+W", () => {
    stopRecord();
  });

  //mouse
  globalShortcut.register("Control+Shift+I", () => {
    haltMouseEvent(toggleMouse);
    toggleMouse = !toggleMouse; 
  });
  //swith Model
  globalShortcut.register("control+Shift+M",() => {
    const {model} = switchModel();
    mainWindow.webContents.send("llm",model);
  });
  //open ENV
  globalShortcut.register("Control+.",() =>{
    const filePath = isDev? path.join(__dirname, "../.env") : path.join(app.getPath("userData"),'.env');
    shell.openPath(filePath);
  })
}

export function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}


