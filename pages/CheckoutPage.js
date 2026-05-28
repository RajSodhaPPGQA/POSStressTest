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
    await BasePage.safeClick(driver, payButton);
    
    // Monitor transition post-payment back to POS Main (State C) or Search Child (State D)
    const closeSelector = `android=new UiSelector().text("${locators.closeButton}")`;
    const nameSelector = `android=new UiSelector().text("${locators.nameButton}")`;
    
    const closeBtn = await driver.$(closeSelector);
    const nameBtn = await driver.$(nameSelector);
    
    await BasePage.monitorTransition(driver, async () => {
      return (await closeBtn.isExisting() && await closeBtn.isDisplayed()) ||
             (await nameBtn.isExisting() && await nameBtn.isDisplayed());
    }, 60000, 1000);
  }
}

module.exports = CheckoutPage;
