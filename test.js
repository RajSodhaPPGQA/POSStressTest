const { remote } = require('webdriverio');
const config = require('./config.json');
const { execSync } = require('child_process');
const readline = require('readline');

// Utilities
const { log } = require('./utils/logger');
const { reconnectAdb } = require('./utils/adb');

// Page Objects
const BasePage = require('./pages/BasePage');
const DashboardPage = require('./pages/DashboardPage');
const HierarchyPage = require('./pages/HierarchyPage');
const POSPage = require('./pages/POSPage');
const CheckoutPage = require('./pages/CheckoutPage');
const locators = require('./locators.json');

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans.trim());
    }));
}

async function getDeviceUdid() {
    let devices = [];
    try {
        const output = execSync('adb devices').toString();
        const lines = output.trim().split('\n');
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
                const parts = line.split(/\s+/);
                if (parts[1] === 'device') {
                    devices.push(parts[0]);
                }
            }
        }
    } catch (e) {
        // adb not available or failed
    }

    if (config.udid) {
        log("SETUP", `Configured UDID found in config.json: "${config.udid}"`);
        if (devices.includes(config.udid)) {
            log("SETUP", `Device is currently connected! Auto-selecting it.`);
            return config.udid;
        } else {
            log("SETUP", `Warning: Configured device "${config.udid}" is not shown in 'adb devices'.`);
        }
    }

    if (devices.length === 1) {
        log("SETUP", `Auto-detected only one connected device: "${devices[0]}". Connecting...`);
        return devices[0];
    }

    console.log("\n--- ADB Device Selection ---");
    if (devices.length > 0) {
        devices.forEach((dev, idx) => {
            console.log(`[${idx + 1}] ${dev}`);
        });
        console.log(`[${devices.length + 1}] Enter custom UDID manually`);

        const selection = await askQuestion(`Select device (1-${devices.length + 1}): `);
        const selIdx = parseInt(selection) - 1;

        if (selIdx >= 0 && selIdx < devices.length) {
            log("SETUP", `Selected device: "${devices[selIdx]}"`);
            return devices[selIdx];
        }
    }

    const customUdid = await askQuestion("Enter device UDID manually (e.g. 192.168.4.34:33023): ");
    if (!customUdid) {
        throw new Error("No device UDID entered. Exiting.");
    }
    return customUdid;
}

