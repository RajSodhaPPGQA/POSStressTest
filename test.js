const { remote } = require('webdriverio');
const config = require('./config.json');
const { execSync } = require('child_process');
const readline = require('readline');
const http = require('http');
async function checkAppiumHealth() {
    return new Promise((resolve, reject) => {
        const req = http.get({
            hostname: '127.0.0.1',
            port: 4723,
            path: '/status',
            timeout: 4000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const status = JSON.parse(data);
                    if (status.value && status.value.ready) {
                        resolve(true);
                    } else {
                        reject(new Error('Appium server is not ready'));
                    }
                } catch (e) {
                    reject(new Error('Appium status parse error: ' + e.message));
                }
            });
        });
        req.on('error', (err) => reject(new Error('Appium server not reachable: ' + err.message)));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Appium server status request timed out'));
        });
    });
}

// Utilities
const { log } = require('./utils/logger');
const { reconnectAdb, ensureAdbConnected, checkNetworkStatus, getAppMemoryUsage, resetUiAutomator2Server } = require('./utils/adb');

// Page Objects
const BasePage = require('./pages/BasePage');
const DashboardPage = require('./pages/DashboardPage');
const HierarchyPage = require('./pages/HierarchyPage');
const POSPage = require('./pages/POSPage');
const CheckoutPage = require('./pages/CheckoutPage');
const locators = require('./locators.json');

// Dynamic config overrides for locators
if (config.schoolDev) locators.schoolDev = config.schoolDev;
if (config.hierarchyLeft) locators.hierarchyLeft = config.hierarchyLeft;
if (config.hierarchyRight) locators.hierarchyRight = config.hierarchyRight;
if (config.menuOption) locators.menuOption = config.menuOption;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function buildRemoteOptions(targetUdid) {
    return {
        hostname: '127.0.0.1',
        port: 4723,
        path: '/',
        connectionRetryTimeout: config.connectionRetryTimeoutMs || 120000,
        connectionRetryCount: config.connectionRetryCount !== undefined ? config.connectionRetryCount : 1,
        capabilities: {
            platformName: 'Android',
            'appium:automationName': 'UiAutomator2',
            'appium:deviceName': 'Android',
            'appium:udid': targetUdid,
            'appium:appPackage': 'com.parentpay.PointOfService',
            'appium:appActivity': 'com.parentpay.PointOfService.MainActivity',
            'appium:noReset': true,
            'appium:newCommandTimeout': config.newCommandTimeout || 300,
            'appium:adbExecTimeout': config.adbExecTimeoutMs || 120000,
            'appium:uiautomator2ServerInstallTimeout': config.uia2InstallTimeoutMs || 120000,
            'appium:uiautomator2ServerLaunchTimeout': config.uia2LaunchTimeoutMs || 120000,
            'appium:disableWindowAnimation': config.disableWindowAnimation !== false,
            'appium:ignoreHiddenApiPolicyError': true
        }
    };
}

async function createDriverSession(targetUdid, reason = 'startup') {
    const attempts = config.driverInitRetries || 3;
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            log("SETUP", `Creating Appium session (${reason}) attempt ${attempt}/${attempts}...`);
            const driver = await remote(buildRemoteOptions(targetUdid));
            await driver.getWindowSize();
            return driver;
        } catch (e) {
            lastError = e;
            log("SETUP_WARNING", `Session creation attempt ${attempt} failed: ${e.message}`);
            try {
                resetUiAutomator2Server(targetUdid);
                execSync(`adb -s ${targetUdid} shell am force-stop com.parentpay.PointOfService`);
                execSync(`adb -s ${targetUdid} shell am start -n com.parentpay.PointOfService/com.parentpay.PointOfService.MainActivity`);
            } catch (resetErr) {
                log("ADB_WARNING", `Driver creation recovery failed: ${resetErr.message}`);
            }
            await sleep(2500);
        }
    }

    throw new Error(`Unable to create Appium session after ${attempts} attempts: ${lastError ? lastError.message : 'Unknown error'}`);
}

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

/**
 * Self-healing screen-detection and setup navigation engine.
 * Maps exact page states and resolves unexpected out-of-sync app states dynamically.
 */
