const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const modelPath = path.join(__dirname, '../whisper.cpp/models/ggml-small.en.bin');
const whisperExe = path.join(__dirname, '../whisper.cpp/build/bin/Release/whisper-cli.exe');
const chunksDir = path.join(__dirname, '../chunks');
const outputFile = path.join(__dirname, '../transcription.txt');

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

function watchChunks({ onData, onError, onEnd }) {
    console.log('Watching for new audio chunks...');
    const processed = new Set();

    fs.watch(chunksDir, (event, filename) => {
        if (event !== 'rename' || !filename.endsWith('.wav')) return;

        const chunkPath = path.join(chunksDir, filename);
        if (processed.has(filename)) return;

        // Delay to allow file to fully write
        setTimeout(() => {
            if (fs.existsSync(chunkPath)) {
                processed.add(filename);
                transcribeChunk(chunkPath, onData, onError, onEnd);
            }
        }, 500);
    });
}

module.exports = { watchChunks };
