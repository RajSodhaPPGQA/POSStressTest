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

    // STATE VERIFICATION: Ensure we successfully navigated to POS Menu Page (State F)
    log("DASHBOARD", "Verifying POS Menu page loaded successfully...");
    const menuBtn = await driver.$(`android=new UiSelector().text("${locators.menuOption}")`);
    await BasePage.waitVisible(driver, menuBtn, 20000);
  }
}

module.exports = DashboardPage;
