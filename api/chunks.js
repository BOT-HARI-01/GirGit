import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { app } from "electron";
import { fileURLToPath } from "url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const isDev = !app.isPackaged;
const modelPath = path.join(
  __dirname,
  "../whisper.cpp/models/ggml-small.en.bin"
);
const whisperExe = path.join(
  __dirname,
  "../whisper.cpp/build/bin/Release/whisper-cli.exe"
);
const outputFile = isDev? path.join(__dirname, "../transcription.txt") : path.join(app.getPath("userData"),"transcription.txt");

const chunksDir = isDev? path.join(__dirname, "../chunks") : path.join(app.getPath("userData"), "chunks");

if (!fs.existsSync(chunksDir)) {
  fs.mkdirSync(chunksDir);
}
if (!fs.existsSync(outputFile)) {
    fs.writeFileSync(outputFile, ''); 
}

function transcribeChunk(chunkPath, onData, onError, onEnd) {
    const command = `${whisperExe} -m "${modelPath}" -f "${chunkPath}" --output-txt -otxt -of "${chunkPath}"`;

    exec(command, (err, stdout, stderr) => {
        if (err) {
            onError(stderr || `Failed to transcribe ${chunkPath}`);
        } else {
            const txtPath = `${chunkPath}.txt`;

            fs.readFile(txtPath, 'utf8', (readErr, data) => {
                if (readErr) {
                    onError(readErr.toString());
                } else {
                    fs.appendFile(outputFile, data + '\n', (appendErr) => {
                        if (appendErr) onError(appendErr.toString());
                        else onData(data);
                        onEnd && onEnd(path.basename(chunkPath));
                    });
                }
            });
        }
    });
}


// function watchChunks({ onData, onError, onEnd }) {
//   console.log("Watching for new audio chunks...");
//   const processed = new Set();

//   fs.watch(chunksDir, (event, filename) => {
//     if (event !== "rename" || !filename.endsWith(".wav")) return;

//     const chunkPath = path.join(chunksDir, filename);
//     if (processed.has(filename)) return;

//     // Delay to allow file to fully write
//     setTimeout(() => {
//       if (fs.existsSync(chunkPath)) {
//         processed.add(filename);
//         transcribeChunk(chunkPath, onData, onError, onEnd);
//       }
//     }, 500);
//   });
// }

export function watchChunks({ onData, onError, onEnd }) {
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
    if (event !== "rename" || !filename.endsWith(".wav")) return;

    const chunkPath = path.join(chunksDir, filename);
    if (processed.has(filename)) return;
    // Delay to allow file to fully write
    setTimeout(() => {
      if (fs.existsSync(chunkPath)) {
        processed.add(filename);
        active++;
        transcribeChunk(chunkPath,
          (text) => onData(text),
          (err) => onError(err),
          (chunkName) => {
            onEnd && onEnd(chunkName);
            active--;
            checkIdle();
          }
        );
      }
    }, 500);
  });

  // Return a promise that resolves when active === 0
  const waitForIdle = () =>
    new Promise((resolve) => {
      if (active === 0) return resolve();
      resolveQueue.push(resolve);
    });

  return waitForIdle;
}