async function setupAndEnterPOS(driver, unknownRecoveryAttempt = 0) {
    const unknownRecoveryLimit = config.unknownStateRecoveryLimit || 3;
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

    const state = await BasePage.detectCurrentState(driver);
    log("STATE", `Screen State Detected: "${state}"`);

    switch (state) {
        case 'State_G':
            log("SETUP", "🎯 State G Detected: Already on Checkout/Pay Page. Completing transaction...");
            await CheckoutPage.clickPay(driver);
            await driver.pause(5000);
            return;

        case 'State_H':
            log("SETUP", "🎯 State H Detected: On POS Product page with a product already selected. Clicking 'Select Wallet'...");
            await POSPage.clickSelectWallet(driver);
            await driver.pause(5000);
            log("SETUP", "Waiting for Pay button...");
            const payBtnOnLaunch = await driver.$(`android=new UiSelector().text("${locators.payButton}")`);
            await payBtnOnLaunch.waitForDisplayed({ timeout: 15000 });
            await CheckoutPage.clickPay(driver);
            await driver.pause(5000);
            return;

        case 'State_D':
            log("SETUP", "🎯 State D Detected: Already on the Search Child screen! Ready to select child.");
            return;

        case 'State_C':
            log("SETUP", "🎯 State C Detected: Already on POS page. Opening Search Child...");
            await POSPage.clickName(driver);
            await driver.pause(5000);
            return;

        case 'State_F':
            log("SETUP", "🎯 State F Detected: On POS Menu screen. Clicking 'SENIOR POS MENU'...");
            await POSPage.clickMenuOption(driver);
            await driver.pause(5000);
            log("SETUP", "Waiting for POS page to load...");
            const nameBtn = await driver.$(`android=new UiSelector().text("${locators.nameButton}")`);
            await nameBtn.waitForDisplayed({ timeout: 20000 });
            await POSPage.clickName(driver);
            await driver.pause(5000);
            return;

        case 'State_B':
            log("SETUP", "🎯 State B Detected: On Dashboard screen. Navigating to POS...");
            await DashboardPage.clickPOS(driver);
            await driver.pause(5000);
            log("SETUP", "Searching menu option...");
            await POSPage.clickMenuOption(driver);
            await driver.pause(5000);
            log("SETUP", "Waiting for POS page to load...");
            const nameBtnDashboard = await driver.$(`android=new UiSelector().text("${locators.nameButton}")`);
            await nameBtnDashboard.waitForDisplayed({ timeout: 20000 });
            await POSPage.clickName(driver);
            await driver.pause(5000);
            return;

        case 'State_E':
            log("SETUP", "🎯 State E Detected: Already on Hierarchy Selection screen.");
            let isCorrectSchool = false;
            try {
                const leftOption = await driver.$(`android=new UiSelector().text("${locators.hierarchyLeft}")`);
                if (await leftOption.isExisting() && await leftOption.isDisplayed()) {
                    isCorrectSchool = true;
                } else {
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
                log("SETUP", "🎯 State A Detected: Starting school selection flow...");
                await HierarchyPage.selectSchool(driver);
                await driver.pause(5000);
                await HierarchyPage.selectLeftOption(driver);
            }
            break;

        case 'State_A':
            log("SETUP", "🎯 State A Detected: Starting full school selection setup flow...");
            await HierarchyPage.selectSchool(driver);
            await driver.pause(5000);
            await HierarchyPage.selectLeftOption(driver);
            break;

        case 'unknown':
        default:
            if (unknownRecoveryAttempt >= unknownRecoveryLimit) {
                throw new Error(`Unknown state recovery limit reached (${unknownRecoveryLimit})`);
            }

            // Before rebooting, allow late-rendering school/hierarchy screens to settle and re-detect.
            log("STATE_WARN", "Unknown state detected. Performing local re-detection before ADB reboot...");
            try {
                await driver.pause(2500);
                await BasePage.checkForAlertsAndDismiss(driver);
                await BasePage.swipeUp(driver, 0.45);
                await driver.pause(1200);
                const recoveredState = await BasePage.detectCurrentState(driver);
                if (recoveredState !== 'unknown') {
                    log("STATE_RECOVERY", `Recovered state without reboot: "${recoveredState}"`);
                    return await setupAndEnterPOS(driver, unknownRecoveryAttempt + 1);
                }
            } catch (localRecoverErr) {
                log("STATE_WARN", `Local re-detection failed: ${localRecoverErr.message}`);
            }

            log("STATE_WARN", "⚠️ Unknown/Unrecognized screen state! Performing soft ADB reboot for safety...");
            const targetUdid = driver.capabilities.udid;
            try {
                execSync(`adb -s ${targetUdid} shell am force-stop com.parentpay.PointOfService`);
                execSync(`adb -s ${targetUdid} shell am start -n com.parentpay.PointOfService/com.parentpay.PointOfService.MainActivity`);
            } catch (adbErr) {
                log("ADB_WARNING", `Failed to reboot app during recovery: ${adbErr.message}`);
            }
            await driver.pause(7000); // Wait for boot
            // Recursive self-heal call
                return await setupAndEnterPOS(driver, unknownRecoveryAttempt + 1);
    }

    // Common hierarchy completion flow (State A & State E)
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
    const nameBtnHierarchy = await driver.$(`android=new UiSelector().text("${locators.nameButton}")`);
    await nameBtnHierarchy.waitForDisplayed({ timeout: 20000 });
    await POSPage.clickName(driver);
    await driver.pause(5000);
}

async function main() {
    log("SETUP", "Checking Appium server health at http://127.0.0.1:4723/status ...");
    try {
        await checkAppiumHealth();
        log("SETUP", "Appium server is healthy and ready.");
    } catch (e) {
        log("FATAL", `Appium server health check failed: ${e.message}`);
        process.exit(1);
    }
    // Proactively check wireless ADB reconnection
    if (config.udid) {
        reconnectAdb(config.udid);
    }

    const targetUdid = await getDeviceUdid();

    // Ensure connection state is stable before starting Appium session
    ensureAdbConnected(targetUdid);
    checkNetworkStatus(targetUdid);

    // Force stop and launch freshly via ADB before creating first Appium session
    try {
        log("ADB", `Force-stopping app via ADB on device: "${targetUdid}"...`);
        execSync(`adb -s ${targetUdid} shell am force-stop com.parentpay.PointOfService`);
        
        // Keep device awake if configured
        if (config.keepAwake !== false) {
            try {
                log("ADB", `Setting 'svc power stayon true' on device: "${targetUdid}" to prevent screen sleep...`);
                execSync(`adb -s ${targetUdid} shell svc power stayon true`);
            } catch (awakeErr) {
                log("ADB_WARNING", `Failed to set device keep-awake: ${awakeErr.message}`);
            }
        }

        log("ADB", `Launching app via ADB on device: "${targetUdid}"...`);
        execSync(`adb -s ${targetUdid} shell am start -n com.parentpay.PointOfService/com.parentpay.PointOfService.MainActivity`);
        await new Promise(resolve => setTimeout(resolve, 3000)); // wait for layout to start
    } catch (adbError) {
        log("ADB_WARNING", `ADB initial launch sequence warning: ${adbError.message}`);
    }

    let driver = await createDriverSession(targetUdid, 'initial');

    try {
        let setupSuccess = false;
        let setupRetries = 0;

        while (!setupSuccess && setupRetries < 5) {
            try {
                // Ensure ADB and network are up before attempting setup
                ensureAdbConnected(targetUdid);
                checkNetworkStatus(targetUdid);
                
                await setupAndEnterPOS(driver);
                setupSuccess = true;
            } catch (setupError) {
                setupRetries++;
                log("ERROR", `Initial setup attempt #${setupRetries} failed: ${setupError.message}`);
                
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

                        reconnectAdb(targetUdid);
                        ensureAdbConnected(targetUdid);
                        resetUiAutomator2Server(targetUdid);

                        try {
                            log("ADB", `Force-stopping app via ADB on device: "${targetUdid}"...`);
                            execSync(`adb -s ${targetUdid} shell am force-stop com.parentpay.PointOfService`);
                        } catch (adbError) {
                            log("ADB_WARNING", `ADB force-stop warning: ${adbError.message}`);
                        }

                        try {
                            log("ADB", `Launching app via ADB on device: "${targetUdid}"...`);
                            execSync(`adb -s ${targetUdid} shell am start -n com.parentpay.PointOfService/com.parentpay.PointOfService.MainActivity`);
                        } catch (adbError) {
                            log("ADB_WARNING", `ADB launch warning: ${adbError.message}`);
                        }

                        driver = await createDriverSession(targetUdid, 'startup-crash-recovery');
                    } catch (e) {
                        log("CRITICAL", `Failed to relaunch driver during startup setup recovery: ${e.message}`);
                    }
                } else {
                    if (setupRetries >= 5) {
                        throw setupError;
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
        const runMode = config.mode || "duration";
        const durationMs = (config.durationMins || 5) * 60 * 1000;
        const maxCycles = config.maxCycles || 10;

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

            try {
                // 1. ADB connectivity check (fast - just adb devices)
                ensureAdbConnected(targetUdid);

                // 2. Network + Memory checks only every 10 cycles (avoid blocking ping per cycle)
                if (cycle % 10 === 1) {
                    checkNetworkStatus(targetUdid);
                    const memUsage = getAppMemoryUsage(targetUdid);
                    if (memUsage) {
                        log("MEMORY", `App heap size: ${memUsage.mb} MB (${memUsage.kb} KB)`);
                        const limit = config.maxMemoryLimitMb;
                        if (limit && memUsage.mb > limit) {
                            log("MEMORY_WARNING", `⚠️ Memory limit exceeded! Heap: ${memUsage.mb} MB > Limit: ${limit} MB. Recycling session...`);
                            throw new Error("PROACTIVE_MEM_RECYCLE");
                        }
                    }
                }

                // 3. Proactive App Relaunch Cycle check (timer-based: just log, no restart)
                const proactivelyRelaunchCycleLimit = config.proactiveRelaunchCycles;
                if (proactivelyRelaunchCycleLimit && cycle > 1 && (cycle - 1) % proactivelyRelaunchCycleLimit === 0) {
                    log("CYCLE", `📍 Proactive interval marker at cycle ${cycle} (${proactivelyRelaunchCycleLimit} cycle boundary). Session still healthy, continuing without restart.`);
                }

                // Pick child and product
                const currentChild = childrenList.length > 0
                    ? childrenList[Math.floor(Math.random() * childrenList.length)]
                    : "10Thaprilposfix6";

                const currentProduct = productsList.length > 0
                    ? productsList[Math.floor(Math.random() * productsList.length)]
                    : "test for";

                // Clear popups/alerts
                try {
                    await BasePage.checkForAlertsAndDismiss(driver);
                } catch (e) {}

                // PRE-CYCLE HEALTH CHECK
                try {
                    await driver.getWindowSize();
                } catch (healthErr) {
                    throw new Error(`Health Check failed: Appium session is unresponsive (${healthErr.message})`);
                }

                // 4. TRANSACTION WATCHDOG RACE
                const maxTime = config.maxCycleTimeMs || 60000;
                let watchdogTimerId;

                const watchdogPromise = new Promise((_, reject) => {
                    watchdogTimerId = setTimeout(() => {
                        reject(new Error("WATCHDOG_TIMEOUT"));
                    }, maxTime);
                });

                const transactionPromise = (async () => {
                    const childSelectStart = Date.now();
                    await POSPage.selectChild(driver, currentChild);
                    log("TIMING", `Child "${currentChild}" selected in ${Date.now() - childSelectStart}ms`);

                    const delayAfterChild = config.delayAfterChildMs !== undefined ? config.delayAfterChildMs : 500;
                    await driver.pause(delayAfterChild);

                    const productSelectStart = Date.now();
                    await POSPage.selectProduct(driver, currentProduct);
                    log("TIMING", `Product "${currentProduct}" selected in ${Date.now() - productSelectStart}ms`);

                    const delayAfterProduct = config.delayAfterProductMs !== undefined ? config.delayAfterProductMs : 0;
                    await driver.pause(delayAfterProduct);

                    const walletClickStart = Date.now();
                    await POSPage.clickSelectWallet(driver);
                    log("TIMING", `Wallet checkout opened in ${Date.now() - walletClickStart}ms`);

                    const delayAfterWallet = config.delayAfterWalletMs !== undefined ? config.delayAfterWalletMs : 500;
                    await driver.pause(delayAfterWallet);

                    const payClickStart = Date.now();
                    await CheckoutPage.clickPay(driver);
                    log("TIMING", `Payment completed in ${Date.now() - payClickStart}ms`);

                    const delayAfterPay = config.delayAfterPayMs !== undefined ? config.delayAfterPayMs : 500;
                    await driver.pause(delayAfterPay);
                })();

                // Race the transaction against the watchdog!
                await Promise.race([transactionPromise, watchdogPromise]);
                clearTimeout(watchdogTimerId);

                cycle++;

            } catch (cycleError) {
                // Clear any watchdog timers
                if (cycleError.message !== "WATCHDOG_TIMEOUT") {
                    // Suppress alerts if watchdog fires
                }

                log("ERROR", `Cycle #${cycle} failed: ${cycleError.message}`);

                const errStr = (cycleError.message || "").toLowerCase();
                const isWatchdog = cycleError.message === "WATCHDOG_TIMEOUT";
                const isProactiveMemRecycle = cycleError.message === "PROACTIVE_MEM_RECYCLE";

                const isCrash = isWatchdog || isProactiveMemRecycle ||
                    errStr.includes("instrumentation") ||
                    errStr.includes("crash") ||
                    errStr.includes("session") ||
                    errStr.includes("refuse") ||
                    errStr.includes("connection") ||
                    errStr.includes("socket") ||
                    errStr.includes("terminated") ||
                    errStr.includes("closed") ||
                    errStr.includes("econn") ||
                    errStr.includes("hang up");

                if (isCrash) {
                    const skipScreenshotOnDeadSession = errStr.includes("instrumentation") || errStr.includes("socket") || errStr.includes("session");

                    if (isProactiveMemRecycle) {
                        // Memory limit exceeded: bounce app via Appium commands, reuse existing session
                        log("RELAUNCH", `Memory limit exceeded. Bouncing app via Appium (no session teardown)...`);
                        try {
                            try { await driver.terminateApp('com.parentpay.PointOfService'); } catch (e) { }
                            await driver.pause(1500);
                            await driver.activateApp('com.parentpay.PointOfService');
                            await driver.pause(3000);
                            await setupAndEnterPOS(driver);
                            log("RELAUNCH", "Memory recycle complete. Resuming ordering loop...");
                        } catch (memErr) {
                            log("RELAUNCH_WARNING", `App bounce failed (${memErr.message}), falling back to full session recovery...`);
                            try { await driver.deleteSession(); } catch (e) { }
                            resetUiAutomator2Server(targetUdid);
                            try { execSync(`adb -s ${targetUdid} shell am force-stop com.parentpay.PointOfService`); } catch (e) { }
                            try { execSync(`adb -s ${targetUdid} shell am start -n com.parentpay.PointOfService/com.parentpay.PointOfService.MainActivity`); } catch (e) { }
                            driver = await createDriverSession(targetUdid, 'mem-recycle-fallback');
                            await setupAndEnterPOS(driver);
                        }
                    } else {
                        // FULL CRASH PATH: watchdog / real crash — full session teardown and recreation
                        if (isWatchdog) {
                            log("WATCHDOG", `⚠️ Watchdog fired! Screen has been frozen for more than ${maxTime}ms.`);
                            if (!skipScreenshotOnDeadSession) {
                                await BasePage.saveFailureScreenshot(driver, `watchdog_stuck_cycle_${cycle}`);
                            }
                        } else {
                            if (!skipScreenshotOnDeadSession) {
                                await BasePage.saveFailureScreenshot(driver, `cycle_${cycle}_crash`);
                            }
                        }

                        log("CRASH", "App or UiAutomator2 server crashed / requires full session recovery...");
                        try {
                            try { await driver.deleteSession(); } catch (e) { }

                            reconnectAdb(targetUdid);
                            ensureAdbConnected(targetUdid);
                            resetUiAutomator2Server(targetUdid);

                            try {
                                execSync(`adb -s ${targetUdid} shell am force-stop com.parentpay.PointOfService`);
                            } catch (adbError) { log("ADB_WARNING", `force-stop warning: ${adbError.message}`); }

                            try {
                                execSync(`adb -s ${targetUdid} shell am start -n com.parentpay.PointOfService/com.parentpay.PointOfService.MainActivity`);
                            } catch (adbError) { log("ADB_WARNING", `launch warning: ${adbError.message}`); }

                            log("SETUP", "Relaunching Appium session...");
                            driver = await createDriverSession(targetUdid, 'cycle-crash-recovery');

                            await setupAndEnterPOS(driver);
                            log("SETUP", "Relaunch and State recovery successful! Resuming ordering loop...");
                        } catch (relaunchError) {
                            log("CRITICAL", `Relaunch failed: ${relaunchError.message}`);
                            await sleep(5000);
                        }
                    }
                } else {
                    log("RECOVERY", "Attempting to recover in-session and continue to next cycle...");
                    try {
                        await BasePage.checkForAlertsAndDismiss(driver);
                    } catch (e) {}
                    await driver.pause(5000);
                }
            }
        }

        log("SUCCESS", `Automation Run Complete! Successfully executed ${cycle - 1} cycles`);

    } catch (error) {
        log("FATAL", `Automation failed: ${error.message}`);
    } finally {
        try {
            await driver.deleteSession();
        } catch (e) {
            log("SETUP_WARNING", `Session already closed/unavailable during teardown: ${e.message}`);
        }
        log("SETUP", "Session closed");
    }
}

main();