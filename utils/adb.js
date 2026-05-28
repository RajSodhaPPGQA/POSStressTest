const { execSync } = require('child_process');
const { log } = require('./logger');
const config = require('../config.json');

/**
 * Reconnects wireless ADB if it matches IP pattern
 */
function reconnectAdb(udid) {
  const ipPattern = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$/;
  const match = udid.match(ipPattern);
  if (match) {
    const ip = match[1];
    const port = match[2];
    log("ADB", `Attempting auto-reconnect to wireless UDID ${ip}:${port}...`);
    try {
      const output = execSync(`adb connect ${ip}:${port}`).toString();
      log("ADB", `ADB connect result: ${output.trim()}`);
      return true;
    } catch (e) {
      log("ADB_ERROR", `Failed to connect via ADB: ${e.message}`);
      return false;
    }
  }
  return false;
}

/**
 * Ensures the target device is connected and responds to ADB commands.
 * Runs reconnect loops if offline or missing.
 */
function ensureAdbConnected(udid, retries = 3) {
  const isUsbMode = config.connectionMode === 'usb';
  const usbReconnectTimeoutMs = config.usbReconnectTimeoutMs || 120000;
  const adbWaitForDeviceTimeoutMs = config.adbWaitForDeviceTimeoutMs || 20000;

  for (let i = 1; i <= retries; i++) {
    try {
      const output = execSync('adb devices').toString();
      const lines = output.trim().split('\n');
      let isConnected = false;
      
      for (let j = 1; j < lines.length; j++) {
        const line = lines[j].trim();
        if (line.includes(udid) && line.includes('device')) {
          isConnected = true;
          break;
        }
      }
      
      if (isConnected) {
        return true;
      }
      
      if (isUsbMode) {
        log("RECONNECT", `⚠️ USB Device "${udid}" disconnected! Waiting for physical hotplug...`);
        let usbFound = false;
        const reconnectStart = Date.now();
        while (!usbFound && (Date.now() - reconnectStart) < usbReconnectTimeoutMs) {
          try {
            const hotplugOutput = execSync('adb devices').toString();
            const hotLines = hotplugOutput.trim().split('\n');
            for (let k = 1; k < hotLines.length; k++) {
              const line = hotLines[k].trim();
              if (line.includes(udid) && line.includes('device')) {
                log("RECONNECT_RECOVERY", `🎉 USB Device "${udid}" reconnected! Resuming execution...`);
                usbFound = true;
                break;
              }
            }
          } catch (e) {}
          if (!usbFound) {
            execSync('ping 127.0.0.1 -n 2 > nul');
          }
        }

        if (!usbFound) {
          log("RECONNECT_WARNING", `USB reconnect timed out after ${usbReconnectTimeoutMs}ms for device "${udid}".`);
          continue;
        }

        return true;
      } else {
        log("RECONNECT", `Device "${udid}" not found or offline in adb devices (Attempt ${i}/${retries}). Reconnecting...`);
        const ipPattern = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$/;
        if (udid.match(ipPattern)) {
          execSync(`adb disconnect ${udid}`);
          reconnectAdb(udid);
        }
        
        execSync(`adb -s ${udid} wait-for-device`, { timeout: adbWaitForDeviceTimeoutMs });
        
        // Let it settle
        execSync('ping 127.0.0.1 -n 2 > nul'); // cross-platform simple sync sleep in batch
      }
    } catch (err) {
      log("ADB_WARNING", `ADB verification step failure: ${err.message}`);
    }
  }
  
  // Return final check
  try {
    const output = execSync('adb devices').toString();
    return output.includes(udid) && output.includes('device');
  } catch (e) {
    return false;
  }
}

/**
 * Checks internet status on the device via shell ping.
 * Auto-heals Wi-Fi if connectivity is down.
 */
function checkNetworkStatus(udid) {
  log("NETWORK", "Checking device internet connectivity...");
  try {
    // Ping public Google DNS from Android shell (1 ping, 5 second timeout)
    const pingOutput = execSync(`adb -s ${udid} shell ping -c 1 -W 5 8.8.8.8`).toString();
    if (pingOutput.includes("1 received") || pingOutput.includes("1 packets received")) {
      log("NETWORK", "Device internet connectivity verified [ONLINE]");
      return true;
    }
  } catch (e) {
    log("NETWORK_WARN", `Device cannot reach internet (ping failed). Attempting Wi-Fi auto-healing...`);
  }

  // Attempt Auto-Healing Wi-Fi
  try {
    log("NETWORK", "Enabling Wi-Fi and mobile data on device via ADB...");
    execSync(`adb -s ${udid} shell svc wifi enable`);
    execSync(`adb -s ${udid} shell svc data enable`);
    
    // Wait for Wi-Fi association (10 seconds sync wait)
    log("NETWORK", "Waiting 10 seconds for Wi-Fi association...");
    execSync('ping 127.0.0.1 -n 11 > nul');
    
    // Re-verify
    const pingOutput = execSync(`adb -s ${udid} shell ping -c 1 -W 5 8.8.8.8`).toString();
    if (pingOutput.includes("1 received") || pingOutput.includes("1 packets received")) {
      log("NETWORK_RECOVERY", "Internet connectivity recovered successfully after auto-healing [ONLINE]");
      return true;
    }
  } catch (err) {
    log("NETWORK_ERROR", `Wi-Fi auto-healing completed, but internet remains unreachable: ${err.message}`);
  }
  return false;
}

/**
 * Retrieves the total heap memory (PSS) in MB consumed by the POS app.
 */
function getAppMemoryUsage(udid) {
  try {
    const output = execSync(`adb -s ${udid} shell dumpsys meminfo com.parentpay.PointOfService`).toString();
    // Locate the row with "TOTAL" or "TOTAL PSS"
    const lines = output.split('\n');
    for (let line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('TOTAL:') || trimmed.startsWith('TOTAL')) {
        const parts = trimmed.split(/\s+/);
        // Column index of Pss Total varies, but in standard meminfo it is the first or second numeric value after the label
        // Format e.g.: "TOTAL:   143820   120932 ... " or "TOTAL     143820"
        const memoryKb = parseInt(parts[1]) || parseInt(parts[2]);
        if (memoryKb) {
          const memoryMb = (memoryKb / 1024).toFixed(1);
          return { kb: memoryKb, mb: parseFloat(memoryMb) };
        }
      }
    }
  } catch (e) {
    log("MEM_WARNING", `Could not retrieve memory statistics: ${e.message}`);
  }
  return null;
}

module.exports = {
  reconnectAdb,
  ensureAdbConnected,
  checkNetworkStatus,
  getAppMemoryUsage
};