async function setupAndEnterPOS(driver) {
    log("SETUP", "App launched / recovered. Detecting current screen...");
    try {
        log("SETUP", "Activating app com.parentpay.PointOfService to ensure foreground focus...");
        await driver.activateApp('com.parentpay.PointOfService');
    } catch (e) {
        log("SETUP_WARNING", `Failed to activate app via driver: ${e.message}`);
    }
    await driver.pause(5000); // let page load

    // Proactively clear any network failure or server error alerts
    try {
        await BasePage.checkForAlertsAndDismiss(driver);
    } catch (e) {}

    // 1. Check if we are on the Checkout/Pay Page (State G)
    if (await CheckoutPage.isDisplayed(driver)) {
        log("SETUP", "🎯 State G Detected: Already on Checkout/Pay Page. Completing transaction...");
        await CheckoutPage.clickPay(driver);
        await driver.pause(5000);
        return;
    }

    // 2. Check if we are on the Product Selection Page with Product Selected (State H)
    if (await POSPage.isProductPageWithSelectedProduct(driver)) {
        log("SETUP", "🎯 State H Detected: On POS Product page with a product already selected. Clicking 'Select Wallet'...");
        await POSPage.clickSelectWallet(driver);
        await driver.pause(5000);

        log("SETUP", "Waiting for Pay button...");
        const payBtnOnLaunch = await driver.$(`android=new UiSelector().text("${locators.payButton}")`);
        await payBtnOnLaunch.waitForDisplayed({ timeout: 15000 });
        await CheckoutPage.clickPay(driver);
        await driver.pause(5000);
        return;
    }

    // 3. Check if we are already on the Search Child Page (State D)
    if (await POSPage.isSearchChildDisplayed(driver)) {
        log("SETUP", "🎯 State D Detected: Already on the Search Child screen! Ready to select child.");
        return; // Resume directly
    }

    // 4. Check if we are on the POS Product Selection Page (State C)
    if (await POSPage.isPOSMainDisplayed(driver)) {
        log("SETUP", "🎯 State C Detected: Already on POS page. Opening Search Child...");
        await POSPage.clickName(driver);
        await driver.pause(5000);
        return;
    }

    // 5. Check if we are on the POS Menu Page (State F)
    if (await POSPage.isMenuDisplayed(driver)) {
        log("SETUP", "🎯 State F Detected: On POS Menu screen. Clicking 'SENIOR POS MENU'...");
        await POSPage.clickMenuOption(driver);
        await driver.pause(5000);

        log("SETUP", "Waiting for POS page to load...");
        const nameBtn = await BasePage.findElementFast(driver, locators.nameButton);
        await nameBtn.waitForDisplayed({ timeout: 15000 });
        await POSPage.clickName(driver);
        await driver.pause(5000);
        return;
    }

    // 6. Check if we are on the Dashboard Page (State B)
    if (await DashboardPage.isDisplayed(driver)) {
        log("SETUP", "🎯 State B Detected: On Dashboard screen. Navigating to POS...");
        await DashboardPage.clickPOS(driver);
        await driver.pause(5000);

        log("SETUP", "Searching menu option...");
        await POSPage.clickMenuOption(driver);
        await driver.pause(5000);

        log("SETUP", "Waiting for POS page to load...");
        const nameBtn = await BasePage.findElementFast(driver, locators.nameButton);
        await nameBtn.waitForDisplayed({ timeout: 15000 });
        await POSPage.clickName(driver);
        await driver.pause(5000);
        return;
    }

    // 7. Check if we are on the Hierarchy Selection Page (State E)
    let isStateE = await HierarchyPage.isDisplayed(driver);

    if (isStateE) {
        log("SETUP", "🎯 State E Detected: Already on Hierarchy Selection screen.");
        
        // Dynamic School Validation: Check if the correct school's outlet is available
        let isCorrectSchool = false;
        try {
            // Strict exact match to prevent false positives from similar school names
            const leftOption = await driver.$(`android=new UiSelector().text("${locators.hierarchyLeft}")`);
            if (await leftOption.isExisting() && await leftOption.isDisplayed()) {
                isCorrectSchool = true;
            } else {
                // Perform a fast retry check inside layout list
                log("SETUP", `Checking if target outlet "${locators.hierarchyLeft}" is visible in list...`);
                for (let i = 0; i < 3; i++) {
                    if (await leftOption.isDisplayed()) {
                        isCorrectSchool = true;
                        break;
                    }
                    await driver.pause(500);
                }
            }
        } catch (e) {}

        if (isCorrectSchool) {
            log("SETUP", "Correct school pre-selected. Resuming hierarchy setup...");
            await HierarchyPage.selectLeftOption(driver);
        } else {
            log("SETUP", "⚠️ Wrong school pre-selected! Navigating back to correct it...");
            await HierarchyPage.clickBackButton(driver);
            
            // We are now back on School Selection Page (State A)
            log("SETUP", "🎯 State A Detected: Starting full school selection setup flow...");
            await HierarchyPage.selectSchool(driver);

            log("SETUP", "Waiting 5 seconds for hierarchy screen to load...");
            await driver.pause(5000);

            await HierarchyPage.selectLeftOption(driver);
        }
    } else {
        // 8. Default: Initial Startup Setup Flow (State A)
        log("SETUP", "🎯 State A Detected: Starting full school selection setup flow...");
        await HierarchyPage.selectSchool(driver);

        log("SETUP", "Waiting 5 seconds for hierarchy screen to load...");
        await driver.pause(5000);

        await HierarchyPage.selectLeftOption(driver);
    }

    // Shared flow after left option selection (both State A and State E)
    await HierarchyPage.completeHierarchySetup(driver);

    await driver.pause(5000);

    log("SETUP", "Waiting for dashboard...");
    const posBtn = await driver.$(`android=new UiSelector().text("${locators.posButton}")`);
    await posBtn.waitForDisplayed({ timeout: 20000 });
    await DashboardPage.clickPOS(driver);

    await driver.pause(5000);

    log("SETUP", "Searching menu option...");
    await POSPage.clickMenuOption(driver);

    await driver.pause(5000);

    log("SETUP", "Waiting for POS page to load...");
    const nameBtn = await BasePage.findElementFast(driver, locators.nameButton);
    await nameBtn.waitForDisplayed({ timeout: 20000 });
    await POSPage.clickName(driver);

    await driver.pause(5000);
}

