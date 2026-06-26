# AI Instruction Guide & Repository Constitution

This document is the repository constitution. It defines coding patterns, design philosophies, and architectural rules for both human developers and AI coding assistants modifying the ParentPay POS Stress Testing Framework.

**CRITICAL RULE FOR AI ASSISTANTS**: Read this file before modifying or introducing any code in this repository.

---

## 1. Core Philosophies

### 1.1 Recovery-First Philosophy
* Stress test loops must never hang or crash the runner when sub-components fail.
* **Watchdog Protection**: Every core step is raced against a watchdog timer (`maxCycleTimeMs`). If the UI freezes, the transaction must fail with `WATCHDOG_TIMEOUT` and trigger full recovery.
* **Full Session Restoration**: If the Appium session or Android app crashes, the framework must tear down the Appium driver, reset UiAutomator2 via ADB, force-stop/relaunch the application, wait for device stabilization, and re-establish the session without stopping the test runner.
* **UI Self-Healing**: Every navigation step must be protected by popup/alert dismissals using [popupManager.js](file:///d:/POSStressTest/utils/popupManager.js).

### 1.2 Config-Driven Development
* Behavioural parameters (timeouts, limits, modes, loops) must reside in `config.json` rather than hard-coded variables.
* **Runtime Overrides**: Temporary runs must preserve the source-of-truth `config.json` by using the generated `config.runtime.json` override file.

### 1.3 Backward Compatibility
* Existing configuration fields (such as `productName`, legacy child naming) must continue to function.
* Do not deprecate existing schemas unless a seamless fallback or auto-conversion wrapper is implemented.

---

## 2. Coding Standards & Principles

### 2.1 JavaScript Standards
* Use strict mode (`'use strict'`) in all JS files.
* Use `async/await` for asynchronous control flows. Never use raw promises unless racing or wrapping callbacks (e.g., watchdog races, timeout wrappers).
* Ensure strict error handling in every page method and utility helper. Return or bubble meaningful messages to the main test loop rather than catching silently.

### 2.2 Locators & Selectors
* Keep selectors decoupled in [locators.json](file:///d:/POSStressTest/locators.json).
* Use robust Android UIAutomator selector strings (e.g., `new UiSelector().textContains("...")` or `new UiSelector().resourceId("...")`). Avoid brittle XPath locators.
* Check if a locator must be dynamic (like selecting elements based on target child/product names) and implement clean parametrization helper methods.

### 2.3 Caching & Performance
* For `"executionMode": "rapid"`, cache static elements (like product selection grid items) to prevent repetitive WebdriverIO queries to Appium.
* Verify memory trend metrics. Ensure memory measurement hooks do not block the active execution loop (run checks at a configurable cadence rather than every single cycle).

---

## 3. Rules for Making Changes

### 3.1 Modifying Framework Code
* **Do Not Interrupt Active Runs**: Never introduce locks, modal wait states, or prompt blocks that require manual human interaction unless unattended mode is disabled.
* **Watchdog Integrity**: Any new asynchronous operation in `test.js` or UI page models must be wrapped within or accounted for by the watchdog race.

### 3.2 Page Object Model Rules
* Page classes (inheriting from `BasePage.js`) must only contain UI interaction logic and locators.
* Do not perform reporting, analytical data processing, or device network checks within page files. Delegate these to the appropriate utility helper under `utils/`.

### 3.3 Adding New Features
* Every new feature must be optional and toggled via a setting in `config.json` (disabled by default).
* Must include clear log lines using the `log()` utility from [logger.js](file:///d:/POSStressTest/utils/logger.js).

---

## 4. Logging & Reporting Guidelines
* Use categorised log levels (`SETUP`, `CYCLE`, `ERROR`, `MEMORY`, `RECOVERY`, `CRITICAL`).
* Never log sensitive credentials or system paths.
* When adding a new performance phase, register its phase name inside [perfMetrics.js](file:///d:/POSStressTest/utils/perfMetrics.js) and log its timing correctly.
* Ensure any custom metric fields are logged into Excel and HTML generators without disrupting layout bounds.
