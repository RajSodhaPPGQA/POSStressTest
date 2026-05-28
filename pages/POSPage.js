const BasePage = require('./BasePage');
const locators = require('../locators.json');
const { log } = require('../utils/logger');

class POSPage {
  static async swipeChildList(driver, direction = 'up', percent = 0.75) {
    if (direction === 'down') {
      await BasePage.swipeDown(driver, percent, 'childList');
      return;
    }
    await BasePage.swipeUp(driver, percent, 'childList');
  }

  static async isMenuDisplayed(driver) {
    const menuBtn = await driver.$(`android=new UiSelector().text("${locators.menuOption}")`);
    try {
      return await menuBtn.isExisting() && await menuBtn.isDisplayed();
    } catch (e) {
      return false;
    }
  }

  static async isPOSMainDisplayed(driver) {
    const nameBtn = await driver.$(`android=new UiSelector().text("${locators.nameButton}")`);
    try {
      return await nameBtn.isExisting() && await nameBtn.isDisplayed();
    } catch (e) {
      return false;
    }
  }

  static async isSearchChildDisplayed(driver) {
    const closeBtn = await driver.$(`android=new UiSelector().text("${locators.closeButton}")`);
    try {
      return await closeBtn.isExisting() && await closeBtn.isDisplayed();
    } catch (e) {
      return false;
    }
  }

  static async isProductPageWithSelectedProduct(driver) {
    const selectWalletBtn = await driver.$(`android=new UiSelector().text("${locators.selectWalletButton}")`);
    try {
      return await selectWalletBtn.isExisting() && await selectWalletBtn.isDisplayed() && await selectWalletBtn.isEnabled();
    } catch (e) {
      return false;
    }
  }

  static async clickMenuOption(driver) {
    log("POS_MENU", `Clicking menu option: "${locators.menuOption}"...`);
    const menuBtn = await BasePage.findElementFast(driver, locators.menuOption);
    await BasePage.safeClick(driver, menuBtn);
    
    // Strategic transition monitor for up to 120 seconds to allow slow menu database loading
    const targetSelector = `android=new UiSelector().text("${locators.nameButton}")`;
    const nameBtn = await driver.$(targetSelector);
    
    await BasePage.monitorTransition(driver, async () => {
      return await nameBtn.isExisting() && await nameBtn.isDisplayed();
    }, 120000, 1000);
  }

  static async clickName(driver) {
    log("POS", "Clicking 'Name' button to open Search Child...");
    const nameBtn = await BasePage.findElementFast(driver, locators.nameButton);
    await BasePage.safeClick(driver, nameBtn);
    
    // Monitor transition to Search Child overlay for up to 30 seconds
    const closeSelector = `android=new UiSelector().text("${locators.closeButton}")`;
    const closeBtn = await driver.$(closeSelector);
    
    await BasePage.monitorTransition(driver, async () => {
      return await closeBtn.isExisting() && await closeBtn.isDisplayed();
    }, 30000, 500);
  }