async function main() {
    // If a wireless UDID is configured, proactively trigger reconnection before device checking!
    if (config.udid) {
        reconnectAdb(config.udid);
    }

    const targetUdid = await getDeviceUdid();

    // Force stop and launch freshly via ADB before creating first Appium session
    try {
        log("ADB", `Force-stopping app via ADB on device: "${targetUdid}"...`);
        execSync(`adb -s ${targetUdid} shell am force-stop com.parentpay.PointOfService`);
        log("ADB", `Launching app via ADB on device: "${targetUdid}"...`);
        execSync(`adb -s ${targetUdid} shell am start -n com.parentpay.PointOfService/com.parentpay.PointOfService.MainActivity`);
        await new Promise(resolve => setTimeout(resolve, 3000)); // wait for layout to start
    } catch (adbError) {
        log("ADB_WARNING", `ADB initial launch sequence warning: ${adbError.message}`);
    }

    let driver = await remote({
        hostname: '127.0.0.1',
        port: 4723,
        path: '/',
        capabilities: {
            platformName: 'Android',
            'appium:automationName': 'UiAutomator2',
            'appium:deviceName': 'Android',
            'appium:udid': targetUdid,
            'appium:appPackage': 'com.parentpay.PointOfService',
            'appium:appActivity': 'com.parentpay.PointOfService.MainActivity',
            'appium:noReset': true
        }
    });

    try {
        let setupSuccess = false;
        let setupRetries = 0;

        while (!setupSuccess && setupRetries < 5) {
            try {
                await setupAndEnterPOS(driver);
                setupSuccess = true;
            } catch (setupError) {
                setupRetries++;
                log("ERROR", `Initial setup attempt #${setupRetries} failed: ${setupError.message}`);
                
                // Screenshot on startup failure
                await BasePage.saveFailureScreenshot(driver, `startup_attempt_${setupRetries}`);

                const errMsg = (setupError.message || "").toLowerCase();
                const isCrash = errMsg.includes("instrumentation") ||
                    errMsg.includes("crash") ||
                    errMsg.includes("session") ||
                    errMsg.includes("refuse") ||
                    errMsg.includes("connection") ||
                    errMsg.includes("socket") ||
                    errMsg.includes("terminated") ||
                    errMsg.includes("closed") ||
                    errMsg.includes("econn") ||
                    errMsg.includes("hang up");

                if (isCrash && setupRetries < 5) {
                    log("SETUP_CRASH", "App or server crashed during startup! Relaunching and retrying...");
                    try {
                        try {
                            await driver.deleteSession();
                        } catch (e) { }

                        // Reconnect wireless ADB
                        reconnectAdb(targetUdid);

                        // Force kill the app process on device via ADB to ensure a clean boot
                        try {
                            log("ADB", `Force-stopping app via ADB on device: "${targetUdid}"...`);
                            execSync(`adb -s ${targetUdid} shell am force-stop com.parentpay.PointOfService`);
                        } catch (adbError) {
                            log("ADB_WARNING", `ADB force-stop warning: ${adbError.message}`);
                        }

                        // Start the app explicitly via ADB to guarantee launch
                        try {
                            log("ADB", `Launching app via ADB on device: "${targetUdid}"...`);
                            execSync(`adb -s ${targetUdid} shell am start -n com.parentpay.PointOfService/com.parentpay.PointOfService.MainActivity`);
                        } catch (adbError) {
                            log("ADB_WARNING", `ADB launch warning: ${adbError.message}`);
                        }

                        driver = await remote({
                            hostname: '127.0.0.1',
                            port: 4723,
                            path: '/',
                            capabilities: {
                                platformName: 'Android',
                                'appium:automationName': 'UiAutomator2',
                                'appium:deviceName': 'Android',
                                'appium:udid': targetUdid,
                                'appium:appPackage': 'com.parentpay.PointOfService',
                                'appium:appActivity': 'com.parentpay.PointOfService.MainActivity',
                                'appium:noReset': true
                            }
                        });
                    } catch (e) {
                        log("CRITICAL", `Failed to relaunch driver during startup setup recovery: ${e.message}`);
                    }
                } else {
                    if (setupRetries >= 5) {
                        throw setupError; // Max retries exceeded, throw to crash out
                    }
                    log("RETRY", "Retrying startup setup in 5 seconds...");
                    await driver.pause(5000);
                }
            }
        }

        // ==========================================
        // CONFIGURABLE ORDERING LOOP
        // ==========================================
        const startTime = Date.now();
        const runMode = config.mode || "duration"; // "duration" or "cycles"
        const durationMs = (config.durationMins || 5) * 60 * 1000;
        const maxCycles = config.maxCycles || 10;

        // Parse comma-separated list of children and products
        const parseConfigList = (value) => {
            if (!value) return [];
            return value.toString().split(',').map(s => s.trim()).filter(s => s.length > 0);
        };

        const childrenList = parseConfigList(config.childName || "10Thaprilposfix6");
        const productsList = parseConfigList(config.productName || "test for");

        let cycle = 1;

        const shouldContinue = () => {
            if (runMode === "cycles") {
                return cycle <= maxCycles;
            } else {
                return (Date.now() - startTime) < durationMs;
            }
        };

        while (shouldContinue()) {
            const elapsedMins = ((Date.now() - startTime) / 60000).toFixed(1);
            if (runMode === "cycles") {
                log("CYCLE", `Starting Cycle #${cycle} of ${maxCycles}`);
            } else {
                log("CYCLE", `Starting Cycle #${cycle} (Elapsed: ${elapsedMins} mins, Target: ${config.durationMins} mins)`);
            }

            // Pick a random child and product for this cycle
            const currentChild = childrenList.length > 0
                ? childrenList[Math.floor(Math.random() * childrenList.length)]
                : "10Thaprilposfix6";

            const currentProduct = productsList.length > 0
                ? productsList[Math.floor(Math.random() * productsList.length)]
                : "test for";

            try {
                // Clear any network or exception popups before continuing
                try {
                    await BasePage.checkForAlertsAndDismiss(driver);
                } catch (e) {}

                await POSPage.selectChild(driver, currentChild);

                const delayAfterChild = config.delayAfterChildMs !== undefined ? config.delayAfterChildMs : 500;
                await driver.pause(delayAfterChild);

                await POSPage.selectProduct(driver, currentProduct);

                const delayAfterProduct = config.delayAfterProductMs !== undefined ? config.delayAfterProductMs : 0;
                await driver.pause(delayAfterProduct);

                await POSPage.clickSelectWallet(driver);

                const delayAfterWallet = config.delayAfterWalletMs !== undefined ? config.delayAfterWalletMs : 500;
                await driver.pause(delayAfterWallet);

                log("ORDER", "Waiting for Checkout page to load...");
                const payButton = await driver.$(`android=new UiSelector().text("${locators.payButton}")`);
                await payButton.waitForDisplayed({ timeout: 15000 });

                await CheckoutPage.clickPay(driver);

                const delayAfterPay = config.delayAfterPayMs !== undefined ? config.delayAfterPayMs : 500;
                await driver.pause(delayAfterPay);

                cycle++;

            } catch (cycleError) {
                log("ERROR", `Cycle #${cycle} failed: ${cycleError.message}`);
                
                // Screenshot on cycle failure
                await BasePage.saveFailureScreenshot(driver, `cycle_${cycle}`);

                const errMsg = (cycleError.message || "").toLowerCase();
                const isCrash = errMsg.includes("instrumentation") ||
                    errMsg.includes("crash") ||
                    errMsg.includes("session") ||
                    errMsg.includes("refuse") ||
                    errMsg.includes("connection") ||
                    errMsg.includes("socket") ||
                    errMsg.includes("terminated") ||
                    errMsg.includes("closed") ||
                    errMsg.includes("econn") ||
                    errMsg.includes("hang up");

                if (isCrash) {
                    log("CRASH", "App or UiAutomator2 server crashed! Attempting to relaunch...");
                    try {
                        try {
                            await driver.deleteSession();
                        } catch (e) { }

                        // Reconnect wireless ADB
                        reconnectAdb(targetUdid);

                        // Force kill the app process on device via ADB to ensure a clean boot
                        try {
                            log("ADB", `Force-stopping app via ADB on device: "${targetUdid}"...`);
                            execSync(`adb -s ${targetUdid} shell am force-stop com.parentpay.PointOfService`);
                        } catch (adbError) {
                            log("ADB_WARNING", `ADB force-stop warning: ${adbError.message}`);
                        }

                        // Start the app explicitly via ADB to guarantee launch
                        try {
                            log("ADB", `Launching app via ADB on device: "${targetUdid}"...`);
                            execSync(`adb -s ${targetUdid} shell am start -n com.parentpay.PointOfService/com.parentpay.PointOfService.MainActivity`);
                        } catch (adbError) {
                            log("ADB_WARNING", `ADB launch warning: ${adbError.message}`);
                        }

                        log("SETUP", "Relaunching Appium session...");
                        driver = await remote({
                            hostname: '127.0.0.1',
                            port: 4723,
                            path: '/',
                            capabilities: {
                                platformName: 'Android',
                                'appium:automationName': 'UiAutomator2',
                                'appium:deviceName': 'Android',
                                'appium:udid': targetUdid,
                                'appium:appPackage': 'com.parentpay.PointOfService',
                                'appium:appActivity': 'com.parentpay.PointOfService.MainActivity',
                                'appium:noReset': true
                            }
                        });

                        await setupAndEnterPOS(driver);
                        log("SETUP", "Relaunch successful! Resuming ordering loop...");
                    } catch (relaunchError) {
                        log("CRITICAL", `Relaunch failed: ${relaunchError.message}`);
                        await driver.pause(5000);
                    }
                } else {
                    log("RECOVERY", "Attempting to recover and continue to next cycle...");
                    try {
                        await BasePage.checkForAlertsAndDismiss(driver);
                    } catch (e) {}
                    await driver.pause(5000); // 5 seconds recovery delay
                }
            }
        }

        log("SUCCESS", `Automation Run Complete! Successfully executed ${cycle - 1} cycles`);

    } catch (error) {
        log("FATAL", `Automation failed: ${error.message}`);
    } finally {
        await driver.deleteSession();
        log("SETUP", "Session closed");
    }
}

main();