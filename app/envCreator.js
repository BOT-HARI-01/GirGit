import fs from "fs";
import path from "path";
import { app } from "electron";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;
const filePath = isDev
  ? path.join(__dirname, "../.env")
  : path.join(app.getPath("userData"), ".env");
export function createEnvFile() {
  const defaultEnvContent = `## CTRL + S → Does not work in for save when the app is running, "Save Manually"
GITHUB_PAT=""
GEMINI_KEY=""
COHERE_KEY=""
OPENAI_API_KEY=""


#Select the coding Language Preferable Options [CPP, JAVA, PYTHON, etc...]
LANGUAGE = "JAVA"
`;

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultEnvContent, "utf-8");
    console.log(".env file created at", filePath);
  } else {
    console.log(".env file already exists");
  }
}
