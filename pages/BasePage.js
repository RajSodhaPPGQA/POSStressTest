const locators = require('../locators.json');
const { log } = require('../utils/logger');

class BasePage {
  static async findElementFast(driver, text) {
    const exactSelector = `android=new UiSelector().text("${text}")`;
    const visibleElement = await driver.$(exactSelector);

    // Fast retry wait (up to 1.5s) to allow screen layout to inflate
    for (let i = 0; i < 3; i++) {
      try {
        if (await visibleElement.isDisplayed()) {
          return visibleElement;
        }
      } catch (e) {}
      await driver.pause(500);
    }

    // Scroll with exact text matching
    log("SCROLL", `Element "${text}" not instantly visible. Scrolling...`);
    await driver.$(
      `android=new UiScrollable(new UiSelector().scrollable(true)).setAsVerticalList().scrollIntoView(new UiSelector().text("${text}"))`
    );

    await driver.pause(1500); // let scroll settle
    
    // RE-FIND the element after scrolling to refresh its coordinates and elementId!
    const freshElement = await driver.$(exactSelector);
    try {
      if (await freshElement.isDisplayed()) {
        return freshElement;
      }
    } catch (e) {}

    throw new Error(`Element with exact text "${text}" not found/displayed after scrolling`);
  }

  static async findElementContainsFast(driver, text) {
    const visibleElement = await driver.$(
      `android=new UiSelector().textContains("${text}")`
    );

    // Fast retry wait (up to 1.5s) to allow screen layout to inflate
    for (let i = 0; i < 3; i++) {
      try {
        if (await visibleElement.isDisplayed()) {
          return visibleElement;
        }
      } catch (e) {}
      await driver.pause(500);
    }

    // Scroll and return the returned scrolled element reference directly
    log("SCROLL", `Element "${text}" not instantly visible. Scrolling...`);
    await driver.$(
      `android=new UiScrollable(new UiSelector().scrollable(true)).setAsVerticalList().scrollIntoView(new UiSelector().textContains("${text}"))`
    );

    await driver.pause(1500); // let scroll settle
    
    // RE-FIND the element after scrolling to refresh its coordinates and elementId!
    const freshElement = await driver.$(`android=new UiSelector().textContains("${text}")`);
    try {
      if (await freshElement.isDisplayed()) {
        return freshElement;
      }
    } catch (e) {}

    throw new Error(`Element containing text "${text}" not found/displayed after scrolling`);
  }

  static async clickText(driver, text) {
    const el = await this.findElementFast(driver, text);
    try {
      await el.click();
    } catch (err) {
      log("CLICK_WARNING", `Standard click failed, trying clickGesture: ${err.message}`);
      await driver.execute('mobile: clickGesture', {
        elementId: el.elementId
      });
    }
  }

  static async clickTextContains(driver, text) {
    const el = await this.findElementContainsFast(driver, text);
    try {
      await el.click();
    } catch (err) {
      log("CLICK_WARNING", `Standard click failed, trying clickGesture: ${err.message}`);
      await driver.execute('mobile: clickGesture', {
        elementId: el.elementId
      });
    }
  }

  static async checkForAlertsAndDismiss(driver) {
    try {
      // Build xpath from locators.alerts dynamically
      const xpath = `//*[@text="${locators.alerts.join('" or @text="')}"]`;
      const alertButton = await driver.$(xpath);
      if (await alertButton.isDisplayed()) {
        const btnText = await alertButton.getText();
        log("ALERT", `👉 Auto-dismissing exception popup with button: "${btnText}"`);
        await alertButton.click();
        await driver.pause(3000); // give it time to clear
      }
    } catch (e) {}
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
