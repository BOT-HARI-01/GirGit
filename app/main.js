import { app, BrowserWindow, Tray, Menu, ipcMain, screen } from "electron";
import fs from 'fs';
import path from "path";
import pkg from "follow-redirects";
const { https } = pkg;
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
import { shell } from "electron";
// creating env file has api keys and the options to select modal
// ** create it even before the launch of the application to avoid errors when other imports & functions accessing the data in env file
import { createEnvFile } from "./envCreator.js";
import { globalShortcut } from "electron";
createEnvFile();

//dotenv loader
// const isDev = !app.isPackaged;
const envPath = isDev
  ? path.join(__dirname, "../.env")
  : path.join(app.getPath("userData"), ".env");
const dotenv = require("dotenv");
dotenv.config({ path: envPath });
function checkDefApiKey() {
  if (!process.env.GEMINI_KEY) {
    shell.openExternal("https://aistudio.google.com/apikey");
    mainWindow.webContents.send("apiSetup", "SETUP API KEY");
    win.webContents.send(
      "voiceMode",
      `
  <div style="
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    text-align: center;
  ">
    <div><b><h1>Woahhhh.... Wassup</h1></b></div>
    <div><b><h2>Complete the initial setup</h2></b></div>
    <div><b>1. Create an API KEY from Gemini</b></div> 
    <div><b>2. Copy the API KEY</b></div>
    <div><b>3. Ctrl + .   → Open "ENV" file & paste the API key</b></div>
    <div><b>4. Save the .env file</b></div>
    <div><b>5. Wait Till the Resource is downloaded initially</b></div>
    <div><b> Do not close until the Resource download is finished</b></div>
    <div><b>Restart the appliation and ready to go</b></div>
  </div>
`
    );

    globalShortcut.unregister("ctrl + s");
  }else{
    mainWindow.webContents.send("apiSetup", "API KEY FOUND");
  }
}


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
  mainWindow.webContents.send(
    "commands",
    `
        <div><b>Ctrl + Enter</b> → Evaluate</div>
        <div><b>Ctrl + Shift + C </b> → Clear screenshot</div>
    `
  );
  helper
    .takeScreenShot(mode)
    .then(async (path) => {
      mainWindow.webContents.send("message-col", "ScreenShot Captured");
      const text = await extractTextFromImage(path);
      mainWindow.webContents.send("message-col", "Extracted Text");
    })
    .catch((err) => {
      console.error("Failed to take screenshot:", err);
    });
}

function safeSend(channel, message) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send(channel, message);
  }
}

let modelPath;
const outputFile = isDev
  ? path.join(__dirname, "../transcription.txt")
  : path.join(app.getPath("userData"), "transcription.txt");
if (!fs.existsSync(outputFile)) {
  fs.writeFileSync(outputFile, "");
}
const modelDir = app.isPackaged
  ? path.join(process.resourcesPath, "native", "models")
  : path.join(__dirname, "../native/models");
if (!fs.existsSync(modelDir)) {
  fs.mkdirSync(modelDir, { recursive: true });
  console.log("Created models directory:", modelDir);
} else {
  console.log("Models directory already exists:", modelDir);
}
const availableModels = fs
  .readdirSync(modelDir)
  .filter((file) => file.endsWith(".bin"));
function getVoiceModel() {
  if (availableModels.length > 0) {
    modelPath = path.join(modelDir, availableModels[0]);
    console.log("Found model:", modelPath);
  } else {
    console.error("No model file (.bin) found in:", modelDir);
    mainWindow.webContents.send("message-col", "Downloading Resource...");
    const dowloadLink =
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin";
    const downloadFileName = "ggml-small-q8.0.bin";
    const tempFile = downloadFileName + ".path";
    const downloadPath = path.join(modelDir, tempFile);
    const finalFile = path.join(modelDir, downloadFileName);

    const file = fs.createWriteStream(downloadPath);
    https
      .get(dowloadLink, (response) => {
        const totalSize = parseInt(response.headers["content-length"], 10);
        let downloaded = 0;
        response.on("data", (chunk) => {
          downloaded += chunk.length;
          const percent = ((downloaded / totalSize) * 100).toFixed(2);
          safeSend("message-col", `Downloading: ${percent}%`);
        });
        response.pipe(file);
        file.on("finish", () => {
          fs.renameSync(downloadPath, finalFile);
          file.close();
          console.log("Model downloaded:", downloadPath);
          mainWindow.webContents.send("message-col", "Resource Downloaded");
        });
      })
      .on("error", (err) => {
        fs.unlink(downloadPath, () => {});
        // console.error("Error downloading model:", err.message);
        mainWindow.webContents.send(
          "message-col",
          "Download Failed! Restart App"
        );
      });
  }
}
let liveTranscript = "";
//The Transcription function for new wav chunks generated
function startRecord() {
  mainWindow.webContents.send(
    "commands",
    `
        <div>🎙️Recording Started</div>
        <div><b>Ctrl + E</b> → Evaluate</div>
        <div><b>Ctrl + W</b> → Stop Recording</div> 
    `
  );
  const res = recorder.startCapture(String(modelPath));
  fs.writeFileSync(outputFile, "");
  mainWindow.webContents.send("message-col", "Started Recording");
  // console.log(res); //logs capture start
  // win.webContents.send("voiceMode", res);
  recorder.callback((segment) => {
    console.log("\nTranscribed:", segment);
    liveTranscript += segment + " ";
    win.webContents.send("voiceMode", segment);
    fs.appendFileSync(outputFile, segment + " ");
  });
}
async function stopRecord() {
  const res = recorder.stopCapture();
  mainWindow.webContents.send("message-col", "Stopped Recording");
}
async function evaluteRecording() {
  win.webContents.send("get-text", { text: "", code: "" });
  mainWindow.webContents.send("message-col", "Evaluating Question");
  // const filePath = isDev
  //   ? path.join(__dirname, "../transcription.txt")
  //   : path.join(app.getPath("userData"), "transcription.txt");

  // const data = fs.readFileSync(filePath, "utf8");
  liveTranscript = liveTranscript.trim();
  if (!liveTranscript) {
    mainWindow.webContents.send("message-col", "No Transcript Yet...");
  }
  const result = await askLLM(liveTranscript);
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
  const mainWindowWidth = 1280; // Width of the main window

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
    checkDefApiKey();
    getVoiceModel();

    mainWindow.webContents.send(
      "commands",
      `
        <div><b>Ctrl + Shift + S </b> → ScreenShot</div>
        <div><b>Ctrl + R </b> → Start Recording</div> 
    `
    );
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
      haltMouseEvent,
      evaluteRecording,
      liveTranscript
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
