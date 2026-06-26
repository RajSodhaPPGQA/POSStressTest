# Framework Architecture Guide

This document describes the design patterns, object hierarchies, and interface boundary layers of the ParentPay POS Stress Testing Framework.

---

## 1. Page Object Model (POM) Hierarchy
The framework enforces a strict Page Object Model to keep selector queries and interaction steps decoupled from execution logic:

```
                  ┌────────────────────────┐
                  │      BasePage.js       │ (Common UI / Alert Handlers)
                  └───────────┬────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐
│   POSPage.js    │  │ CheckoutPage.js │  │DashboardPage.js  │ ...
└─────────────────┘  └─────────────────┘  └──────────────────┘
(Grid/Product Sel)   (Wallet / Payment)   (Initial POS Menu)
```

### 1.1 `BasePage.js`
* **Role**: Parent base class.
* **Responsibilities**:
  - Implements standard Appium action wrappers (e.g., scroll-to-element, custom click loops).
  - Handles detection and dismissal of native OS alert dialogs (`checkForAlertsAndDismiss`).
  - Saves screenshot files on failure paths (`saveFailureScreenshot`).

### 1.2 `POSPage.js`
* **Role**: Coordinates target grid interactions.
* **Responsibilities**:
  - Performs child lookup search overlays.
  - Adds products to the active basket.
  - Handles item categories, quantity counters, and caching mechanisms under Rapid mode.

### 1.3 `CheckoutPage.js`
* **Role**: Controls payment screens.
* **Responsibilities**:
  - Handles wallet option selects, paying processing stages, and waiting for transaction resolution overlays.

---

## 2. WebdriverIO & Appium Interface
The runner (`test.js`) connects to Appium Server (v2) on Port 4723 using the WebdriverIO client (`remote()`).

### 2.1 Capability Configuration
The framework passes targeted capabilities to launch and control the Android package:
* `platformName`: `"Android"`
* `appium:automationName`: `"UiAutomator2"`
* `appium:appPackage`: `"com.parentpay.PointOfService"`
* `appium:appActivity`: `"com.parentpay.PointOfService.MainActivity"`
* `appium:noReset`: `true` (retains app settings/login states across session restarts)

### 2.2 Appium Engine Tuning
When **Rapid Mode** is activated, Appium settings are dynamically tuned after driver initialization to bypass default Native transition blocks:
* `waitForIdleTimeout`: `100` (reduces Appium's waiting for Android layout idle state from 10s to 100ms)
* `actionAcknowledgmentTimeout`: `0` (speeds up touch injection confirmations)

---

## 3. ADB Integration Layer (`utils/adb.js`)
Since Appium wraps around ADB but can freeze during target instrumentation failure states, this framework interacts directly with ADB on the host machine to manage hardware-level gates:

### 3.1 Device Status Check
* Checks device online list via `adb devices`.
* Restores offline device ports via TCP socket retries (`adb connect`).

### 3.2 Application Health Control
* Forces termination of hung processes: `adb shell am force-stop com.parentpay.PointOfService`.
* Installs/Relaunches App packages: `adb shell am start -n com.parentpay.PointOfService/com.parentpay.PointOfService.MainActivity`.

### 3.3 Memory Measurement
* Periodically dumps application memory maps: `adb shell dumpsys meminfo com.parentpay.PointOfService`.
* Extracts PSS/RSS heap size values to feed the regression engine.

### 3.4 Service Reset
* If UiAutomator2 locks up or throws connection refuse sockets, the ADB controller clears background packages:
  `adb shell pm clear com.parentpay.PointOfService.test`
  `adb shell pm clear io.appium.uiautomator2.server`
