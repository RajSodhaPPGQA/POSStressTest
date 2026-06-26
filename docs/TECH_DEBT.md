# Technical Debt & Roadmap Log

This document tracks identified architectural improvements, future feature implementations, and backlog items. For code quality metrics and standard guidelines audits, see [Repository Health Guide](file:///d:/POSStressTest/docs/RepoHealth.md).

---

## 1. Critical Priority

### 1.1 Login Screen & Authentication Recovery
* **Description**: Implement automated detection and login recovery when credentials expire. If the Android application session times out during long stress cycles, it gets kicked back to the pin/login page, which currently induces a permanent cycle failure or watchdog crash.
* **Business Value**: Crucial for running 8h/12h unattended endurance runs without manual human intervention.
* **Estimated Effort**: 3–5 days.
* **Status**: Proposed / Backlog.

### 1.2 Live Dashboard Port Allocation & Failover
* **Description**: The dashboard server ([liveDashboard.js](file:///d:/POSStressTest/utils/liveDashboard.js)) binds to a hardcoded port (`5050`). If this port is already in use by another local process, the runner will throw an unhandled `EADDRINUSE` exception and crash.
* **Business Value**: Prevents local test startup failures. A dynamic port selector or a recovery port-hop block is needed.
* **Estimated Effort**: 1 day.
* **Status**: Proposed / Backlog.

---

## 2. High Priority

### 2.1 Cross-Platform Sleep Refactoring
* **Description**: In [adb.js](file:///d:/POSStressTest/utils/adb.js), the framework implements sleep timers using Windows shell commands: `execSync('ping 127.0.0.1 -n 2 > nul')`. This blocks the Node.js main execution thread and will fail on macOS or Linux runner hosts.
* **Business Value**: Ensures the framework runs seamlessly on cross-platform developer systems.
* **Estimated Effort**: 2 days.
* **Status**: Proposed / Backlog.

### 2.2 First-Time App Tutorial & Walkthrough Dialog Handler
* **Description**: A fresh installation of the POS app shows walkthrough tips and tutorial cards that overlap buttons. Currently, the framework assumes a pre-configured app state.
* **Business Value**: Enables running stress tests on completely clean builds straight from a CI/CD build pipeline.
* **Estimated Effort**: 2 days.
* **Status**: Proposed / Backlog.

### 2.3 Global Popup Handling Latency
* **Description**: Currently, `handleGlobalPopups()` is called sequentially before major transition stages (Child, Cart, Wallet, Checkout). This performs several blocking WebDriver calls (`$$`) which adds **~100–300ms** of overhead per cycle, even when no popup is displayed.
* **Business Value**: Streamlining this into a non-blocking background threat or event listener will increase rolling OPM under Rapid Mode.
* **Estimated Effort**: 3 days.
* **Status**: Proposed / Backlog.

---

## 3. Medium Priority

### 3.1 Hardcoded Application Package Names
* **Description**: The app package name `"com.parentpay.PointOfService"` and Appium port `4723` are hardcoded across multiple files (including `test.js`, `utils/adb.js`, and `utils/popupManager.js`).
* **Business Value**: Decoupling these into `config.json` allows reusing this testing framework for other POS client builds or environment servers.
* **Estimated Effort**: 2 days.
* **Status**: Proposed / Backlog.

### 3.2 Linear Regression Warm-up Filter
* **Description**: In [longRunAnalytics.js](file:///d:/POSStressTest/utils/longRunAnalytics.js), the memory growth slope is calculated including the very first loop cycles. The initial app setup and page transitions involve significant class load RAM spikes, which skews the linear regression slope.
* **Business Value**: Filters out false-positive memory leak alerts by ignoring the first N warmup cycles.
* **Estimated Effort**: 2 days.
* **Status**: Proposed / Backlog.

### 3.3 Dynamic Caching in Rapid Mode
* **Description**: Product element reference IDs are cached permanently inside `POSPage.js`. Category changes or layout refreshes may make these IDs stale, raising a `StaleElementReferenceException`.
* **Business Value**: Implementing a Time-To-Live (TTL) cache or auto-invalidation on screen transitions hardens rapid-fire loop cycles.
* **Estimated Effort**: 2 days.
* **Status**: Partially Implemented.

---

## 4. Low Priority & Repo Health

### 4.1 Missing Unit/Integration Test Coverage
* **Description**: The framework lacks mock unit tests for analytics (`longRunAnalytics.js`), adb helpers (`adb.js`), or reporting generators (`htmlReport.js`).
* **Business Value**: Guarding against regressions when updating utils.
* **Estimated Effort**: 4 days.
* **Status**: Proposed / Backlog.

### 4.2 Formatting & Style Consistency (Prettier/ESLint)
* **Description**: Code blocks have mixed indentations (e.g., 2 spaces vs 4 spaces) across page objects and utility files. No formatting rules are defined.
* **Business Value**: Enforces standard styling.
* **Estimated Effort**: 1 day.
* **Status**: Proposed / Backlog.

---

## 5. Future Ideas

### 5.1 Parallel Multi-Device Executions
* **Description**: Command multiple target devices simultaneously from a single test runner.
* **Business Value**: Allows large-scale load testing and multi-device coordination stress.
* **Estimated Effort**: 2–3 weeks.
* **Status**: Proposed / Backlog.

### 5.2 CI/CD Pull Request Integration
* **Description**: Automate the launch of standard 30-minute benchmark passes on target branches whenever pull requests are opened.
* **Business Value**: Stops performance regressions from entering production.
* **Estimated Effort**: 4 days.
* **Status**: Proposed / Backlog.
