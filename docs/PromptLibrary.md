# AI Prompt Library

A collection of copy-pasteable prompts to interact with AI coding assistants (such as Gemini, ChatGPT, or Claude) when developing, auditing, or debugging the ParentPay Point of Service (POS) Stress Testing Framework.

---

## 1. Feature Implementation

### 1.1 Implementing a Custom Payment Method
```
You are an expert mobile automation engineer working on the ParentPay POS Stress Testing Framework.
I need you to implement a new card-based checkout payment step.

Current structure:
- CheckoutPage.js: Static helper containing clickPay() method.
- locators.json: Contains UI text labels.

Tasks:
1. Add a selector for the Card Payment option to locators.json.
2. In CheckoutPage.js, implement clickCardPayment(driver) which:
   - Locates the Card payment button relative to Checkout view.
   - Uses BasePage.safeClick() to execute the tap.
   - Verifies the payment card processing overlay appears before initiating pay.
3. Keep it backward-compatible by reading the checkout mode from config.json (e.g., config.checkoutMode = "card" or "cash").
4. Follow logging rules using log("CHECKOUT", ...) from utils/logger.js.
```

### 1.2 Centralizing Package Names
```
Refactor the framework to centralize the Android application package name ("com.parentpay.PointOfService").

Currently, this string is hardcoded in:
- test.js (ADB start activity/force-stop)
- utils/adb.js (dumpsys meminfo)
- utils/popupManager.js (app terminate/activate)

Tasks:
1. Add "appPackage" and "appActivity" to config.json.
2. Update all occurrences of the hardcoded package string to read from config.appPackage dynamically.
3. Ensure that if config.appPackage is undefined, it falls back to the default "com.parentpay.PointOfService".
```

---

## 2. Bug Investigation & Triage

### 2.1 Debugging Watchdog Timeouts
```
Our stress test cycles are hitting WATCHDOG_TIMEOUT errors on the Checkout screen.

Here is the traceback:
[Paste error log here]

Tasks:
1. Inspect CheckoutPage.js clickPay() loop. It currently polls a matches selector with a 45-second timeout.
2. Check if the element 'nameButton' or 'closeButton' text values in locators.json match the current UI screenshot state.
3. Recommend how to shorten polling intervals under rapid execution mode and add popup diagnostics if matches fail.
```

### 2.2 Fixing Windows-Specific Sleep Hacks
```
In utils/adb.js, the framework uses execSync('ping 127.0.0.1 -n 2 > nul') as a cross-platform sync sleep hack. This blocks the main Node.js event loop thread and is Windows-specific.

Refactor this to:
1. Use a standard asynchronous timeout sleep helper.
2. Explain how to wrap sync sleeps safely inside native shell wait commands if synchronous execution is required in specific ADB state-checks.
```

---

## 3. Performance & Throughput Audits

### 3.1 Caching UI Elements
```
Audit the click select flow in pages/POSPage.js to optimize Orders-Per-Minute (OPM).

Current behavior:
- Rapid mode caches element reference IDs of products to speed up quantity selection.

Tasks:
1. Review the addProductsToCart() caching implementation.
2. Check if caching is safe when navigating between category tabs or when screen layouts refresh.
3. Provide a proposal for a self-invalidating element cache to prevent "StaleElementReference" exceptions.
```

### 3.2 Optimizing Appium Idle Timeouts
```
Explain how to tune Appium settings to bypass Android UI animation settling delays.
Provide a prompt script or helper block to inject WebdriverIO settings:
- waitForIdleTimeout (reducing from 10s default to 100ms)
- actionAcknowledgmentTimeout (reducing to 0)

Ensure these are applied only when executionMode is set to "rapid" in config.json.
```

---

## 4. Reliability & Recovery Audits

### 4.1 Adding a Native System Popup Handler
```
We need to handle an unexpected system popup ("System UI isn't responding - Close app / Wait") during long endurance runs.

Tasks:
1. Write a popup detection and handle block matching the registry pattern in utils/popupManager.js.
2. Use dynamic selector strings:
   - detect: Title matches "isn't responding"
   - handle: Click "Wait" or "Close" button.
3. Save failure screenshots using BasePage.saveFailureScreenshot if handling fails.
```

### 4.2 Restoring Terminated Appium Services
```
Inspect resetUiAutomator2Server() inside utils/adb.js.
Currently it force-stops the Appium server processes on the device.

Recommend:
1. Are there other background processes (like appium settings or io.appium.settings) that need to be force-stopped?
2. Should we also reset the local port forward port bindings (e.g. adb forward tcp:4724 tcp:4724) inside the recovery process?
```

---

## 5. Documentation & Reports

### 5.1 Customizing HTML Visual Summary
```
I want to add a "Memory Growth Slope Chart" to our final HTML report.

Tasks:
1. Open utils/htmlReport.js.
2. Inspect where the HTML template and script tags are generated.
3. Provide code to embed a Canvas-based Chart.js memory graph displaying PSS heap trends per cycle from memorySlopeMbPerCycle stats.
```

### 5.2 Hardening Retention Policies
```
Review the cleanOldRuns() method in utils/retentionManager.js.

Tasks:
1. Ensure files matching 'PHASE_WISE_IMPROVEMENT_PLAN.md' and other critical docs are protected from deletion.
2. Check if files located in the newly created 'docs/' directory are safe from deletion loops, and explain how to add folders to the exclusion list.
```
