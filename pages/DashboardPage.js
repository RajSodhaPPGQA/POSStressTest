const BasePage = require('./BasePage');
const locators = require('../locators.json');
const { log } = require('../utils/logger');

class DashboardPage {
  static async isDisplayed(driver) {
    const posButton = await driver.$(`android=new UiSelector().text("${locators.posButton}")`);
    try {
      return await posButton.isExisting() && await posButton.isDisplayed();
    } catch (e) {
      return false;
    }
  }

  static async clickPOS(driver) {
    log("DASHBOARD", "Clicking 'POS' button...");
    await BasePage.clickText(driver, locators.posButton);
  }
}

module.exports = DashboardPage;
