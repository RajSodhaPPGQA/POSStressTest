const BasePage = require('./BasePage');
const locators = require('../locators.json');
const { log } = require('../utils/logger');

class HierarchyPage {
  static async isDisplayed(driver) {
    const header = await driver.$(`android=new UiSelector().text("${locators.hierarchyHeader}")`);
    try {
      return await header.isExisting() && await header.isDisplayed();
    } catch (e) {
      return false;
    }
  }

  static async selectLeftOption(driver) {
    log("HIERARCHY", `Selecting left hierarchy option: "${locators.hierarchyLeft}"...`);
    await BasePage.clickText(driver, locators.hierarchyLeft);
    log("HIERARCHY", "Left hierarchy selected");
  }

  static async selectRightOption(driver) {
    log("HIERARCHY", `Selecting right hierarchy option: "${locators.hierarchyRight}"...`);
    await BasePage.clickText(driver, locators.hierarchyRight);
    log("HIERARCHY", "Right hierarchy selected");
  }

  static async selectSchool(driver) {
    log("HIERARCHY", `Selecting school: "${locators.schoolDev}"...`);
    await BasePage.clickText(driver, locators.schoolDev);
    log("HIERARCHY", "School selected");
  }

  static async completeHierarchySetup(driver) {
    log("HIERARCHY", "Completing hierarchy selection flow...");
    await this.selectRightOption(driver);

    await driver.pause(5000);
    log("HIERARCHY", "Waiting for Proceed button...");
    await BasePage.clickTextContains(driver, locators.proceedButton);
    log("HIERARCHY", "Proceed clicked");

    log("HIERARCHY", "Waiting for confirmation popup...");
    const yesButton = await driver.$(`android=new UiSelector().text("${locators.yesButton}")`);
    await yesButton.waitForDisplayed({ timeout: 15000 });
    await yesButton.click();
    log("HIERARCHY", "Clicked YES on popup");
  }

  static async clickBackButton(driver) {
    log("HIERARCHY", "Clicking back button to return to school selection...");
    try {
      // Direct ADB input tap on the back button coordinates to guarantee navigation!
      const targetUdid = driver.capabilities.udid || "";
      if (targetUdid) {
        log("HIERARCHY", `Executing ADB input tap at [131, 65] on device "${targetUdid}"...`);
        const { execSync } = require('child_process');
        execSync(`adb -s ${targetUdid} shell input tap 131 65`);
        await driver.pause(3000);
        return;
      }
    } catch (adbErr) {
      log("HIERARCHY_WARNING", `ADB input tap failed: ${adbErr.message}`);
    }

    try {
      // Tap at coordinates (100, 65) which is the absolute center area of the top-left back arrow
      log("HIERARCHY", "Tapping back arrow at coordinates [100, 65]...");
      await driver.execute('mobile: clickGesture', { x: 100, y: 65 });
      await driver.pause(3000);
      return;
    } catch (e) {
      log("HIERARCHY_WARNING", `Failed to click back coordinates: ${e.message}`);
    }

    try {
      const backBtn = await driver.$('android=new UiSelector().text("")');
      if (await backBtn.isExisting() && await backBtn.isDisplayed()) {
        await backBtn.click();
        log("HIERARCHY", "Back button clicked successfully");
        await driver.pause(3000);
        return;
      }
    } catch (e) {
      log("HIERARCHY_WARNING", `Failed to click back button: ${e.message}`);
    }
    log("HIERARCHY", "Falling back to system back gesture...");
    await driver.back();
    await driver.pause(3000);
  }
}

module.exports = HierarchyPage;
