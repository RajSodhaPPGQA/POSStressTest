const locators = require('../locators.json');
const config = require('../config.json');
const { log } = require('../utils/logger');

const defaultWait = (config.timeouts && config.timeouts.defaultWaitMs) || 15000;
const scrollSettleDelay = config.connectionMode === 'usb' ? 500 : 1500;

class BasePage {
  /**
   * Deterministic screen state detector.
   * Maps current screen elements to defined states A through H, or unknown.
   */
  static async detectCurrentState(driver) {
    try {
      // 1. State D: Search Child Overlay (looks for CLOSE button)
      const closeBtn = await driver.$(`android=new UiSelector().text("${locators.closeButton}")`);
      if (await closeBtn.isExisting() && await closeBtn.isDisplayed()) {
        return 'State_D';
      }

      // 2. State H: POS Product list with Select Wallet enabled/displayed
      const selectWalletBtn = await driver.$(`android=new UiSelector().text("${locators.selectWalletButton}")`);
      if (await selectWalletBtn.isExisting() && await selectWalletBtn.isDisplayed()) {
        return 'State_H';
      }

      // 3. State G: Checkout/Pay page (looks for Pay button)
      const payBtn = await driver.$(`android=new UiSelector().text("${locators.payButton}")`);
      if (await payBtn.isExisting() && await payBtn.isDisplayed()) {
        return 'State_G';
      }

      // 4. State C: POS Main ordering page (looks for Name button)
      const nameBtn = await driver.$(`android=new UiSelector().text("${locators.nameButton}")`);
      if (await nameBtn.isExisting() && await nameBtn.isDisplayed()) {
        return 'State_C';
      }

      // 5. State F: POS Menu (looks for SENIOR POS MENU button or custom menuOption)
      const menuBtn = await driver.$(`android=new UiSelector().text("${locators.menuOption}")`);
      if (await menuBtn.isExisting() && await menuBtn.isDisplayed()) {
        return 'State_F';
      }

      // 6. State B: Dashboard (looks for POS button)
      const posBtn = await driver.$(`android=new UiSelector().text("${locators.posButton}")`);
      if (await posBtn.isExisting() && await posBtn.isDisplayed()) {
        return 'State_B';
      }

      // 7. State E: Hierarchy Selection (looks for HierarchyHeader)
      const hierarchyHeader = await driver.$(`android=new UiSelector().text("${locators.hierarchyHeader}")`);
      if (await hierarchyHeader.isExisting() && await hierarchyHeader.isDisplayed()) {
        return 'State_E';
      }

      // 8. State A: School Selection (looks for SchoolDev or school select title)
      const schoolTitle = await driver.$(`android=new UiSelector().text("${locators.schoolDev}")`);
      if (await schoolTitle.isExisting() && await schoolTitle.isDisplayed()) {
        return 'State_A';
      }
    } catch (e) {
      log("STATE_WARN", `Error during state detection: ${e.message}`);
    }
    return 'unknown';
  }

  static async findElementFast(driver, text) {
    const exactSelector = `android=new UiSelector().text("${text}")`;
    const visibleElement = await driver.$(exactSelector);

    // Fast retry wait (up to 5.0s) to allow screen layout to inflate
    for (let i = 0; i < 10; i++) {
      try {
        if (await visibleElement.isDisplayed()) {
          return visibleElement;
        }
      } catch (e) {}
      await driver.pause(500);
    }



    // Scroll with exact text matching
    log("SCROLL", `Element "${text}" not instantly visible. Scrolling...`);
    try {
      await driver.$(
        `android=new UiScrollable(new UiSelector().scrollable(true)).setAsVerticalList().scrollIntoView(new UiSelector().text("${text}"))`
      );
    } catch (scrollErr) {
      log("SCROLL_WARNING", `Scrollable list not found: ${scrollErr.message}. Checking direct visibility again...`);
    }

    await driver.pause(scrollSettleDelay); // let scroll settle
    
    // RE-FIND the element after scrolling to refresh its coordinates and elementId!
    const freshElement = await driver.$(exactSelector);
    try {
      if (await freshElement.isDisplayed()) {
        return freshElement;
      }
    } catch (e) {}


    const finalElement = await driver.$(exactSelector);
    if (await finalElement.isDisplayed()) {
      return finalElement;
    }

    throw new Error(`Element with exact text "${text}" not found/displayed after scrolling`);
  }

  static async findElementContainsFast(driver, text) {
    const selectorStr = `android=new UiSelector().textContains("${text}")`;
    const visibleElement = await driver.$(selectorStr);

    // Fast retry wait (up to 5.0s) to allow screen layout to inflate
    for (let i = 0; i < 10; i++) {
      try {
        if (await visibleElement.isDisplayed()) {
          return visibleElement;
        }
      } catch (e) {}
      await driver.pause(500);
    }



    // Scroll and return the returned scrolled element reference directly
    log("SCROLL", `Element "${text}" not instantly visible. Scrolling...`);
    try {
      await driver.$(
        `android=new UiScrollable(new UiSelector().scrollable(true)).setAsVerticalList().scrollIntoView(new UiSelector().textContains("${text}"))`
      );
    } catch (scrollErr) {
      log("SCROLL_WARNING", `Scrollable list not found: ${scrollErr.message}. Checking direct visibility again...`);
    }

    await driver.pause(scrollSettleDelay); // let scroll settle
    
    // RE-FIND the element after scrolling to refresh its coordinates and elementId!
    const freshElement = await driver.$(selectorStr);
    try {
      if (await freshElement.isDisplayed()) {
        return freshElement;
      }
    } catch (e) {}


    const finalElement = await driver.$(selectorStr);
    if (await finalElement.isDisplayed()) {
      return finalElement;
    }

    throw new Error(`Element containing text "${text}" not found/displayed after scrolling`);
  }

