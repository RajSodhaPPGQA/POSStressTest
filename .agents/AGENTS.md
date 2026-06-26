# AI Coding Agent Guidelines & Rules

This document defines system instructions, completion patterns, and constraints for any autonomous AI coding assistant or developer modifying the ParentPay POS Stress Testing Framework.

---

## 1. General Directives & Expectations
* **POM Architecture**: All page objects must inherit from `BasePage.js` and reside in the `pages/` directory. Do not write inline raw selectors or queries outside POM structures.
* **CommonJS Exports**: This repository uses CommonJS (`require` and `module.exports`). Do not introduce ES6 `import` or `export` keywords.
* **Unattended Mode Integrity**: Never introduce UI wait states, interactive terminal prompts, or system alerts that block execution unless unattended mode is explicitly disabled in the configuration.
* **Error Handling**: Page object methods must bubble descriptive errors rather than catching exceptions silently, allowing the runner's watchdog timer race to handle failures.
* **Logging Conventions**: Use the standard `log(LEVEL, message)` helper from `utils/logger.js` rather than raw `console.log`.

---

## 2. Autocomplete & Codex-Specific Patterns
* **WebdriverIO Selectors**: Use robust Android UiAutomator locator strings instead of brittle XPaths:
  ```javascript
  const button = await driver.$('android=new UiSelector().text("Pay")');
  ```
* **Base Page Extensions**: Ensure new page objects extend `BasePage` and pass the driver instance via constructor:
  ```javascript
  const BasePage = require('./BasePage');
  class CustomPage extends BasePage {
      constructor(driver) {
          super(driver);
      }
  }
  module.exports = CustomPage;
  ```

---

## 3. Review Checklist for Changes
Prior to completing edits, confirm:
- [ ] No ES6 syntax (`import`/`export`) is introduced.
- [ ] No configurations are hardcoded (always load from `config.json`).
- [ ] Watchdog timers and background process handlers are cleared on failure paths.
- [ ] Newly added files start with `'use strict';`.
