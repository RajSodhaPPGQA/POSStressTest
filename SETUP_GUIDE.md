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

### Test Data

**Child selection** (comma-separated, one picked at random each cycle):
```json
"childName": "Child A,Child B"
```

**Product / Cart configuration — choose ONE mode:**

| Mode | Key | Behavior |
|------|-----|----------|
| A — Legacy (default) | `productName` | 1 random product, qty always 1 |
| B — Random product + qty | `products` (object array) | 1 random product, fixed or random qty |
| C — Random multi-product cart | `products` (string array) + `maxProductsPerCart` + `maxQtyPerProduct` | Random 1–N products, random qty each |
| D — Explicit cart | `cartProducts` | All listed products, exact qty, every cycle |

Priority: `cartProducts` → `products` → `productName`

**Mode A — Legacy (no changes needed for existing configs):**
```json
"productName": "test for demo,StockTest"
```

**Mode B — Random product + random qty:**
```json
"products": [
  { "name": "test for demo", "qty": [1, 2, 3] },
  { "name": "StockTest",    "qty": 1 }
]
```

**Mode C — Randomized multi-product cart:**
```json
"products": ["test for demo", "StockTest", "Burger"],
"maxProductsPerCart": 3,
"maxQtyPerProduct": 2
```

**Mode D — Explicit cart (same every cycle):**
```json
"cartProducts": [
  { "name": "test for demo", "qty": 2 },
  { "name": "StockTest",    "qty": 1 }
]
```

### Timing Controls

- `delayAfterChildMs` — pause after child selection
- `delayAfterProductMs` — pause after full cart is built
- `delayAfterWalletMs` — pause after wallet selection
- `delayAfterPayMs` — pause after payment
- `delayBetweenQuantityClicksMs` — pause between repeated clicks on the same product (qty increment). Default: 1000ms
- `maxCycleTimeMs` — watchdog timeout for one transaction cycle

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
