# POS Stress Test - User Manual

For details on core framework modules and performance optimization flows, see [Architecture & Optimization Guide](file:///d:/POSStressTest/ARCHITECTURE.md).

## 1. What This Tool Does
This automation repeatedly performs POS transactions in the ParentPay POS Android app.

High-level flow per cycle:

1. Ensure app is on the correct POS screen (self-healing navigation)
2. Select child
3. Build cart (one or more products, configurable quantity each)
4. Click Select Wallet
5. Click Pay
6. Repeat until run completes

It also includes recovery logic for:

- app crashes
- connectivity drops
- watchdog timeout (frozen screen)
- proactive relaunch intervals

## 2. Before You Start

Ensure all below are true:

1. Android device is connected and visible in `adb devices`
2. Appium server is running on port 4723
3. `config.json` has the correct target values
4. ParentPay POS app is installed on target device

### Why `config.json` and `config.runtime.json` Both Exist

- `config.json` is the primary file you edit and keep in source control.
- `config.runtime.json` is a temporary override file for one-off runs (for example changing UDID, duration, or mode without editing the base file).
- Some run commands generate `test.runtime.js` that points to `config.runtime.json`.
- Direct `node test.js` still uses `config.json`.
- Runtime files are disposable and are excluded by `.gitignore`.

## 3. How to Run

In terminal, from project root:

```bash
node test.js
```

If multiple devices are connected, the script may ask you to choose a device.

### One-Click Windows Run (No Terminal Needed)

Double-click the following scripts in sequence:

1. `Start_Appium.bat` - Starts the Appium server.
2. `Run_POS_Automation.bat` - Runs the automation entry point.

These scripts replace the need for manual steps and ensure a streamlined process for testers.

## 4. Run Modes

### Duration Mode

Use when you want to run for a fixed time.

Config:

- `mode`: `"duration"`
- `durationMins`: total minutes to run

### Cycle Mode

Use when you want an exact number of cycles.

Config:

- `mode`: `"cycles"`
- `maxCycles`: number of transaction loops

---

### Execution Modes

#### Standard Mode
* Config: `"executionMode": "standard"`
* Performs standard child lookup, full element probes, and inserts transition delays between taps to mirror human interaction.

#### Rapid Mode
* Config: `"executionMode": "rapid"`
* Optimizes throughput by utilizing child context reuse (skips lookup overlays if consecutive cycles target the same child), product button caching (skips redundant locator requests), and Appium active idle settings to prevent animation locks. Gives OPMs > 9.5+.

## 5. Editing Test Data

### Child Selection

Edit `childName` with a single value or comma-separated list.
The script randomly picks one child each cycle.

```json
"childName": "Child A,Child B,Child C"
```

---

### Product / Cart Configuration (4 modes)

Choose ONE of the following modes. Priority order: `cartProducts` → `products` → `productName`.

---

#### Mode A — Legacy (default, backward-compatible)

Comma-separated product names. One product picked at random each cycle. Quantity is always 1.

```json
"productName": "test for demo,StockTest"
```

Result per cycle example:
```
StockTest x1
```

---

#### Mode B — Random Product + Random Quantity

Define products as objects with a `qty` field. One product is picked at random each cycle.
`qty` can be a fixed number or an array — if array, a random value is chosen.

```json
"products": [
  { "name": "test for demo", "qty": [1, 2, 3] },
  { "name": "StockTest",    "qty": 1 }
]
```

Result per cycle example:
```
test for demo x3
```

---

#### Mode C — Randomized Multi-Product Cart

Define a pool of product names as strings. Each cycle, a random number of products
(up to `maxProductsPerCart`) are picked with random quantities (up to `maxQtyPerProduct`).

```json
"products": ["test for demo", "StockTest", "Burger", "Juice"],
"maxProductsPerCart": 3,
"maxQtyPerProduct": 2
```

Result per cycle example:
```
StockTest x2
Juice x1
```

---

#### Mode D — Explicit Cart (no randomization)

Define the exact cart to execute every cycle. All products are added in the listed order.

```json
"cartProducts": [
  { "name": "test for demo", "qty": 2 },
  { "name": "StockTest",    "qty": 1 }
]
```

Result every cycle:
```
test for demo x2
StockTest x1
```

---

### Quantity Click Timing

When `qty > 1`, the script clicks the same product repeatedly to increment quantity.
A stabilization pause fires between each click so MAUI can process the increment.

```json
"delayBetweenQuantityClicksMs": 1000
```

Lower this only if your device/network is fast and cart updates are reliable.

## 6. Understanding Logs

Console logs use this format:

`<ISO timestamp> [LEVEL] message`

Common levels:

- `SETUP`: startup and navigation actions
- `STATE`: detected app screen state
- `CYCLE`: cycle start and progress
- `TIMING`: action durations
- `ERROR`: cycle-level errors
- `CRASH`: crash/relaunch handling
- `SUCCESS`: run completion

Analytics outputs are created under `Analytics/`:

- `Analytics/reports/report_yyyy-MM-dd_HHmm.html`
- `Analytics/reports/report.xlsx`
- `Analytics/dashboard/live_state.json`

Live dashboard (real-time):

- Default URL: `http://127.0.0.1:5050`
- Config keys:
  - `liveDashboardEnabled`
  - `liveDashboardAutoOpen`
  - `liveDashboardPort`
- Dashboard shows run timing cards:
  - elapsed
  - total run target
  - remaining

> [!NOTE]
> **Active Loop Timing**: All elapsed timers, Rolling OPM, and Stability Duration metrics exclude the startup/login overhead (which takes ~40 seconds). Timing calculation starts precisely when the app lands on the main POS page and starts the first order, representing the true capacity of the POS terminal.

## 7. Failure Screenshots

On major failures, screenshots are automatically saved in `screenshots/`.

Example file pattern:

- `error_cycle_5_crash_<timestamp>.png`
- `error_watchdog_stuck_cycle_3_<timestamp>.png`

Use these to diagnose stuck UI states.

## 8. Recovery Behavior (Automatic)

When issues happen, the script attempts to recover by:

1. reconnecting ADB
2. force-stopping/relaunching the POS app
3. creating a new Appium session
4. re-entering the POS flow from current detected state

No manual intervention is required unless repeated failures continue.

## 9. Common Problems and Actions

### Problem: Device not found

Actions:

1. Run `adb devices`
2. Reconnect cable or Wi-Fi ADB
3. Confirm `udid` in `config.json`

### Problem: Script stuck at one screen

Actions:

1. Increase timeout values in `config.timeouts`
2. Increase delay values in config
3. Verify locator text values in `locators.json`

### Problem: Too many app relaunches

Actions:

1. Verify child/product values exist in target environment
2. Raise `maxMemoryLimitMb` if restarts are memory-triggered
3. Increase `proactiveRelaunchCycles` if relaunches are too frequent

### Problem: Immediate startup failure

Actions:

1. Confirm Appium is running
2. Confirm device is authorized for ADB
3. Confirm app package/activity on device is valid

## 10. Safe Operating Tips

1. Start with a short run (2-3 cycles) after any config change
2. Keep device unlocked and power-connected for long runs
3. Avoid using the device manually during execution
4. Keep Appium terminal visible to detect server-side issues quickly

## 11. End of Run

At completion, script prints success/stability summaries, closes Appium session automatically,
and writes updated analytics reports under `Analytics/reports/`.

---

## 12. Memory Health Risk Analysis

To avoid false-positive leak warnings caused by standard framework/caching growth, the framework analyzes memory slope trends (linear regression over dumpsys logs) alongside stability/slowdown indicators using a 4-tier risk classification model:

1. **Healthy**:
   - Memory slope remains below `0.25 MB/cycle`.
   - No cycle duration slowdown or stability failures occur.
   - *Verdict*: Memory usage is stable.

2. **Memory Growth Observed**:
   - Memory slope is between `0.25 and 0.75 MB/cycle`.
   - No significant performance slowdown (<= 10% drift) and zero failures/recoveries.
   - *Verdict*: Natural framework/image caching. No action needed; standard endurance growth.

3. **Potential Memory Retention**:
   - Memory slope exceeds `0.75 MB/cycle`.
   - Accompanied by cycle duration slowdown (> 10%), recovery loops, or restarts.
   - *Verdict*: Potential resource retention; review app cache and navigation patterns.

4. **High Risk of Memory Leak**:
   - Memory slope exceeds `1.5 MB/cycle`.
   - Combined with significant slowdown (> 20%), app crashes, repeated recoveries, or fatal failures.
   - *Verdict*: Instability detected; detailed heap dump dump analysis is strongly recommended.

