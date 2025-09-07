import { app, BrowserWindow, Tray, Menu, ipcMain, screen } from "electron";
import path from "path";
//The node cpp code for blocking screen from screen share and a voice recorder of others
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !app.isPackaged;
const nativeDir = isDev
  ? path.join(__dirname, "../native/build/Release")
  : path.join(process.resourcesPath, "native/build/Release");
// const blocker = require('../native/build/Release/blocker');
// const recorder = require('../native/build/Release/listener');
const blocker = require(path.join(nativeDir, "blocker.node"));
const recorder = require(path.join(nativeDir, "listener.node"));
//The global screenshorts file
import { registerShortCuts, unregisterShortcuts } from "./shortcut.js";
//The ps1 script to capture screen in windows
import { WindowsScreenShotHelper } from "./screenshotHelper.js";
const helper = new WindowsScreenShotHelper();
//Teseract ocr for extracting text from captured screenshorts
import { extractTextFromImage } from "./ocrHelper.js";
import { getActiveModel } from "./modelManager.js";
import { askLLM } from "./llmCaller.js";

// creating env file has api keys and the options to select modal
// ** create it even before the launch of the application to avoid errors when other imports & functions accessing the data in env file
import { createEnvFile } from "./envCreator.js";
createEnvFile();

//dotenv loader
// const isDev = !app.isPackaged;
const envPath = isDev
  ? path.join(__dirname, "../.env")
  : path.join(app.getPath("userData"), ".env");
const dotenv = require("dotenv");
dotenv.config({ path: envPath });

//file path logger
const fs = require("fs");
const logPath = path.join(app.getPath("userData"), "path_debug.log");
function log(msg) {
  fs.appendFileSync(logPath, msg + "\n");
}

//code and explination extractor as 2 parts for understability
function separateTextAndCode(output) {
  const codeBlocks = output.match(/```[\s\S]*?```/g) || [];
  let text = output;
  const code = codeBlocks.map((block) => {
    text = text.replace(block, "");
    return block.replace(/^```[\w]*\n|```$/g, "").trim();
  });
  return {
    text: text.trim(),
    code: code.join("\n\n"),
  };
}

//Takes the screenshot using ps1 script for windows
function onScreenShotTriggered(mode) {
  helper
    .takeScreenShot(mode)
    .then(async (path) => {
      mainWindow.webContents.send("message-col", "ScreenShot Captured");
      // win.webContents.send("show-screenshots", [path]);
      const text = await extractTextFromImage(path);
      mainWindow.webContents.send("message-col", "Extracted Text");
    })
    .catch((err) => {
      console.error("Failed to take screenshot:", err);
    });
}

const outputFile = isDev
  ? path.join(__dirname, "../transcription.txt")
  : path.join(app.getPath("userData"), "transcription.txt");
if (!fs.existsSync(outputFile)) {
  fs.writeFileSync(outputFile, "");
}
const modelDir = app.isPackaged
  ? path.join(process.resourcesPath, "native", "models",)
  : path.join(__dirname, "../native/models");
// const modelDir = path.dirname(modelPath);
if (!fs.existsSync(modelDir)) {
  fs.mkdirSync(modelDir, { recursive: true });
  console.log("Created models directory:", modelDir);
} else {
  console.log("Models directory already exists:", modelDir);
}
const availableModels = fs
  .readdirSync(modelDir)
  .filter(file => file.endsWith(".bin"));
let modelPath;
if (availableModels.length > 0) {
    modelPath = path.join(modelDir, availableModels[0]);
  console.log("Found model:", modelPath);
} else {
  console.error("No model file (.bin) found in:", modelDir);
}
//The Transcription function for new wav chunks generated
function startRecord() {
  const res = recorder.startCapture(modelPath);
  fs.writeFileSync(outputFile, "");
  mainWindow.webContents.send("message-col", "Started Recording");
  console.log(res); //logs capture start
  win.webContents.send("voiceMode", res);
  recorder.callback((segment) => {
    console.log("Transcribed:", segment);
    win.webContents.send("voiceMode", segment);
    fs.appendFileSync(outputFile, segment + " ");
  });
  // waitForTranscriptionsDone = watchChunks({
  //   //logs each and every Transcribed chunk 'text, errors, filename'
  //   onData: (text) => console.log("[TRANSCRIBED]", text),
  //   onError: (err) => console.error("[ERROR]", err),
  //   onEnd: (chunkName) => console.log("[DONE]", chunkName),
  // });
}
async function stopRecord() {
  const res = recorder.stopCapture();
  mainWindow.webContents.send("message-col", "Stopped Recording");
  mainWindow.webContents.send("message-col", "Evaluating Question");
  console.log(res); //logs capture end
  //   if (waitForTranscriptionsDone) {
  //   console.log("Waiting for all chunks to be transcribed...");
  //   await waitForTranscriptionsDone();
  // }

  const filePath = isDev
    ? path.join(__dirname, "../transcription.txt")
    : path.join(app.getPath("userData"), "transcription.txt");

  const data = fs.readFileSync(filePath, "utf8");
  const result = await askLLM(data);
  const rawOutput = result?.output ?? "";
  const separatedOutput = separateTextAndCode(rawOutput);
  mainWindow.webContents.send("message-col", "Evaluated");
  win.webContents.send("get-text", separatedOutput);
}