  static async waitVisible(driver, el, timeout = defaultWait) {
    await el.waitForDisplayed({ timeout });
  }

  static async safeClick(driver, el, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      try {
        // Prioritize native click to support correct event bubbling in virtualized lists (e.g. child rows)
        await el.click();
        return;
      } catch (e) {
        log("WARN", `Native click failed (attempt ${i + 1}/${retries + 1}): ${e.message}`);
        
        // INTERCEPTOR HOOK: Proactively check for system dialogs/popups blocking layout
        await this.checkForAlertsAndDismiss(driver);
        
        try {
          // Fall back to coordinate-based clickGesture
          await driver.execute('mobile: clickGesture', {
            elementId: el.elementId
          });
          return;
        } catch (gestureErr) {
          if (i === retries) {
            throw new Error(`safeClick failed after ${retries} retries. Last error: ${gestureErr.message}`);
          }
          await driver.pause(1000);
        }
      }
    }
  }

  static async clickText(driver, text) {
    const el = await this.findElementFast(driver, text);
    await this.safeClick(driver, el);
  }

  static async clickTextContains(driver, text) {
    const el = await this.findElementContainsFast(driver, text);
    await this.safeClick(driver, el);
  }

  /**
   * System-wide popup and alert interceptor.
   * Auto-detects and dismisses common app error modals and Android system alerts.
   */
  static async checkForAlertsAndDismiss(driver) {
    try {
      // Consolidated XPath targeting:
      // 1. Configured ParentPay POS popups/modals
      // 2. Native OS Dialog buttons (Wait, OK, Close app, Dismiss, Retry, Close, CLOSE)
      const popupButtons = [
        ...locators.alerts,
        "Wait",
        "Close app"
      ];
      
      const xpath = `//*[@text="${popupButtons.join('" or @text="')}"]`;
      const alertButton = await driver.$(xpath);
      
      if (await alertButton.isExisting() && await alertButton.isDisplayed()) {
        const btnText = await alertButton.getText();
        log("POPUP", `👉 Intercepted popup/alert! Auto-dismissing with button: "${btnText}"`);
        await alertButton.click();
        await driver.pause(3000); // Wait for popup transition to fade out
      }
    } catch (e) {
      // Silent catch to prevent watchdog interference
    }
  }

  /**
   * Enterprise-Grade Transition Monitor.
   * Periodically monitors app state during slow rendering or network-heavy transitions.
   * 
   * @param {object} driver - The Appium driver instance.
   * @param {function} successPredicate - Async function returning boolean if target state is successfully loaded.
   * @param {number} maxTimeoutMs - Maximum time to wait for transition (default 60000ms).
   * @param {number} pollIntervalMs - Interval between state checks (default 1000ms).
   * @returns {Promise<boolean>} Resolves to true if successful, throws error on crash/timeout.
   */
  static async monitorTransition(driver, successPredicate, maxTimeoutMs = 60000, pollIntervalMs = 1000) {
    const startTime = Date.now();
    log("TRANSITION", `Starting transition monitor (max timeout: ${maxTimeoutMs}ms)...`);
    
    while ((Date.now() - startTime) < maxTimeoutMs) {
      // 1. Check for success state first
      try {
        if (await successPredicate()) {
          log("TRANSITION", `🎯 Target screen state loaded successfully in ${Date.now() - startTime}ms`);
          return true;
        }
      } catch (err) {
        // If driver session is dead or socket error occurred, let it bubble up to trigger restart
        const errMsg = err.message.toLowerCase();
        if (errMsg.includes("socket") || errMsg.includes("refused") || errMsg.includes("connection") || errMsg.includes("session")) {
          throw err;
        }
      }
      
      // 2. Check for alerts / popups and auto-dismiss them if they block the transition
      try {
        await this.checkForAlertsAndDismiss(driver);
      } catch (alertErr) {
        log("TRANSITION_WARN", `Alert check during transition failed: ${alertErr.message}`);
      }
      
      await driver.pause(pollIntervalMs);
    }
    
    throw new Error(`Transition timed out after ${maxTimeoutMs}ms without reaching target state`);
  }

  static async saveFailureScreenshot(driver, contextName) {
    try {
      const fs = require('fs');
      const path = require('path');
      const screenshotDir = path.join(__dirname, '..', 'screenshots');
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      const filename = `error_${contextName}_${Date.now()}.png`;
      const filepath = path.join(screenshotDir, filename);
      await driver.saveScreenshot(filepath);
      log("SCREENSHOT", `Saved failure screenshot to: screenshots/${filename}`);
    } catch (e) {
      log("SCREENSHOT_ERROR", `Failed to save screenshot: ${e.message}`);
    }
  }
}

module.exports = BasePage;
