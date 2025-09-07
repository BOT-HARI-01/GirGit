const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const vosk = require("vosk");
const wav = require("node-wav");
const isDev = !app.isPackaged;
const ffi = require("ffi-napi")
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
const chunksDir = isDev
  ? path.join(__dirname, "../chunks")
  : path.join(app.getPath("userData"), "chunks");
if (!fs.existsSync(chunksDir)) {
  fs.mkdirSync(chunksDir);
}
async function transcribeWav(filePath) {
  // Load the model
  const model = new vosk.createModel("./models/vosk-model-en-us-0.22-lgraph");
  const recognizer = new model.Recognizer(16000);

  // Read wav file
  const buffer = fs.readFileSync(filePath);
  const result = wav.decode(buffer);

  if (result.sampleRate !== 16000) {
    throw new Error("WAV must be 16kHz mono PCM for Vosk!");
  }
  if (result.channelData.length > 1) {
    throw new Error("WAV must be mono, not stereo!");
  }

  // Convert to Int16Array
  const pcmData = new Int16Array(result.channelData[0].length);
  for (let i = 0; i < pcmData.length; i++) {
    pcmData[i] = Math.max(
      -32768,
      Math.min(32767, result.channelData[0][i] * 32768)
    );
  }

  // Feed into recognizer
  recognizer.acceptWaveform(pcmData);
  const finalResult = recognizer.finalResult();

  console.log("Transcription:", finalResult.text);
}

// Run test
// transcribeWav("./sample.wav");

function watchChunks({ onData, onError, onEnd }) {
  console.log("Watching for new audio chunks...");
  const processed = new Set();
  let active = 0;

  const resolveQueue = [];

  const checkIdle = () => {
    if (active === 0 && resolveQueue.length) {
      while (resolveQueue.length) resolveQueue.pop()(); // Resolve all waiting promises
    }
  };

  fs.watch(chunksDir, (event, filename) => {
    console.log("chunk found");
    if (event !== "rename" || !filename.endsWith(".wav")) return;

    const chunkPath = path.join(chunksDir, filename);
    if (processed.has(filename)) return;
    // Delay to allow file to fully write
    setTimeout(() => {
      if (fs.existsSync(chunkPath)) {
        processed.add(filename);
        active++;
        transcribeWav(
          chunkPath,
          (text) => onData(text),
          (err) => onError(err),
          (chunkName) => {
            onEnd && onEnd(chunkName);
            active--;
            checkIdle();
          }
        );
      }
    }, 1000);
  });

  // Return a promise that resolves when active === 0
  const waitForIdle = () =>
    new Promise((resolve) => {
      if (active === 0) return resolve();
      resolveQueue.push(resolve);
    });

  return waitForIdle;
}

module.exports = { watchChunks };
