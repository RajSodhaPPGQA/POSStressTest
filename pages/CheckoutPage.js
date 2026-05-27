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
    await driver.execute('mobile: clickGesture', { elementId: payButton.elementId });
    log("CHECKOUT", "Pay button clicked");
  }
}

module.exports = CheckoutPage;
