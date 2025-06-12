const Tesseract = require('tesseract.js')
const fs = require('fs')
const path = require('path')


const ocrFilePath = path.join(__dirname, '../ocr_output.txt');

async function extractTextFromImage(filepath){
        const result = await Tesseract.recognize(filepath, 'eng', {
        logger: m => console.log(m),
    });

    const text = result.data.text.trim();
    const timestamp = new Date().toISOString();
    const block = `\n--- OCR Snapshot @ ${timestamp} ---\n${text}\n`;
    // fs.writeFileSync('ocr_output.txt', result.data.text);
    fs.appendFileSync(ocrFilePath, block, 'utf-8');
    return text;
}

module.exports = { extractTextFromImage };