const { exec } =  require("child_process")
const path = require("path")
const fs = require( "fs")

async function executePYCode() {

    return new Promise((resolve) => {

    // console.log("here in api ")
    const filePath = path.join(__dirname,"../PyScript/textSol.py");
    // console.log(filePath)
        exec(`python ${filePath}`, (err, stdout, stderr) => {
            if (err) {
                return resolve({ error: stderr || "Execution failed" });
            }
            return resolve({ output: stdout.trim() });
        });
    });
}

module.exports = {
    executePYCode,
}