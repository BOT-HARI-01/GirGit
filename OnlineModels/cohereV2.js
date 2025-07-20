import { CohereClientV2 } from "cohere-ai";
import fs from "fs";
import { app } from "electron";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;
const envPath = isDev
  ? path.join(__dirname, '../.env')
  : path.join(app.getPath("userData"), '.env');

dotenv.config({ path: envPath });


const cohere = new CohereClientV2({
  token: process.env.COHERE_KEY,
});


export async function cohereV2(data) {
  // const filePath = path.join(app.getPath('userData'),'ocr_output.txt')
  // if(!fs.existsSync(filePath)){
  //   fs.writeFileSync(filePath,'')
  // }
  // const data = fs.readFileSync(filePath, "utf8");
  const response = await cohere.chat({
    model: "command-a-03-2025",
    messages: [
      {
        role: "user",
        content: `You are a helpful assistant. Please clear text and provide correct ouput if code:\n\n${data}`,
      },
    ],
  });

  // console.log(response);
  // console.log("Assistant:", response.message.content[0].text);
  return {
    output: response.message.content[0].text,
  };
}