  static async selectChild(driver, childName) {
    log("POS", `Searching and selecting child: "${childName}"...`);
    
    let childSelected = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      log("POS", `Selecting child "${childName}" - Attempt ${attempt}/5...`);
      try {
        if (!(await this.isSearchChildDisplayed(driver))) {
          log("POS", "Search Child overlay not visible. Re-opening Name search...");
          await this.clickName(driver);
        }

        let childElement = await driver.$(`android=new UiSelector().text("${childName}")`);
        const exactVisible = await childElement.isExisting().catch(() => false) && await childElement.isDisplayed().catch(() => false);

        if (!exactVisible) {
          childElement = await BasePage.findElementContainsFast(driver, childName, 'childList');
        }
        
        // Use safeClick with dual native click & gesture support for bubble-up clicks in RecyclerView
        await BasePage.safeClick(driver, childElement);
        
        // Adaptive stabilization: return quickly if overlay closes immediately, but allow brief settle window.
        const closeBtn = await driver.$(`android=new UiSelector().text("${locators.closeButton}")`);
        let stillVisible = await closeBtn.isDisplayed().catch(() => false);
        if (stillVisible) {
          await driver.waitUntil(
            async () => !(await closeBtn.isDisplayed().catch(() => false)),
            {
              timeout: 350,
              interval: 50
            }
          ).catch(() => {});
          stillVisible = await closeBtn.isDisplayed().catch(() => false);
        }
        
        if (!stillVisible) {
          log("POS", `🎉 Child "${childName}" successfully selected (Search overlay closed)`);
          childSelected = true;
          break;
        }
        
        log("POS_WARNING", `Child selection click did not register. Search overlay is still open. Retrying...`);

        const direction = attempt % 2 === 0 ? 'down' : 'up';
        log("POS", `Swiping child list ${direction} to locate/select target child...`);
        await this.swipeChildList(driver, direction, 0.75);
        await driver.pause(300);
      } catch (err) {
        log("POS_WARNING", `Attempt ${attempt} to select child failed: ${err.message}`);

        try {
          const direction = attempt % 2 === 0 ? 'down' : 'up';
          log("POS", `Fallback swipe ${direction} on child list after failure...`);
          await this.swipeChildList(driver, direction, 0.75);
        } catch (swipeErr) {
          log("POS_WARNING", `Fallback child-list swipe failed: ${swipeErr.message}`);
        }

        await driver.pause(300);
      }
    }

    if (!childSelected) {
      throw new Error(`Failed to select child "${childName}" after retries`);
    }
  }

  static async selectProduct(driver, productName) {
    log("POS", `Searching and selecting product: "${productName}"...`);
    let productEl = null;

    // Fast path: product is usually already visible right after child selection.
    const exactSelector = `android=new UiSelector().text("${productName}")`;
    const containsSelector = `android=new UiSelector().textContains("${productName}")`;
    for (let i = 0; i < 8; i++) {
      try {
        const exactMatches = await driver.$$(exactSelector);
        if (exactMatches.length > 0 && await exactMatches[0].isDisplayed()) {
          productEl = exactMatches[0];
          break;
        }
      } catch (e) {}

      try {
        const containsMatches = await driver.$$(containsSelector);
        if (containsMatches.length > 0 && await containsMatches[0].isDisplayed()) {
          productEl = containsMatches[0];
          break;
        }
      } catch (e) {}

      await driver.pause(40);
    }

    // Fallback path: use robust finder with scrolling only when fast path does not find product.
    if (!productEl) {
      productEl = await BasePage.findElementContainsFast(driver, productName);
    }

    await BasePage.safeClick(driver, productEl);

    // Fast-path wait: product selection is usually immediate, so poll quickly for wallet readiness.
    const walletBtn = await driver.$(`android=new UiSelector().text("${locators.selectWalletButton}")`);
    await walletBtn.waitForDisplayed({ timeout: 15000, interval: 75 });
    await driver.waitUntil(
      async () => await walletBtn.isEnabled(),
      {
        timeout: 15000,
        interval: 60,
        timeoutMsg: 'Expected Select Wallet button to become enabled after product selection'
      }
    );
  }

  static async clickSelectWallet(driver) {
    log("POS", "Clicking 'Select Wallet'...");
    const selectWalletButton = await driver.$(`android=new UiSelector().text("${locators.selectWalletButton}")`);

    // In the normal path this is already enabled by selectProduct; keep a short guard for laggy renders.
    if (!(await selectWalletButton.isEnabled().catch(() => false))) {
      await driver.waitUntil(
        async () => await selectWalletButton.isEnabled(),
        {
          timeout: 5000,
          interval: 60,
          timeoutMsg: 'Expected Select Wallet button to be enabled'
        }
      );
    }

    await BasePage.safeClick(driver, selectWalletButton, 1);

    // Fast-path wait for Pay button with quick polling.
    const payBtn = await driver.$(`android=new UiSelector().text("${locators.payButton}")`);
    await payBtn.waitForDisplayed({ timeout: 30000, interval: 75 });
  }
}

module.exports = POSPage;
