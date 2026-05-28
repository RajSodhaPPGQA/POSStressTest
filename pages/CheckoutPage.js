const BasePage = require('./BasePage');
const locators = require('../locators.json');
const { log } = require('../utils/logger');

class CheckoutPage {
  static async isDisplayed(driver) {
    const payBtn = await driver.$(`android=new UiSelector().text("${locators.payButton}")`);
    try {
      return await payBtn.isExisting() && await payBtn.isDisplayed();
    } catch (e) {
      return false;
    }
  }

  static async clickPay(driver) {
    log("CHECKOUT", "Clicking 'Pay' button...");
    const payButton = await driver.$(`android=new UiSelector().text("${locators.payButton}")`);
    await BasePage.safeClick(driver, payButton, 1);

    // Fast-path wait for return to POS Main (State C) or Search Child (State D).
    const closeSelector = `android=new UiSelector().text("${locators.closeButton}")`;
    const nameSelector = `android=new UiSelector().text("${locators.nameButton}")`;

    const closeBtn = await driver.$(closeSelector);
    const nameBtn = await driver.$(nameSelector);

    await driver.waitUntil(
      async () => (await closeBtn.isDisplayed().catch(() => false)) || (await nameBtn.isDisplayed().catch(() => false)),
      {
        timeout: 45000,
        interval: 75,
        timeoutMsg: 'Expected post-payment screen to return to Name/CLOSE state'
      }
    );
  }
}

module.exports = CheckoutPage;
