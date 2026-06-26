# Performance Tuning & Benchmarking Guide

This guide details the Orders-Per-Minute (OPM) performance calculations, standard vs. rapid execution modes, and the memory risk-based classification model.

---

## 1. Orders-Per-Minute (OPM) Throughput Calculation
Unlike generic testing runners, this framework categorizes OPM using two metrics to provide clear endurance boundaries:

### 1.1 Startup-Inclusive OPM
* **Formula**: `Total Cycles / Total Run Duration (since startup)`
* **Usage**: Reflects the overall cost including starting Appium, connecting via ADB, and initial login/setup transitions.

### 1.2 Loop Steady-State OPM (Recommended)
* **Formula**: `Completed Cycles / Loop Duration (since setup finished)`
* **Usage**: Excludes initial setup delays. It starts counting precisely when the main transaction loop opens. This is the primary indicator of actual application performance.

---

## 2. Standard vs. Rapid Execution Modes
By setting `"executionMode": "rapid"` in `config.json`, multiple optimizations activate across the UI and driver layers to eliminate native latency:

### 2.1 Child Selection Cache (Fastpath)
* **Standard Mode**: Triggers search overlay dialogs, types the child's name, waits for layout rendering, and clicks.
* **Rapid Mode**: Bypasses the lookup overlay if the previous cycle targeted the same child. If already visible, the runner clicks the cell directly, saving **~900ms** per cycle.

### 2.2 Product Element ID Caching
* **Standard Mode**: Sends a standard locator search query (`android=new UiSelector().text("...")`) to Appium on every click.
* **Rapid Mode**: Caches the resolved WebdriverIO element reference IDs. Subsequent quantity changes or consecutive cycles fetch the cached ID directly. This cuts product selection times from **~900ms to ~50ms (94.4% savings)**.

### 2.3 Tuned Appium Settings
* Sets `waitForIdleTimeout: 100` and `actionAcknowledgmentTimeout: 0` to prevent WebdriverIO from blocking during layout transitions or cart sync animations.

### 2.4 Swipe Settle Bypass
* Bypasses the default 2.4s element retry loops inside `BasePage.js` scroll paths when an element is not immediately visible, triggering direct viewport scrolling without static delays.

---

## 3. Memory Risk-Based Classification Model
The endurance analytics engine ([longRunAnalytics.js](file:///d:/POSStressTest/utils/longRunAnalytics.js)) categorizes client memory stability using regression trends over PSS heap samples:

| Status | Trigger Condition | Classification | Action/Recommendation |
| :--- | :--- | :---: | :--- |
| **Healthy** | Slope < 0.25 MB/cycle AND no slowdown or failures | Low Risk | No action needed. |
| **Memory Growth Observed** | Slope 0.25 to 0.75 MB/cycle AND no significant slowdown / stability failures | Low Risk | Standard caching growth; extend test duration if verifying long-term limits. |
| **Potential Memory Retention** | Slope > 0.75 MB/cycle AND (slowdown detected OR slowdown > 10% OR recoveries occurred) | Medium Risk | Heap analysis recommended to inspect target page retention. |
| **High Risk of Memory Leak** | Slope > 1.5 MB/cycle AND (slowdown > 20% OR app restarts OR fatal failures) | High Risk | Instability detected; detailed dump analysis strongly recommended. |
