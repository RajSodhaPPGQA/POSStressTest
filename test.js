const { remote } = require('webdriverio');
const config = require('./config.json');
const { execSync, exec } = require('child_process');
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
const { log, initLogger } = require('./utils/logger');
const { initRunArtifacts } = require('./utils/runArtifacts');
const { reconnectAdb, ensureAdbConnected, checkNetworkStatus, getAppMemoryUsage, resetUiAutomator2Server } = require('./utils/adb');
const { generateCart } = require('./utils/cartGenerator');
const perf = require('./utils/perfMetrics');
const stability = require('./utils/stabilityMetrics');
const { generateReport } = require('./utils/htmlReport');
const { generateExcelReport } = require('./utils/excelReport');
const { createLongRunAnalytics } = require('./utils/longRunAnalytics');
const { startLiveDashboard } = require('./utils/liveDashboard');

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

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
}

function openDashboardInBrowser(url) {
    try {
        if (process.platform === 'win32') {
            exec(`start "" "${url}"`);
        } else if (process.platform === 'darwin') {
            exec(`open "${url}"`);
        } else {
            exec(`xdg-open "${url}"`);
        }
    } catch (_e) {
        // Best-effort only; dashboard remains reachable by URL even if auto-open fails.
    }
}

function isUnattendedMode() {
    // Explicit opt-in keeps default local interactive behavior unchanged.
    return config.unattended === true || process.env.CI === 'true';
}

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
            if (reason !== 'initial') {
                stability.increment('sessionRebuilds');
            }
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

    // If config.udid exists but not connected, try adb connect
    if (config.udid) {
        log("SETUP", `Configured UDID found in config.json: "${config.udid}"`);
        if (devices.includes(config.udid)) {
            log("SETUP", `Device is currently connected! Auto-selecting it.`);
            return config.udid;
        } else {
            // Try adb connect if looks like IP:PORT
            const ipPattern = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})$/;
            if (ipPattern.test(config.udid)) {
                log("SETUP", `Device not connected, attempting 'adb connect' to ${config.udid}...`);
                try {
                    execSync(`adb connect ${config.udid}`);
                    // Recheck devices
                    const output2 = execSync('adb devices').toString();
                    const lines2 = output2.trim().split('\n');
                    for (let i = 1; i < lines2.length; i++) {
                        const line = lines2[i].trim();
                        if (line) {
                            const parts = line.split(/\s+/);
                            if (parts[1] === 'device') {
                                devices.push(parts[0]);
                            }
                        }
                    }
                    if (devices.includes(config.udid)) {
                        log("SETUP", `Device connected via adb connect!`);
                        return config.udid;
                    }
                } catch (e) {
                    log("SETUP_WARNING", `adb connect failed: ${e.message}`);
                }
            }
        }
    }

    if (devices.length === 1) {
        log("SETUP", `Auto-detected only one connected device: "${devices[0]}". Connecting...`);
        return devices[0];
    }

    if (devices.length === 0) {
        throw new Error("No Android device detected via ADB. Please connect a device (USB or wireless) and try again.");
    }

    // Multiple devices: prompt user (unless unattended mode is enabled)
    if (isUnattendedMode()) {
        throw new Error('Multiple ADB devices detected in unattended mode. Set a single valid udid in config.json.');
    }

    // Multiple devices: prompt user
    console.log("\n--- ADB Device Selection ---");
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
    await driver.pause(8000); // let page fully load after crash recovery / cold start

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
                await driver.pause(6000); // give loading/splash screen more time to resolve
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

            // Capture screenshot so we can see what unknown screen the app is on
            try {
                await BasePage.saveFailureScreenshot(driver, 'unknown_state');
            } catch (ssErr) {
                log("STATE_WARN", `Failed to capture screenshot: ${ssErr.message}`);
            }
            const targetUdid = driver.capabilities.udid;
            try {
                execSync(`adb -s ${targetUdid} shell am force-stop com.parentpay.PointOfService`);
                execSync(`adb -s ${targetUdid} shell am start -n com.parentpay.PointOfService/com.parentpay.PointOfService.MainActivity`);
                stability.increment('appRestarts');
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

// Cart generation is handled by utils/cartGenerator.js
// Supports: cartProducts (explicit), products (random qty/random cart), productName (legacy)

async function main() {
    const runDir = initRunArtifacts();
    initLogger(runDir);
    log("SETUP", `Run output directory: ${runDir}`);

    stability.startRun();
    const executionStart = new Date();
    let runStatus = 'SUCCESS';
    let targetUdid = '';
    let driver;
    let dashboard = null;
    const cycleRows = [];
    const longRun = createLongRunAnalytics();
    const executionMeta = {
        deviceName: 'Unknown',
        androidVersion: 'Unknown',
        appiumVersion: 'Unknown'
    };

    try {
        executionMeta.appiumVersion = execSync('appium --version').toString().trim();
    } catch (e) {}

    try {
        if (config.liveDashboardEnabled !== false) {
            const dashPort = config.liveDashboardPort || 5050;
            dashboard = await startLiveDashboard({ port: dashPort });
            log("DASHBOARD", `Live dashboard started: ${dashboard.url}`);
            if (config.liveDashboardAutoOpen !== false) {
                openDashboardInBrowser(dashboard.url);
                log("DASHBOARD", `Auto-open requested for dashboard URL: ${dashboard.url}`);
            }
        }
    } catch (e) {
        log("DASHBOARD_WARNING", `Live dashboard disabled due to startup issue: ${e.message}`);
    }

    const addDashboardEvent = (type, message) => {
        if (!dashboard) return;
        dashboard.addEvent(type, message);
    };

    const updateDashboardMetrics = (currentCycle) => {
        if (!dashboard) return;
        const s = stability.getSummaryData();
        const perfSummary = perf.getSummaryData();
        const elapsedMs = Date.now() - executionStart.getTime();
        const elapsedMin = elapsedMs / 60000;
        const startupInclusiveOpm = elapsedMin > 0 ? (s.cyclesCompleted / elapsedMin).toFixed(1) : '0.0';
        const opm = perfSummary.ordersPerMinute && perfSummary.ordersPerMinute !== 'N/A'
            ? perfSummary.ordersPerMinute
            : startupInclusiveOpm;
        const runMode = config.mode || 'duration';
        const targetDurationMs = (config.durationMins || 5) * 60 * 1000;
        const elapsedText = formatDuration(elapsedMs);
        const totalText = runMode === 'duration'
            ? formatDuration(targetDurationMs)
            : `${config.maxCycles || 10} cycles`;
        const remainingText = runMode === 'duration'
            ? formatDuration(Math.max(0, targetDurationMs - elapsedMs))
            : 'N/A';
        dashboard.updateMetrics({
            currentCycle,
            ordersPerMinute: opm,
            successRate: s.successRate,
            recoveries: s.recoveredFailures,
            reconnects: s.adbReconnects,
            elapsedText,
            totalText,
            remainingText,
            runStatus,
        });
    };

    log("SETUP", "Checking Appium server health at http://127.0.0.1:4723/status ...");
    try {
        await checkAppiumHealth();
        log("SETUP", "Appium server is healthy and ready.");
    } catch (e) {
        log("FATAL", `Appium server health check failed: ${e.message}`);
        runStatus = 'FAILED';
        addDashboardEvent('FATAL', `Appium health check failed: ${e.message}`);
        updateDashboardMetrics(0);
        stability.markFatalFailure(stability.classifyFailureReason(e.message));
        stability.printSummary('FAILED');
        longRun.printSummary();
        try {
            const perfSummary = perf.getSummaryData();
            const stabilitySummary = stability.getSummaryData();
            const longRunSummary = longRun.getSummaryData();
            const reportPath = generateReport({
                status: runStatus,
                startTime: executionStart,
                endTime: new Date(),
                metadata: executionMeta,
                performance: perfSummary,
                stability: stabilitySummary,
                longRun: longRunSummary,
            });
            log("REPORT", `HTML report generated: ${reportPath}`);

            const excelPath = await generateExcelReport({
                cycleRows,
                summary: {
                    successRate: stabilitySummary.successRate,
                    failureRate: stabilitySummary.failureRate,
                    ordersPerMinute: perfSummary.ordersPerMinute,
                    recoveries: stabilitySummary.recoveredFailures,
                    reconnects: stabilitySummary.adbReconnects,
                    longRun: {
                        slowdownDetected: longRunSummary.slowdown?.detected,
                        slowdownPercent: longRunSummary.slowdown?.slowdownPercent,
                        memoryLeakDetected: longRunSummary.memoryLeak?.detected,
                        recoverySpikesDetected: longRunSummary.recoverySpikes?.detected,
                    },
                },
            });
            log("REPORT", `Excel report generated: ${excelPath}`);
        } catch (reportErr) {
            log("REPORT_WARNING", `Failed to generate report output: ${reportErr.message}`);
        }
        if (dashboard) {
            try {
                await dashboard.close();
                log("DASHBOARD", "Live dashboard stopped");
            } catch (e2) {
                log("DASHBOARD_WARNING", `Dashboard stop warning: ${e2.message}`);
            }
        }
        return;
    }
    // Proactively check wireless ADB reconnection
    if (config.udid) {
        if (reconnectAdb(config.udid)) {
            addDashboardEvent('ADB', 'ADB reconnect successful');
        }
    }

    targetUdid = await getDeviceUdid();

    try {
        executionMeta.deviceName = execSync(`adb -s ${targetUdid} shell getprop ro.product.model`).toString().trim() || 'Unknown';
        executionMeta.androidVersion = execSync(`adb -s ${targetUdid} shell getprop ro.build.version.release`).toString().trim() || 'Unknown';
    } catch (e) {}

    // Ensure connection state is stable before starting Appium session
    const adbConnectedAtStart = ensureAdbConnected(targetUdid);
    if (!adbConnectedAtStart) {
        throw new Error(`ADB device "${targetUdid}" is not connected or offline before session start.`);
    }
    const networkOnlineAtStart = checkNetworkStatus(targetUdid);
    if (!networkOnlineAtStart) {
        log("NETWORK_WARNING", "Device network check failed before session start. Continuing with recovery-capable flow.");
    }
    log("HEALTH", JSON.stringify({
        stage: 'pre-session',
        unattended: isUnattendedMode(),
        runMode: config.mode || 'duration',
        durationMins: config.durationMins || 5,
        maxCycles: config.maxCycles || 10,
        framework: config.framework || 'maui',
        udid: targetUdid,
        adbConnected: adbConnectedAtStart,
        networkOnline: networkOnlineAtStart,
    }));

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

    driver = await createDriverSession(targetUdid, 'initial');
    addDashboardEvent('SESSION', 'Initial session created');
    updateDashboardMetrics(0);

    try {
        let setupSuccess = false;
        let setupRetries = 0;

        while (!setupSuccess && setupRetries < 5) {
            try {
                // Ensure ADB and network are up before attempting setup
                if (!ensureAdbConnected(targetUdid)) {
                    throw new Error(`ADB device "${targetUdid}" is not connected during setup.`);
                }
                if (!checkNetworkStatus(targetUdid)) {
                    log("NETWORK_WARNING", "Network check failed during setup. Continuing setup attempt.");
                }
                
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

                        if (reconnectAdb(targetUdid)) {
                            addDashboardEvent('ADB', 'ADB reconnect successful');
                        }
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
                            stability.increment('appRestarts');
                        } catch (adbError) {
                            log("ADB_WARNING", `ADB launch warning: ${adbError.message}`);
                        }

                        driver = await createDriverSession(targetUdid, 'startup-crash-recovery');
                        addDashboardEvent('SESSION', 'Session recreated (startup recovery)');
                    } catch (e) {
                        log("CRITICAL", `Failed to relaunch driver during startup setup recovery: ${e.message}`);
                        addDashboardEvent('CRITICAL', `Startup recovery failed: ${e.message}`);
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
        const networkAndMemoryCheckEveryNCycles = Math.max(1, Number(config.networkAndMemoryCheckEveryNCycles || 10));
        const driverHealthCheckEveryNCycles = Math.max(1, Number(config.driverHealthCheckEveryNCycles || 1));

        const parseConfigList = (value) => {
            if (!value) return [];
            return value.toString().split(',').map(s => s.trim()).filter(s => s.length > 0);
        };

        const childrenList = parseConfigList(config.childName || "10Thaprilposfix6");

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
            const cycleAttemptStart = Date.now();
            let watchdogTimerId = null;
            updateDashboardMetrics(cycle);
            if (runMode === "cycles") {
                log("CYCLE", `Starting Cycle #${cycle} of ${maxCycles}`);
            } else {
                log("CYCLE", `Starting Cycle #${cycle} (Elapsed: ${elapsedMins} mins, Target: ${config.durationMins} mins)`);
            }

            try {
                // 1. ADB connectivity check (fast - just adb devices)
                if (!ensureAdbConnected(targetUdid)) {
                    throw new Error(`ADB device "${targetUdid}" disconnected during cycle.`);
                }

                // 2. Network + Memory checks at configured cadence (avoid blocking ping per cycle)
                if ((cycle - 1) % networkAndMemoryCheckEveryNCycles === 0) {
                    checkNetworkStatus(targetUdid);
                    const memUsage = getAppMemoryUsage(targetUdid);
                    if (memUsage) {
                        longRun.recordMemory(cycle, memUsage.mb);
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

                const cartItems = generateCart(config);

                // Clear popups/alerts
                try {
                    await BasePage.checkForAlertsAndDismiss(driver);
                } catch (e) {}

                // PRE-CYCLE HEALTH CHECK (configurable cadence)
                if ((cycle - 1) % driverHealthCheckEveryNCycles === 0) {
                    try {
                        await driver.getWindowSize();
                    } catch (healthErr) {
                        throw new Error(`Health Check failed: Appium session is unresponsive (${healthErr.message})`);
                    }
                }

                // 4. TRANSACTION WATCHDOG RACE
                const maxTime = config.maxCycleTimeMs || 60000;

                const watchdogPromise = new Promise((_, reject) => {
                    watchdogTimerId = setTimeout(() => {
                        reject(new Error("WATCHDOG_TIMEOUT"));
                    }, maxTime);
                });

                const transactionPromise = (async () => {
                    const cycleStart = Date.now();
                    perf.startCycle();

                    const childSelectStart = Date.now();
                    await POSPage.selectChild(driver, currentChild);
                    perf.record(perf.PHASES.CHILD_SELECTION, Date.now() - childSelectStart);

                    const delayAfterChild = config.delayAfterChildMs !== undefined ? config.delayAfterChildMs : 500;
                    await driver.pause(delayAfterChild);

                    const productSelectStart = Date.now();
                    await POSPage.addProductsToCart(driver, cartItems);
                    const cartLabel = cartItems.map(i => `${i.name}x${i.qty}`).join(', ');
                    perf.record(perf.PHASES.CART_BUILD, Date.now() - productSelectStart);

                    const delayAfterProduct = config.delayAfterProductMs !== undefined ? config.delayAfterProductMs : 0;
                    await driver.pause(delayAfterProduct);

                    const walletClickStart = Date.now();
                    await POSPage.clickSelectWallet(driver);
                    perf.record(perf.PHASES.WALLET_SELECTION, Date.now() - walletClickStart);

                    const delayAfterWallet = config.delayAfterWalletMs !== undefined ? config.delayAfterWalletMs : 500;
                    await driver.pause(delayAfterWallet);

                    const payClickStart = Date.now();
                    await CheckoutPage.clickPay(driver);
                    perf.record(perf.PHASES.PAYMENT, Date.now() - payClickStart);

                    const delayAfterPay = config.delayAfterPayMs !== undefined ? config.delayAfterPayMs : 500;
                    await driver.pause(delayAfterPay);

                    perf.endCycle(Date.now() - cycleStart);
                })();

                // Race the transaction against the watchdog!
                await Promise.race([transactionPromise, watchdogPromise]);
                clearTimeout(watchdogTimerId);

                stability.recordCycleSuccess();
                longRun.recordCycleDuration(cycle, Date.now() - cycleAttemptStart);
                cycleRows.push({
                    cycle,
                    status: 'PASS',
                    durationMs: Date.now() - cycleAttemptStart,
                    recovery: 'No',
                });
                addDashboardEvent('CYCLE', `Cycle ${cycle} completed successfully`);
                perf.logRollingOPM(cycle);
                cycle++;
                updateDashboardMetrics(cycle);

            } catch (cycleError) {
                if (watchdogTimerId) {
                    clearTimeout(watchdogTimerId);
                }
                perf.cancelCycle(); // discard incomplete cycle from metrics
                stability.recordCycleFailure(stability.classifyFailureReason(cycleError.message));
                // Clear any watchdog timers
                if (cycleError.message !== "WATCHDOG_TIMEOUT") {
                    // Suppress alerts if watchdog fires
                }

                log("ERROR", `Cycle #${cycle} failed: ${cycleError.message}`);
                addDashboardEvent('ERROR', `Cycle ${cycle} failed: ${cycleError.message}`);

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
                    let recoverySucceeded = true;
                    let recoveredThisCycle = false;
                    const skipScreenshotOnDeadSession = errStr.includes("instrumentation") || errStr.includes("socket") || errStr.includes("session");

                    if (isProactiveMemRecycle) {
                        // Memory limit exceeded: bounce app via Appium commands, reuse existing session
                        log("RELAUNCH", `Memory limit exceeded. Bouncing app via Appium (no session teardown)...`);
                        try {
                            try { await driver.terminateApp('com.parentpay.PointOfService'); } catch (e) { }
                            await driver.pause(1500);
                            await driver.activateApp('com.parentpay.PointOfService');
                            stability.increment('appRestarts');
                            await driver.pause(3000);
                            await setupAndEnterPOS(driver);
                            log("RELAUNCH", "Memory recycle complete. Resuming ordering loop...");
                        } catch (memErr) {
                            log("RELAUNCH_WARNING", `App bounce failed (${memErr.message}), falling back to full session recovery...`);
                            try { await driver.deleteSession(); } catch (e) { }
                            resetUiAutomator2Server(targetUdid);
                            try { execSync(`adb -s ${targetUdid} shell am force-stop com.parentpay.PointOfService`); } catch (e) { }
                            try {
                                execSync(`adb -s ${targetUdid} shell am start -n com.parentpay.PointOfService/com.parentpay.PointOfService.MainActivity`);
                                stability.increment('appRestarts');
                            } catch (e) { }
                            try {
                                driver = await createDriverSession(targetUdid, 'mem-recycle-fallback');
                                await setupAndEnterPOS(driver);
                                addDashboardEvent('SESSION', 'Session recreated (mem fallback)');
                            } catch (fallbackErr) {
                                recoverySucceeded = false;
                                log("CRITICAL", `Memory recycle fallback failed: ${fallbackErr.message}`);
                                addDashboardEvent('CRITICAL', `Memory fallback failed: ${fallbackErr.message}`);
                            }
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

                            if (reconnectAdb(targetUdid)) {
                                addDashboardEvent('ADB', 'ADB reconnect successful');
                            }
                            ensureAdbConnected(targetUdid);
                            resetUiAutomator2Server(targetUdid);

                            try {
                                execSync(`adb -s ${targetUdid} shell am force-stop com.parentpay.PointOfService`);
                            } catch (adbError) { log("ADB_WARNING", `force-stop warning: ${adbError.message}`); }

                            try {
                                execSync(`adb -s ${targetUdid} shell am start -n com.parentpay.PointOfService/com.parentpay.PointOfService.MainActivity`);
                                stability.increment('appRestarts');
                            } catch (adbError) { log("ADB_WARNING", `launch warning: ${adbError.message}`); }

                            // Wait for the device to fully stabilise before creating the new session.
                            // Without this delay, Appium can fail to connect immediately after a UiAutomator2 crash.
                            log("SETUP", "Waiting 8s for device to stabilise before relaunching session...");
                            await sleep(8000);
                            log("SETUP", "Relaunching Appium session...");
                            driver = await createDriverSession(targetUdid, 'cycle-crash-recovery');
                            addDashboardEvent('SESSION', 'Session recreated');

                            await setupAndEnterPOS(driver);
                            log("SETUP", "Relaunch and State recovery successful! Resuming ordering loop...");
                            addDashboardEvent('RECOVERY', 'Crash recovery successful');
                        } catch (relaunchError) {
                            recoverySucceeded = false;
                            log("CRITICAL", `Relaunch failed: ${relaunchError.message}`);
                            addDashboardEvent('CRITICAL', `Relaunch failed: ${relaunchError.message}`);
                            await sleep(5000);
                        }
                    }
                    if (recoverySucceeded) {
                        recoveredThisCycle = true;
                        longRun.recordRecovery(cycle);
                        stability.markRecoveredFailure();
                        addDashboardEvent('RECOVERY', 'Cycle recovered and resumed');
                    }
                    longRun.recordCycleDuration(cycle, Date.now() - cycleAttemptStart);
                    cycleRows.push({
                        cycle,
                        status: 'FAIL',
                        durationMs: Date.now() - cycleAttemptStart,
                        recovery: recoveredThisCycle ? 'Yes' : 'No',
                    });
                    updateDashboardMetrics(cycle);
                } else {
                    log("RECOVERY", "Attempting to recover in-session and continue to next cycle...");
                    try {
                        const popupRecovered = await BasePage.checkForAlertsAndDismiss(driver);
                        if (popupRecovered) {
                            addDashboardEvent('RECOVERY', 'Socket popup recovered');
                        }
                    } catch (e) {}
                    await driver.pause(5000);
                    longRun.recordRecovery(cycle);
                    longRun.recordCycleDuration(cycle, Date.now() - cycleAttemptStart);
                    stability.markRecoveredFailure();
                    cycleRows.push({
                        cycle,
                        status: 'FAIL',
                        durationMs: Date.now() - cycleAttemptStart,
                        recovery: 'Yes',
                    });
                    updateDashboardMetrics(cycle);
                }
            }
        }

        log("SUCCESS", `Automation Run Complete! Successfully executed ${cycle - 1} cycles`);
        runStatus = 'SUCCESS';
        perf.printSummary();
        stability.printSummary('SUCCESS');
        longRun.printSummary();
        addDashboardEvent('SUCCESS', `Run complete. Executed ${cycle - 1} cycles`);
        updateDashboardMetrics(cycle - 1);

    } catch (error) {
        log("FATAL", `Automation failed: ${error.message}`);
        runStatus = 'FAILED';
        stability.markFatalFailure(stability.classifyFailureReason(error.message));
        stability.printSummary('FAILED');
        longRun.printSummary();
        addDashboardEvent('FATAL', error.message);
        updateDashboardMetrics(0);
    } finally {
        try {
            if (driver) {
                await driver.deleteSession();
            }
        } catch (e) {
            log("SETUP_WARNING", `Session already closed/unavailable during teardown: ${e.message}`);
        }

        try {
            const perfSummary = perf.getSummaryData();
            const stabilitySummary = stability.getSummaryData();
            const longRunSummary = longRun.getSummaryData();
            const reportPath = generateReport({
                status: runStatus,
                startTime: executionStart,
                endTime: new Date(),
                metadata: executionMeta,
                performance: perfSummary,
                stability: stabilitySummary,
                longRun: longRunSummary,
            });
            log("REPORT", `HTML report generated: ${reportPath}`);

            const excelPath = await generateExcelReport({
                cycleRows,
                summary: {
                    successRate: stabilitySummary.successRate,
                    failureRate: stabilitySummary.failureRate,
                    ordersPerMinute: perfSummary.ordersPerMinute,
                    recoveries: stabilitySummary.recoveredFailures,
                    reconnects: stabilitySummary.adbReconnects,
                    longRun: {
                        slowdownDetected: longRunSummary.slowdown?.detected,
                        slowdownPercent: longRunSummary.slowdown?.slowdownPercent,
                        memoryLeakDetected: longRunSummary.memoryLeak?.detected,
                        recoverySpikesDetected: longRunSummary.recoverySpikes?.detected,
                    },
                },
            });
            log("REPORT", `Excel report generated: ${excelPath}`);
        } catch (reportErr) {
            log("REPORT_WARNING", `Failed to generate report output: ${reportErr.message}`);
        }

        if (dashboard) {
            try {
                await dashboard.close();
                log("DASHBOARD", "Live dashboard stopped");
            } catch (e) {
                log("DASHBOARD_WARNING", `Dashboard stop warning: ${e.message}`);
            }
        }

        log("SETUP", "Session closed");
    }
}

main();