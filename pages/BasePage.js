const locators = require('../locators.json');
const config = require('../config.json');
const { log } = require('../utils/logger');

const defaultWait = (config.timeouts && config.timeouts.defaultWaitMs) || 15000;
const scrollSettleDelay = config.connectionMode === 'usb' ? 500 : 1500;
const defaultSwipeAreas = {
  global: { left: 0.15, top: 0.2, width: 0.7, height: 0.6 },
  hierarchyList: { left: 0.12, top: 0.22, width: 0.42, height: 0.56 },
  childList: { left: 0.12, top: 0.22, width: 0.45, height: 0.56 }
};

class BasePage {
  static getSwipeArea(areaKey = 'global') {
    const profileName = config.deviceProfile;
    const profileAreas = (config.swipeProfiles && profileName && config.swipeProfiles[profileName]) || {};
    const directOverrides = (config.swipeAreas && config.swipeAreas[areaKey]) || {};
    const profileOverrides = (profileAreas && profileAreas[areaKey]) || {};
    const defaults = defaultSwipeAreas[areaKey] || defaultSwipeAreas.global;

    return {
      left: defaults.left,
      top: defaults.top,
      width: defaults.width,
      height: defaults.height,
      ...profileOverrides,
      ...directOverrides
    };
  }

  static async swipe(driver, direction = 'up', percent = 0.75, areaKey = 'global') {
    const rect = await driver.getWindowRect();
    const area = this.getSwipeArea(areaKey);

    const left = Math.floor(rect.width * area.left);
    const top = Math.floor(rect.height * area.top);
    const width = Math.floor(rect.width * area.width);
    const height = Math.floor(rect.height * area.height);

    await driver.execute('mobile: swipeGesture', {
      left,
      top,
      width,
      height,
      direction,
      percent
    });
  }

  static async swipeUp(driver, percent = 0.75, areaKey = 'global') {
    await this.swipe(driver, 'up', percent, areaKey);
  }

  static async swipeDown(driver, percent = 0.75, areaKey = 'global') {
    await this.swipe(driver, 'down', percent, areaKey);
  }

  /**
   * Deterministic screen state detector.
   * Maps current screen elements to defined states A through H, or unknown.
   */
  static async detectCurrentState(driver) {
    try {
      const isVisible = async (selector) => {
        try {
          const el = await driver.$(selector);
          return await el.isExisting() && await el.isDisplayed();
        } catch (e) {
          return false;
        }
      };

      // 1. State D: Search Child Overlay (looks for CLOSE button)
      if (await isVisible(`android=new UiSelector().text("${locators.closeButton}")`)) {
        return 'State_D';
      }

      // 2. State H: POS Product list with Select Wallet enabled/displayed
      if (await isVisible(`android=new UiSelector().text("${locators.selectWalletButton}")`)) {
        return 'State_H';
      }

      // 3. State G: Checkout/Pay page (looks for Pay button)
      if (await isVisible(`android=new UiSelector().text("${locators.payButton}")`)) {
        return 'State_G';
      }

      // 4. State C: POS Main ordering page (looks for Name button)
      if (await isVisible(`android=new UiSelector().text("${locators.nameButton}")`)) {
        return 'State_C';
      }

      // 5. State F: POS Menu (looks for SENIOR POS MENU button or custom menuOption)
      if (await isVisible(`android=new UiSelector().text("${locators.menuOption}")`)) {
        return 'State_F';
      }

      // 6. State B: Dashboard (looks for POS button)
      if (await isVisible(`android=new UiSelector().text("${locators.posButton}")`)) {
        return 'State_B';
      }

      // 7. State E: Hierarchy Selection.
      // Some builds vary header text, so keep flexible fallbacks.
      if (
        await isVisible(`android=new UiSelector().text("${locators.hierarchyHeader}")`) ||
        await isVisible(`android=new UiSelector().textContains("school outlet hierarchy")`) ||
        await isVisible(`android=new UiSelector().textContains("Choose the school")`) ||
        await isVisible(`android=new UiSelector().text("${locators.proceedButton}")`)
      ) {
        return 'State_E';
      }

      // 8. State A: School Selection (looks for SchoolDev or school select title)
      if (
        await isVisible(`android=new UiSelector().text("${locators.schoolDev}")`) ||
        await isVisible(`android=new UiSelector().textContains("School")`) ||
        await isVisible(`android=new UiSelector().textContains("school")`)
      ) {
        return 'State_A';
      }
    } catch (e) {
      log("STATE_WARN", `Error during state detection: ${e.message}`);
    }
    return 'unknown';
  }

