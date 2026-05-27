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
    await BasePage.clickText(driver, locators.menuOption);
  }

  static async clickName(driver) {
    log("POS", "Clicking 'Name' button to open Search Child...");
    await BasePage.clickText(driver, locators.nameButton);
  }

  static async selectChild(driver, childName) {
    log("POS", `Searching and selecting child: "${childName}"...`);
    await BasePage.clickTextContains(driver, childName);
    log("POS", `Child "${childName}" selected`);
  }

  static async selectProduct(driver, productName) {
    log("POS", `Searching and selecting product: "${productName}"...`);
    await BasePage.clickTextContains(driver, productName);
    log("POS", `Product "${productName}" clicked`);
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
    await driver.execute('mobile: clickGesture', {
      elementId: selectWalletButton.elementId
    });
    log("POS", "Select Wallet button clicked");
  }
}

module.exports = POSPage;
