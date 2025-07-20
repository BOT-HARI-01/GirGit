import Tesseract from 'tesseract.js';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;
const ocrfilepath = isDev
  ? path.join(__dirname, '../ocr_output.txt')
  : path.join(app.getPath('userData'), 'ocr_output.txt');

if(!fs.existsSync(ocrfilepath)){
    fs.writeFileSync(ocrfilepath,'')
}

//using Tesseract OCR extracting text from the image n storing it to text file 'ocr_output.txt'
export async function extractTextFromImage(filepath){
        const result = await Tesseract.recognize(filepath, 'eng', {
        logger: m => console.log(m),
    });

    const text = result.data.text.trim();
    const timestamp = new Date().toISOString();
    const block = `\n--- OCR Snapshot @ ${timestamp} ---\n${text}\n`;
    fs.appendFileSync(ocrfilepath, block, 'utf-8');
    return text;
}