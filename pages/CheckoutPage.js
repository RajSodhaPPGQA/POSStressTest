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

    // Combined Selector to search for CLOSE and Name button in a single WebDriver call
    const combinedSelector = `android=new UiSelector().textMatches("^(${locators.closeButton}|${locators.nameButton})$")`;
    const executionMode = process.env.EXECUTION_MODE || config.executionMode || 'standard';
    const isRapid = executionMode === 'rapid';

    await driver.waitUntil(
      async () => {
        const matches = await driver.$$(combinedSelector);
        for (const m of matches) {
          if (await m.isDisplayed().catch(() => false)) {
            return true;
          }
        }
        return false;
      },
      {
        timeout: 45000,
        interval: isRapid ? 100 : 50,
        timeoutMsg: 'Expected post-payment screen to return to Name/CLOSE state'
      }
    );
  }
}

module.exports = CheckoutPage;
