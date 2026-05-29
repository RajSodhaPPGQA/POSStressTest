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
    // Probes via $$ inside the predicate to avoid stale element refs and upfront network round-trips.
    const closeSelector = `android=new UiSelector().text("${locators.closeButton}")`;
    const nameSelector  = `android=new UiSelector().text("${locators.nameButton}")`;

    await driver.waitUntil(
      async () => {
        const closes = await driver.$$(closeSelector);
        if (closes.length > 0 && await closes[0].isDisplayed().catch(() => false)) return true;
        const names = await driver.$$(nameSelector);
        return names.length > 0 && await names[0].isDisplayed().catch(() => false);
      },
      {
        timeout: 45000,
        interval: 50,
        timeoutMsg: 'Expected post-payment screen to return to Name/CLOSE state'
      }
    );
  }
}

module.exports = CheckoutPage;