//sends text of ocr_output to llm for AI to answer the question
async function onEvaluate() {
  const filePath = isDev
    ? path.join(__dirname, "../ocr_output.txt")
    : path.join(app.getPath("userData"), "ocr_output.txt");

  const data = fs.readFileSync(filePath, "utf8");
  mainWindow.webContents.send("message-col", "Evaluating...");
  const result = await askLLM(data);
  const rawOutput = result?.output ?? "";
  const separatedOutput = separateTextAndCode(rawOutput);
  win.webContents.send("get-text", separatedOutput);
  mainWindow.webContents.send("message-col", "Evaluated");
  win.showInactive();
}

function getCaptureMode(mode) {
  mainWindow.webContents.send("captureMode", "CaptureMode " + mode);
}

function scrollControl(direction) {
  win.webContents.send("do-scroll", direction);
}
let win, mainWindow;
function CreateWindow() {
  const { width: screenWidth, height: screenHeight } =
    screen.getPrimaryDisplay().workAreaSize;

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
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      // nodeIntegration: false,
      contextIsolation: true,
      sandboxL: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "../ui/load.html"));
  win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: winCenterX,
    y: mainWindowHeight + 1,
    show: true,
    frame: false,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      // nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, "../ui/index.html"));
  // win.webContents.openDevTools({ mode: 'detach' });

  const iconPath = path.join(__dirname, "../assets", "icon.png");
  const tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show",
      click: () => {
        win.showInactive();
        mainWindow.showInactive();
      },
    },
    {
      label: "Hide",
      click: () => {
        win.hide();
        mainWindow.hide();
      },
    },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
  tray.setToolTip("GirGit");

  win.setContentProtection(true);
  win.setIgnoreMouseEvents(true);
  mainWindow.setContentProtection(true);
  mainWindow.setIgnoreMouseEvents(true);
  win.on("ready-to-show", () => {
    const hwndBuffer = win.getNativeWindowHandle();
    const hwnd1Buffer = mainWindow.getNativeWindowHandle();
    let hwnd, hwnd1;
    if (process.arch === "x64") {
      hwnd = hwndBuffer.readBigUInt64LE();
      hwnd1 = hwnd1Buffer.readBigUInt64LE();
    } else {
      hwnd = hwndBuffer.readUInt32LE();
      hwnd1 = hwnd1Buffer.readUInt32LE();
    }
    // console.log(`HWND: ${hwnd}, HWND1: ${hwnd1}`);

    blocker.disableScreenCapture(Number(hwnd));
    blocker.disableScreenCapture(Number(hwnd1));
    registerShortCuts(
      win,
      mainWindow,
      onScreenShotTriggered,
      getCaptureMode,
      onEvaluate,
      scrollControl,
      startRecord,
      stopRecord,
      haltMouseEvent
    );
  });
}

function haltMouseEvent(toggleMouse) {
  if (toggleMouse) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false, { forward: true });
  }
  mainWindow.webContents.send("message-col", "Mouse Toggle: " + toggleMouse);
}
function logAllFilesInDir(startPath, output = []) {
  if (!fs.existsSync(startPath)) return output;

  const files = fs.readdirSync(startPath);
  for (const file of files) {
    const fullPath = path.join(startPath, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      logAllFilesInDir(fullPath, output);
    } else {
      output.push(fullPath);
    }
  }
  return output;
}

app.whenReady().then(() => {
  CreateWindow();
  const { model } = getActiveModel();
  mainWindow.webContents.send("llm", model);
  log(`\n📦 isPackaged: ${app.isPackaged}`);
  log(`📦 resourcesPath: ${process.resourcesPath}`);
  log(`📦 __dirname (main.js): ${__dirname}`);
  const nativeDir = isDev
    ? path.join(__dirname, "..", "native", "build", "Release")
    : path.join(process.resourcesPath, "native", "build", "Release");

  const blockerPath = path.join(nativeDir, "blocker.node");
  const recorderPath = path.join(nativeDir, "listener.node");

  log(`\nNative Modules:`);
  log(
    `blocker.node ➜ ${blockerPath} ${
      fs.existsSync(blockerPath) ? "found" : "missing"
    }`
  );
  log(
    `listener.node ➜ ${recorderPath} ${
      fs.existsSync(recorderPath) ? "found" : " missing"
    }`
  );
  const asarRoot = __dirname;
  const filesInsideAsar = logAllFilesInDir(asarRoot);

  // Log to file or console
  const logPath = path.join(app.getPath("userData"), "asar_contents.log");
  fs.writeFileSync(logPath, filesInsideAsar.join("\n"), "utf-8");
});

app.commandLine.appendSwitch("force-device-scale-factor", "1");

app.on("window-all-closed", () => {
  unregisterShortcuts();
  if (process.platform !== "darwin") app.quit();
});
