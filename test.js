const { remote } = require('webdriverio');
const config = require('./config.json');

async function findElementFast(driver, text) {

    // Try visible element first
    const visibleElement = await driver.$(
        `android=new UiSelector().text("${text}")`
    );

    // RecyclerView items might exist in layout cache but not be displayed.
    // We must ensure it is displayed to avoid clicking the wrong recycled view.
    if (await visibleElement.isExisting() && await visibleElement.isDisplayed()) {
        return visibleElement;
    }

    // Scroll only if not visible
    await driver.$(
        `android=new UiScrollable(new UiSelector().scrollable(true)).setAsVerticalList().scrollIntoView(new UiSelector().text("${text}"))`
    );

    // Let the scroll settle
    await driver.pause(1500);

    // Find and return the fresh, stable element now that it is scrolled into view
    return await driver.$(
        `android=new UiSelector().text("${text}")`
    );
}

async function findElementContainsFast(driver, text) {

    // Try visible element first
    const visibleElement = await driver.$(
        `android=new UiSelector().textContains("${text}")`
    );

    // RecyclerView items might exist in layout cache but not be displayed.
    // We must ensure it is displayed to avoid clicking the wrong recycled view.
    if (await visibleElement.isExisting() && await visibleElement.isDisplayed()) {
        return visibleElement;
    }

    // Scroll only if not visible
    await driver.$(
        `android=new UiScrollable(new UiSelector().scrollable(true)).setAsVerticalList().scrollIntoView(new UiSelector().textContains("${text}"))`
    );

    // Let the scroll settle
    await driver.pause(1500);

    // Find and return the fresh, stable element now that it is scrolled into view
    return await driver.$(
        `android=new UiSelector().textContains("${text}")`
    );
}

async function setupAndEnterPOS(driver) {
    console.log("App launched successfully");

    await driver.pause(5000);

    // Check if POS button is already visible (app is on Dashboard)
    const posButtonOnLaunch = await driver.$(
        'android=new UiSelector().text("POS")'
    );

    let isAlreadyOnDashboard = false;
    try {
        console.log("Checking if already on Dashboard screen...");
        // Short wait to see if POS button is displayed
        if (await posButtonOnLaunch.waitForDisplayed({ timeout: 5000 })) {
            isAlreadyOnDashboard = true;
            console.log("App opened directly on Dashboard screen!");
        }
    } catch (e) {
        console.log("Not on Dashboard screen, starting full school selection setup flow...");
    }

    if (isAlreadyOnDashboard) {
        // Already on dashboard, just click POS button
        console.log("POS button visible");
        await posButtonOnLaunch.click();
        console.log("POS clicked");
        await driver.pause(5000);
    } else {
        // =========================
        // SCHOOL SELECTION
        // =========================

        console.log("Searching school...");

        const school = await findElementFast(
            driver,
            "FOREST HILL SCHOOL Dev 1"
        );

        await school.waitForDisplayed({
            timeout: 10000
        });

        // Let scroll settle to prevent clicking the wrong school
        await driver.pause(1500);

        // Use native clickGesture for reliable clicking on MAUI
        await driver.execute('mobile: clickGesture', {
            elementId: school.elementId
        });

        console.log("School selected");

        // =========================
        // WAIT FOR NEXT SCREEN
        // =========================

        await driver.pause(3000);

        // =========================
        // LEFT COLUMN SELECTION
        // =========================

        console.log("Selecting left hierarchy option...");

        const leftOption = await driver.$(
            'android=new UiSelector().textContains("RSQAone")'
        );

        await leftOption.waitForDisplayed({
            timeout: 10000
        });

        // Recommended for MAUI apps
        await driver.execute('mobile: clickGesture', {
            elementId: leftOption.elementId
        });

        console.log("Left hierarchy selected");

        // =========================
        // RIGHT COLUMN SELECTION
        // =========================

        const rightOption = await driver.$(
            'android=new UiSelector().textContains("RSDe one")'
        );

        await rightOption.waitForDisplayed({
            timeout: 15000
        });

        console.log("Right option appeared");

        console.log(
            "Displayed:",
            await rightOption.isDisplayed()
        );

        console.log(
            "Enabled:",
            await rightOption.isEnabled()
        );

        // Native Android click
        await driver.execute('mobile: clickGesture', {
            elementId: rightOption.elementId
        });

        console.log("Right hierarchy selected");

        await driver.pause(5000);
        const proceedButton = await driver.$(
            'android=new UiSelector().textContains("Proceed")'
        );

        await proceedButton.waitForDisplayed({
            timeout: 10000
        });

        console.log("Proceed button found");

        // Recommended for MAUI apps
        await driver.execute('mobile: clickGesture', {
            elementId: proceedButton.elementId
        });

        console.log("Proceed clicked");

        console.log("Waiting for confirmation popup...");

        const yesButton = await driver.$(
            'android=new UiSelector().text("Yes")'
        );

        await yesButton.waitForDisplayed({
            timeout: 10000
        });

        await yesButton.click();

        console.log("Clicked YES on popup");

        await driver.pause(5000);

        console.log("Waiting for dashboard...");

        const posButton = await driver.$(
            'android=new UiSelector().text("POS")'
        );

        await posButton.waitForDisplayed({
            timeout: 15000
        });

        console.log("POS button visible");

        await posButton.click();

        console.log("POS clicked");

        await driver.pause(5000);
    }

    console.log("Searching menu option...");

    const menuOption = await findElementFast(
        driver,
        "SENIOR POS MENU"
    );

    await menuOption.waitForDisplayed({
        timeout: 10000
    });

    // Recommended for MAUI apps
    await driver.execute('mobile: clickGesture', {
        elementId: menuOption.elementId
    });

    console.log("SENIOR POS MENU clicked");

    await driver.pause(5000);

    console.log("Waiting for POS page to load...");

    const nameButton = await findElementFast(
        driver,
        "Name"
    );

    await nameButton.waitForDisplayed({
        timeout: 15000
    });

    // Recommended for MAUI apps
    await driver.execute('mobile: clickGesture', {
        elementId: nameButton.elementId
    });

    console.log("Name button clicked");

    await driver.pause(5000);
}

