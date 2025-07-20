import fs from "fs";
import path from "path";
import { app } from "electron";
import { v4 as uuidv4 } from "uuid";
import { promisify } from "util";
import { execFile } from "child_process";

const execFileAsync = promisify(execFile);

export class WindowsScreenShotHelper {
  constructor() {
    this.queue = [];
    this.maxScreenshot = 5;
    this.screenShotDir = path.join(app.getPath("userData"), "screenshots");

    if (!fs.existsSync(this.screenShotDir)) {
      fs.mkdirSync(this.screenShotDir);
    }
  }

  async takeScreenShot(mode) {
    const tempPath = path.join(app.getPath("temp"), `${uuidv4()}.png`);
    const finalPath = path.join(this.screenShotDir, `${uuidv4()}.png`);

const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiHelper {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@
[DpiHelper]::SetProcessDPIAware()

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$mode = '${mode}'
$bounds = $screen.Bounds
$screenWidth = [int]$bounds.Width
$screenHeight = [int]$bounds.Height

switch ($mode) {
    'left' {
        $cropWidth = [int]($screenWidth / 2)
        $bitmap = New-Object System.Drawing.Bitmap $cropWidth, $screenHeight
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen(0, 0, 0, 0, $bitmap.Size)
    }
    'right' {
        $cropWidth = [int]($screenWidth / 2)
        $bitmap = New-Object System.Drawing.Bitmap $cropWidth, $screenHeight
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($cropWidth, 0, 0, 0, $bitmap.Size)
    }
    'full' {
        $bitmap = New-Object System.Drawing.Bitmap $screenWidth, $screenHeight
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen(0, 0, 0, 0, $bitmap.Size)
    }
}

$bitmap.Save('${tempPath.replace(/\\/g, "\\\\")}')
$graphics.Dispose()
$bitmap.Dispose()
`;


    try {
      await execFileAsync("powershell", ["-command", psScript]);
      const buffer = await fs.promises.readFile(tempPath);
      await fs.promises.writeFile(finalPath, buffer);
      await fs.promises.unlink(tempPath);

      this.queue.push(finalPath);
      if (this.queue.length > this.maxScreenshot) {
        const removed = this.queue.shift();
        await fs.promises.unlink(removed).catch(console.error);
      }
      return finalPath;
    } catch (err) {
      console.error("Screenshot failed:", err);
      throw err;
    }
  }

  async getPreview(filepath) {
    const data = await fs.promises.readFile(filepath);
    return `data:image/png;base64,${data.toString("base64")}`;
  }

  async deleteScreenshot(filePath) {
    await fs.promises.unlink(filePath).catch(console.error);
    this.queue = this.queue.filter((p) => p !== filePath);
  }

  getQueue() {
    return this.queue;
  }
}