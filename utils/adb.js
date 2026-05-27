const { execSync } = require('child_process');
const { log } = require('./logger');

function reconnectAdb(udid) {
  // Check if the UDID is an IP address with port (e.g., 192.168.4.34:33023 or 192.168.1.5:5555)
  const ipPattern = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$/;
  const match = udid.match(ipPattern);
  if (match) {
    const ip = match[1];
    const port = match[2];
    log("ADB", `Detected wireless UDID. Attempting auto-reconnect to ${ip}:${port}...`);
    try {
      const output = execSync(`adb connect ${ip}:${port}`).toString();
      log("ADB", `ADB connect output: ${output.trim()}`);
    } catch (e) {
      log("ADB_ERROR", `Failed to run adb connect: ${e.message}`);
    }
  } else {
    log("ADB", `UDID "${udid}" is not a wireless IP address. Skipping auto-reconnect.`);
  }
}

module.exports = { reconnectAdb };
