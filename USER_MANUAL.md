# POS Stress Test - User Manual

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

## 3. How to Run

In terminal, from project root:

```bash
node test.js
```

If multiple devices are connected, the script may ask you to choose a device.

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

At completion, script prints success summary and closes Appium session automatically.
