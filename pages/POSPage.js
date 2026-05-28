const BasePage = require('./BasePage');
const locators = require('../locators.json');
const { log } = require('../utils/logger');

class POSPage {
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
    for (let attempt = 1; attempt <= 3; attempt++) {
      log("POS", `Selecting child "${childName}" - Attempt ${attempt}/3...`);
      try {
        const childElement = await BasePage.findElementContainsFast(driver, childName);
        
        // Use safeClick with dual native click & gesture support for bubble-up clicks in RecyclerView
        await BasePage.safeClick(driver, childElement);
        
        // Strategic stabilization pause for MAUI list virtualization to close
        await driver.pause(2000);

        // Verify child selection actually succeeded (CLOSE button should be gone)
        const closeBtn = await driver.$(`android=new UiSelector().text("${locators.closeButton}")`);
        const stillVisible = await closeBtn.isDisplayed().catch(() => false);
        
        if (!stillVisible) {
          log("POS", `🎉 Child "${childName}" successfully selected (Search overlay closed)`);
          childSelected = true;
          break;
        }
        
        log("POS_WARNING", `Child selection click did not register. Search overlay is still open. Retrying...`);
      } catch (err) {
        log("POS_WARNING", `Attempt ${attempt} to select child failed: ${err.message}`);
        await driver.pause(1000);
      }
    }

    if (!childSelected) {
      throw new Error(`Failed to select child "${childName}" after retries`);
    }
  }

  static async selectProduct(driver, productName) {
    log("POS", `Searching and selecting product: "${productName}"...`);
    const productEl = await BasePage.findElementContainsFast(driver, productName);
    await BasePage.safeClick(driver, productEl);
    
    // Monitor transition to POS Product page with enabled Select Wallet button for up to 30 seconds
    const walletSelector = `android=new UiSelector().text("${locators.selectWalletButton}")`;
    const walletBtn = await driver.$(walletSelector);
    
    await BasePage.monitorTransition(driver, async () => {
      return await walletBtn.isExisting() && await walletBtn.isDisplayed() && await walletBtn.isEnabled();
    }, 30000, 500);
  }

  static async clickSelectWallet(driver) {
    log("POS", "Waiting for 'Select Wallet' button to be enabled...");
    const selectWalletButton = await driver.$(`android=new UiSelector().text("${locators.selectWalletButton}")`);
    await driver.waitUntil(
      async () => await selectWalletButton.isEnabled(),
      {
        timeout: 15000,
        interval: 100, // fast polling
        timeoutMsg: 'Expected Select Wallet button to be enabled'
      }
    );
    
    log("POS", "Select Wallet button is enabled. Clicking...");
    await BasePage.safeClick(driver, selectWalletButton);
    
    // Monitor transition to Pay screen for up to 45 seconds
    const paySelector = `android=new UiSelector().text("${locators.payButton}")`;
    const payBtn = await driver.$(paySelector);
    
    await BasePage.monitorTransition(driver, async () => {
      return await payBtn.isExisting() && await payBtn.isDisplayed();
    }, 45000, 1000);
  }
}

module.exports = POSPage;
