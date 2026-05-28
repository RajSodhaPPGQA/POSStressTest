# POS Stress Test - Setup Guide

## 1. Project Purpose
This project runs automated stress transactions for the ParentPay POS Android app using WebdriverIO + Appium.

Main execution file: `test.js`

## 2. Prerequisites

Install the following on the machine running the test:

1. Node.js 18+ (LTS recommended)
2. Android SDK Platform Tools (ADB must be available in PATH)
3. Appium 2.x (global install recommended)
4. Java (required by Android automation stack)
5. ADB-connected Android target device (USB or Wi-Fi)

## 3. Install Dependencies

From the project root:

```bash
npm install
```

## 4. Verify Device Connectivity

Check if device is visible to ADB:

```bash
adb devices
```

If using Wi-Fi, connect first:

```bash
adb connect <device-ip>:<port>
adb devices
```

## 5. Start Appium Server

In a separate terminal:

```bash
appium --port 4723
```

Keep this terminal running while tests execute.

## 6. Configure Test Inputs

Edit `config.json` before execution.

### Core Run Controls

- `mode`: `"duration"` or `"cycles"`
- `durationMins`: run length in minutes when `mode=duration`
- `maxCycles`: max iterations when `mode=cycles`

### Device Settings

- `udid`: ADB device ID (USB serial or `ip:port`)
- `connectionMode`: `"wifi"` or `"usb"`
- `keepAwake`: prevents device sleep using ADB power command
- `newCommandTimeout`: Appium command timeout

### Test Data (comma-separated supported)

- `childName`: one or many child names, comma separated
- `productName`: one or many product names, comma separated

The script randomly picks one value from each list per cycle.

### Timing Controls

- `delayAfterChildMs`
- `delayAfterProductMs`
- `delayAfterWalletMs`
- `delayAfterPayMs`
- `maxCycleTimeMs`: watchdog timeout for one transaction cycle

### Stability/Health Controls

- `proactiveRelaunchCycles`: restart app/session after every N cycles
- `maxMemoryLimitMb`: restart app/session if memory exceeds limit

### Optional Dynamic Locators

These values override matching keys in `locators.json` at runtime:

- `schoolDev`
- `hierarchyLeft`
- `hierarchyRight`
- `menuOption`

## 7. Run the Test

From project root:

```bash
node test.js
```

## 8. Output and Artifacts

- Runtime logs are printed to terminal with timestamp and level.
- Failure screenshots are written to `screenshots/` as:
  - `error_<context>_<timestamp>.png`

## 9. Quick Troubleshooting

### Appium Session Not Starting

1. Confirm Appium server is running on port 4723
2. Confirm device appears in `adb devices`
3. Reconnect Wi-Fi device: `adb connect <ip:port>`

### Device Offline / Disconnected

1. Check cable or network
2. Run `adb devices`
3. Reconnect and rerun

### Stuck/Frozen POS Flow

1. Increase `maxCycleTimeMs`
2. Increase delays in `config.json`
3. Verify locators and app text values in `locators.json`

### Repeated Recovery Loops

1. Verify target app package/activity is valid
2. Confirm test data values exist in current POS environment
3. Check whether hierarchy/menu labels changed

## 10. Recommended Operating Pattern

1. Start Appium
2. Validate ADB connectivity
3. Run a short smoke run (`mode=cycles`, `maxCycles=2`)
4. Start longer stress run