async function main() {

    let driver = await remote({
        hostname: '127.0.0.1',
        port: 4723,
        path: '/',
        capabilities: {

            platformName: 'Android',

            'appium:automationName': 'UiAutomator2',

            'appium:deviceName': 'Android',

            'appium:udid': '192.168.4.34:33023',

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
                console.error(`[ERROR] Initial setup attempt #${setupRetries} failed:`, setupError.message);

                const isCrash = setupError.message.includes("instrumentation") ||
                    setupError.message.includes("crashed") ||
                    setupError.message.includes("Session") ||
                    setupError.message.includes("no such session");

                if (isCrash && setupRetries < 5) {
                    console.log("\n⚠️ [CRASH DETECTED during startup] App or server crashed! Relaunching and retrying setup...");
                    try {
                        try {
                            await driver.deleteSession();
                        } catch (e) { }

                        driver = await remote({
                            hostname: '127.0.0.1',
                            port: 4723,
                            path: '/',
                            capabilities: {
                                platformName: 'Android',
                                'appium:automationName': 'UiAutomator2',
                                'appium:deviceName': 'Android',
                                'appium:udid': '192.168.4.34:33023',
                                'appium:appPackage': 'com.parentpay.PointOfService',
                                'appium:appActivity': 'com.parentpay.PointOfService.MainActivity',
                                'appium:noReset': true
                            }
                        });
                    } catch (e) {
                        console.error("Failed to relaunch driver during startup setup recovery:", e.message);
                    }
                } else {
                    if (setupRetries >= 5) {
                        throw setupError; // Max retries exceeded, throw to crash out
                    }
                    console.log("Retrying startup setup in 5 seconds...");
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
        const childName = config.childName || "10Thaprilposfix6";
        const productName = config.productName || "test for";

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
                console.log(`\n--- Starting Cycle #${cycle} of ${maxCycles} ---`);
            } else {
                console.log(`\n--- Starting Cycle #${cycle} (Elapsed: ${elapsedMins} mins, Target: ${config.durationMins} mins) ---`);
            }

            try {
                console.log(`Searching for child '${childName}'...`);

                const childElement = await findElementContainsFast(
                    driver,
                    childName
                );

                await childElement.waitForDisplayed({
                    timeout: 15000
                });

                // Recommended for MAUI apps
                await driver.execute('mobile: clickGesture', {
                    elementId: childElement.elementId
                });

                console.log(`Child '${childName}' selected`);

                const delayAfterChild = config.delayAfterChildMs !== undefined ? config.delayAfterChildMs : 500;
                await driver.pause(delayAfterChild);

                console.log(`Searching for product '${productName}'...`);

                const productElement = await findElementContainsFast(
                    driver,
                    productName
                );

                await productElement.waitForDisplayed({
                    timeout: 10000
                });

                // Recommended for MAUI apps
                await driver.execute('mobile: clickGesture', {
                    elementId: productElement.elementId
                });

                console.log(`Product '${productName}' clicked`);

                const delayAfterProduct = config.delayAfterProductMs !== undefined ? config.delayAfterProductMs : 0;
                await driver.pause(delayAfterProduct);

                console.log("Waiting for 'Select Wallet' button to be enabled...");

                const selectWalletButton = await driver.$(
                    'android=new UiSelector().text("Select Wallet")'
                );

                await selectWalletButton.waitForDisplayed({
                    timeout: 10000
                });

                await driver.waitUntil(
                    async () => await selectWalletButton.isEnabled(),
                    {
                        timeout: 15000,
                        timeoutMsg: 'Expected Select Wallet button to be enabled'
                    }
                );

                console.log("Select Wallet button is enabled");

                // Recommended for MAUI apps
                await driver.execute('mobile: clickGesture', {
                    elementId: selectWalletButton.elementId
                });

                console.log("Select Wallet button clicked");

                const delayAfterWallet = config.delayAfterWalletMs !== undefined ? config.delayAfterWalletMs : 500;
                await driver.pause(delayAfterWallet);

                console.log("Waiting for Checkout page to load...");

                const payButton = await driver.$(
                    'android=new UiSelector().text("Pay")'
                );

                await payButton.waitForDisplayed({
                    timeout: 15000
                });

                // Recommended for MAUI apps
                await driver.execute('mobile: clickGesture', {
                    elementId: payButton.elementId
                });

                console.log("Pay button clicked");

                const delayAfterPay = config.delayAfterPayMs !== undefined ? config.delayAfterPayMs : 500;
                await driver.pause(delayAfterPay);

                cycle++;

            } catch (cycleError) {
                console.error(`[ERROR] Cycle #${cycle} failed:`, cycleError.message);

                const isCrash = cycleError.message.includes("instrumentation") ||
                    cycleError.message.includes("crashed") ||
                    cycleError.message.includes("Session") ||
                    cycleError.message.includes("no such session");

                if (isCrash) {
                    console.log("\n⚠️ [CRASH DETECTED] App or UiAutomator2 server crashed! Attempting to relaunch...");
                    try {
                        try {
                            await driver.deleteSession();
                        } catch (e) { }

                        console.log("Relaunching Appium session...");
                        driver = await remote({
                            hostname: '127.0.0.1',
                            port: 4723,
                            path: '/',
                            capabilities: {
                                platformName: 'Android',
                                'appium:automationName': 'UiAutomator2',
                                'appium:deviceName': 'Android',
                                'appium:udid': '192.168.4.34:33023',
                                'appium:appPackage': 'com.parentpay.PointOfService',
                                'appium:appActivity': 'com.parentpay.PointOfService.MainActivity',
                                'appium:noReset': true
                            }
                        });

                        await setupAndEnterPOS(driver);
                        console.log("Relaunch successful! Resuming ordering loop...");
                    } catch (relaunchError) {
                        console.error("[CRITICAL] Relaunch failed:", relaunchError.message);
                        await driver.pause(5000);
                    }
                } else {
                    console.log("Attempting to recover and continue to next cycle...");
                    await driver.pause(5000); // 5 seconds recovery delay
                }
            }
        }

        console.log(`\n=== Automation Run Complete! Successfully executed ${cycle - 1} cycles ===`);

    } catch (error) {

        console.error("Automation failed:");
        console.error(error);

    } finally {

        await driver.deleteSession();

        console.log("Session closed");
    }
}

main();