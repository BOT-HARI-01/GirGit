const path = require('path');
const { exec, spawn } = require('child_process');

const audioPath = path.join(__dirname, '../output.wav');
const modelPath = path.join(__dirname, '../whisper.cpp/models/ggml-base.en.bin');
const whisperExe = path.join(__dirname, '../whisper.cpp/build/bin/Release/whisper-cli.exe');
const transcribeFile = path.join(__dirname, '../transcription');
const pyScript = path.join(__dirname, '../PyScript/audioSol.py');

function transcribeAndStream({ onData, onError, onEnd }) {
    // exec(`${whisperExe} -m ${modelPath} -f ${audioPath} -of ${transcribeFile} --output-txt`, (err, stdout, stderr) => {
    //     if (err) {
    //         onError(stderr || 'Whisper failed');
    //         return;
    //     }
    // });
    const py = spawn('python', ['-u', pyScript]);

    py.stdout.on('data', (chunk) => {
        onData(chunk.toString());
    });

    py.stderr.on('data', (err) => {
        onError(err.toString());
    });

    py.on('close', (code) => {
        onEnd(`ended ${code}`);
    });
}

module.exports = { transcribeAndStream };
