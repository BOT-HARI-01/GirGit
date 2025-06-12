const { globalShortcut, app } = require("electron");
const { WindowsScreenShotHelper } = require("./screenshotHelper");
const path = require("path");
const fs = require("fs");
const helper = new WindowsScreenShotHelper();

let currModeIndex = 0;
const modes = ["left", "right", "full"];

let toggleMouse = false;

function getCurrentMode() {
  return modes[currModeIndex];
}

function cycleMode() {
  currModeIndex = (currModeIndex + 1) % modes.length;
  const mode = getCurrentMode();
}
function registerShortCuts(
  win,
  mainWindow,
  onScreenShotTriggered,
  getCaptureMode,
  onEvaluate,
  scrollControl,
  startRecord,
  stopRecord,
  haltMouseEvent,
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
  //clear ocrdata
  globalShortcut.register("Ctrl+Shift+C", () => {
    const filePath = path.join(__dirname, "../ocr_output.txt");
    fs.writeFileSync(filePath, "", "utf-8");
    console.log("OCR output cleared");
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
    stopRecord();
  });

  //mouse
  globalShortcut.register("Control+Shift+I", () => {
    haltMouseEvent(toggleMouse);
    toggleMouse = !toggleMouse; 
  });
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}

module.exports = {
  registerShortCuts,
  unregisterShortcuts,
};