  static async findElementFast(driver, text, areaKey = 'global') {
    const exactSelector = `android=new UiSelector().text("${text}")`;
    const visibleElement = await driver.$(exactSelector);

    // Fast retry wait (up to 3s) to allow screen layout to inflate
    for (let i = 0; i < 20; i++) {
      try {
        if (await visibleElement.isDisplayed()) {
          return visibleElement;
        }
      } catch (e) {}
      await driver.pause(150);
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

    // Fallback for MAUI/Recycler layouts where UiScrollable metadata is unreliable.
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        await this.swipeUp(driver, 0.75, areaKey);
      } catch (swipeErr) {
        log("SCROLL_WARNING", `Swipe attempt ${attempt} failed: ${swipeErr.message}`);
      }

      await driver.pause(scrollSettleDelay);
      const swipedElement = await driver.$(exactSelector);
      try {
        if (await swipedElement.isDisplayed()) {
          return swipedElement;
        }
      } catch (e) {}
    }

    // If target is above current viewport, search back in reverse direction.
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        await this.swipeDown(driver, 0.75, areaKey);
      } catch (swipeErr) {
        log("SCROLL_WARNING", `Reverse swipe attempt ${attempt} failed: ${swipeErr.message}`);
      }

      await driver.pause(scrollSettleDelay);
      const swipedElement = await driver.$(exactSelector);
      try {
        if (await swipedElement.isDisplayed()) {
          return swipedElement;
        }
      } catch (e) {}
    }

    throw new Error(`Element with exact text "${text}" not found/displayed after scrolling`);
  }

  static async findElementContainsFast(driver, text, areaKey = 'global') {
    const selectorStr = `android=new UiSelector().textContains("${text}")`;
    const visibleElement = await driver.$(selectorStr);

    // Fast retry wait (up to 3s) to allow screen layout to inflate
    for (let i = 0; i < 20; i++) {
      try {
        if (await visibleElement.isDisplayed()) {
          return visibleElement;
        }
      } catch (e) {}
      await driver.pause(150);
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

    // Fallback for MAUI/Recycler layouts where UiScrollable metadata is unreliable.
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        await this.swipeUp(driver, 0.75, areaKey);
      } catch (swipeErr) {
        log("SCROLL_WARNING", `Swipe attempt ${attempt} failed: ${swipeErr.message}`);
      }

      await driver.pause(scrollSettleDelay);
      const swipedElement = await driver.$(selectorStr);
      try {
        if (await swipedElement.isDisplayed()) {
          return swipedElement;
        }
      } catch (e) {}
    }

    // If target is above current viewport, search back in reverse direction.
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        await this.swipeDown(driver, 0.75, areaKey);
      } catch (swipeErr) {
        log("SCROLL_WARNING", `Reverse swipe attempt ${attempt} failed: ${swipeErr.message}`);
      }

      await driver.pause(scrollSettleDelay);
      const swipedElement = await driver.$(selectorStr);
      try {
        if (await swipedElement.isDisplayed()) {
          return swipedElement;
        }
      } catch (e) {}
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

  static async clickText(driver, text, areaKey = 'global') {
    const el = await this.findElementFast(driver, text, areaKey);
    await this.safeClick(driver, el);
  }

  static async clickTextContains(driver, text, areaKey = 'global') {
    const el = await this.findElementContainsFast(driver, text, areaKey);
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
    let pollCount = 0;
    
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
        if (errMsg.includes("socket") || errMsg.includes("refused") || errMsg.includes("connection") || errMsg.includes("session") || errMsg.includes("instrumentation")) {
          throw err;
        }
      }
      
      // 2. Check for alerts only every 5 polls to avoid hammering UiAutomator2 on Samsung devices
      pollCount++;
      if (pollCount % 5 === 0) {
        try {
          await this.checkForAlertsAndDismiss(driver);
        } catch (alertErr) {
          const errMsg = alertErr.message.toLowerCase();
          if (errMsg.includes("instrumentation") || errMsg.includes("socket") || errMsg.includes("session")) {
            throw alertErr; // propagate real crashes
          }
          // otherwise silent - alert check failure is non-fatal
        }
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
