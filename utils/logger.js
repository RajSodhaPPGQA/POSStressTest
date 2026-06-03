const fs = require('fs');
const path = require('path');

let logFilePath = '';

function initLogger(runDir) {
  if (!runDir) return;
  fs.mkdirSync(runDir, { recursive: true });
  logFilePath = path.join(runDir, 'run.log');
}

function log(level, msg) {
  const timestamp = new Date().toISOString();
  const line = `${timestamp} [${level.toUpperCase()}] ${msg}`;
  console.log(line);

  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, `${line}\n`, 'utf8');
    } catch (_e) {
      // Logging to file is best-effort and should never crash automation.
    }
  }
}

module.exports = { log, initLogger };
