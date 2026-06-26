# Recovery Engine & Self-Healing Philosophy

This document outlines the self-healing recovery strategies, error classification, and state restoration mechanics implemented in the ParentPay POS Stress Testing Framework.

---

## 1. The Watchdog Timer Race
A core pillar of the framework's stability is the transaction watchdog. Rather than allowing WebdriverIO or Appium command queues to hang indefinitely on a frozen element, the framework races the entire cycle transaction against a configurable watchdog promise:

```javascript
const watchdogPromise = new Promise((_, reject) => {
    watchdogTimerId = setTimeout(() => {
        reject(new Error("WATCHDOG_TIMEOUT"));
    }, maxTime);
});
await Promise.race([transactionPromise, watchdogPromise]);
```

If the watchdog fires, the loop throws a `WATCHDOG_TIMEOUT` error, terminating the active execution block and redirecting the thread into the crash recovery flow.

---

## 2. Crash Recovery Flow
The catch block of the main execution loop classifies the failure type based on the exception message. If the error is a `WATCHDOG_TIMEOUT`, a proactive memory recycling request (`PROACTIVE_MEM_RECYCLE`), or matching crash keywords (e.g., `instrumentation`, `refuse`, `socket`, `closed`, `connection`), the framework initiates a complete environment reset:

```
[Crash Detected] 
       │
       ▼
1. Delete Appium Session (best effort)
       │
       ▼
2. Ping / Reconnect ADB Device
       │
       ▼
3. Reset UiAutomator2 Server on Device
       │
       ▼
4. Force-Stop app package via ADB
       │
       ▼
5. Relaunch app package via ADB
       │
       ▼
6. Sleep 8 Seconds (Device stabilization wait)
       │
       ▼
7. Create New Appium Driver Session
       │
       ▼
8. Re-execute setupAndEnterPOS() 
       │
       ▼
[Loop Resumes]
```

This sequence heals:
* Frozen Android instrumentation services.
* Port forwarding failures or connection refuse errors.
* Local memory overflows.
* Device communication drops.

---

## 3. Global Popup Handling & Alert Self-Healing
Native modals and custom alert dialogs can block elements, causing touch actions to click the background overlay instead. The framework provides two mitigation layers:

### 3.1 Native Alerts
The `BasePage.checkForAlertsAndDismiss()` utility checks if a native Appium dialog is open and attempts to close it immediately using `driver.dismissAlert()` or clicking default neutral buttons.

### 3.2 Registered Popup Handler ([popupManager.js](file:///d:/POSStressTest/utils/popupManager.js))
Custom app-specific modals (like the "Pending Orders on Device" popup) are registered inside the `popupDefinitions` list:

* **Detection Phase**: Evaluates target text strings inside display boundaries (e.g., matching UI text like `"Pending Orders on Device"` or `"orders which are not yet submitted"`).
* **Handling Phase**: Clicks the designated modal button (such as the `"Close"` button) and halts for 1 second to allow modal transition fade-outs.
* **Diagnostics Phase**: If the modal is detected but the handler fails to resolve it, the framework saves a screenshot and page source to the active run folder for triage.

---

## 4. Cadence & Proactive Memory Recovery
* **Proactive App Bounce**: If `proactiveRelaunchCycles` config is exceeded, the framework terminates and re-activates the package to wipe RAM buffers.
* **Heap Boundary Protection**: If PSS memory usage exceeds `maxMemoryLimitMb`, the loop raises a `PROACTIVE_MEM_RECYCLE` error. It attempts to bounce the application first, falling back to a full session rebuild if needed.
