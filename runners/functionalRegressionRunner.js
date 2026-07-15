'use strict';

const path = require('path');
const { initLogger, log } = require('../utils/logger');
const { FunctionalAssertionError } = require('../tests/regression/assertions/assertions');
const {
  config,
  checkAppiumHealth,
  getDeviceUdid,
  createDriverSession,
  ensureAdbConnected,
  launchOrActivateApp,
  waitForKnownState,
  ensureAtChildSelection,
  ensureSessionHealthy,
  getConfiguredChild,
  getConfiguredProduct,
  captureFailureArtifacts,
} = require('../tests/regression/helpers/regressionContext');
const {
  createFunctionalRunArtifacts,
  writeFunctionalReport,
  formatDateTime,
} = require('../utils/functionalRegressionReport');

const fr001 = require('../tests/regression/cases/fr001LaunchValidState');
const fr002 = require('../tests/regression/cases/fr002PosNavigationChildSelection');
const fr003 = require('../tests/regression/cases/fr003BasicDefaultWalletOrder');

function classifyFailure(error) {
  const msg = (error && error.message ? error.message : '').toLowerCase();

  if (error instanceof FunctionalAssertionError) {
    return 'Functional assertion failure';
  }

  if (msg.includes('precondition') || msg.includes('configured') || msg.includes('missing') || msg.includes('config.json')) {
    return 'Test-data/precondition issue';
  }

  if (msg.includes('session') || msg.includes('instrumentation') || msg.includes('appium') || msg.includes('socket') || msg.includes('econn')) {
    return 'Appium/session failure';
  }

  if (msg.includes('adb') || msg.includes('offline') || msg.includes('disconnect') || msg.includes('unauthorized')) {
    return 'Device/connectivity failure';
  }

  if (msg.includes('selector') || msg.includes('element') || msg.includes('not found')) {
    return 'Automation locator failure';
  }

  return 'Application defect';
}

async function runCase(definition, context) {
  const start = new Date();

  const result = {
    id: definition.id,
    title: definition.title,
    status: 'Not Executed',
    startTime: formatDateTime(start),
    endTime: '',
    durationMs: 0,
    expectedResult: definition.expectedResult,
    actualResult: '',
    failureReason: '',
    errorDetails: '',
    failureScreenshotPath: '',
    diagnosticArtifactPath: '',
  };

  try {
    await ensureSessionHealthy(context.driver);
  } catch (_e) {
    try {
      if (context.driver) {
        await context.driver.deleteSession();
      }
    } catch (_ignored) {
      // ignore teardown warning
    }

    context.driver = await createDriverSession(context.targetUdid, `recovery-before-${definition.id}`);
  }

  try {
    const caseResult = await definition.run(context);
    result.status = 'Passed';
    result.actualResult = caseResult.actualResult || 'Expected business outcome validated successfully.';
  } catch (error) {
    const artifacts = await captureFailureArtifacts(context.driver, context.artifacts, definition.id);
    result.status = 'Failed';
    result.failureReason = classifyFailure(error);
    result.actualResult = error.actual || error.message || 'Unexpected failure occurred.';
    result.errorDetails = error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : String(error);
    result.failureScreenshotPath = artifacts.screenshotPath;
    result.diagnosticArtifactPath = artifacts.sourcePath;

    log('ERROR', `${definition.id} failed: ${error.message}`);
  }

  const end = new Date();
  result.endTime = formatDateTime(end);
  result.durationMs = end.getTime() - start.getTime();
  return result;
}

async function main() {
  const artifacts = createFunctionalRunArtifacts();
  initLogger(artifacts.runDir);
  log('SETUP', `Functional regression run directory: ${artifacts.runDir}`);

  const suiteStart = new Date();
  const allCases = [fr001, fr002, fr003];
  const requestedCaseIds = String(process.env.FR_CASES || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const cases = requestedCaseIds.length > 0
    ? allCases.filter((c) => requestedCaseIds.includes(c.id))
    : allCases;

  if (cases.length === 0) {
    throw new Error(`No functional cases selected. Requested IDs: ${requestedCaseIds.join(', ')}`);
  }
  const results = [];

  let driver;
  let targetUdid = '';

  try {
    await checkAppiumHealth();

    targetUdid = getDeviceUdid();
    const adbOk = ensureAdbConnected(targetUdid);
    if (!adbOk) {
      throw new Error(`ADB device ${targetUdid} is not connected.`);
    }

    driver = await createDriverSession(targetUdid, 'functional-regression-startup');

    const context = {
      driver,
      targetUdid,
      config,
      artifacts,
      launchOrActivateApp,
      waitForKnownState,
      ensureAtChildSelection,
      ensureSessionHealthy,
      getConfiguredChild,
      getConfiguredProduct,
    };

    for (const definition of cases) {
      log('CYCLE', `Running ${definition.id}: ${definition.title}`);
      const caseResult = await runCase(definition, context);
      results.push(caseResult);
      context.driver = context.driver || driver;
    }

    driver = context.driver;
  } catch (fatalError) {
    log('FATAL', `Functional regression setup failure: ${fatalError.message}`);

    for (const definition of cases) {
      if (!results.some((r) => r.id === definition.id)) {
        const now = new Date();
        results.push({
          id: definition.id,
          title: definition.title,
          status: 'Skipped',
          startTime: formatDateTime(now),
          endTime: formatDateTime(now),
          durationMs: 0,
          expectedResult: definition.expectedResult,
          actualResult: 'Skipped due to unmet prerequisite before case execution.',
          failureReason: 'Skipped test due to unmet prerequisite',
          errorDetails: fatalError.message,
          failureScreenshotPath: '',
          diagnosticArtifactPath: '',
        });
      }
    }
  } finally {
    if (driver) {
      try {
        await driver.deleteSession();
      } catch (e) {
        log('SETUP_WARNING', `Session teardown warning: ${e.message}`);
      }
    }
  }

  const suiteEnd = new Date();
  const report = writeFunctionalReport(artifacts, {
    suiteName: 'ParentPay POS Functional Regression',
    startTime: suiteStart,
    endTime: suiteEnd,
    tests: results,
  });

  log('REPORT', `Functional regression HTML report: ${report.htmlPath}`);
  log('REPORT', `Functional regression JSON report: ${report.jsonPath}`);

  const failed = results.filter((r) => r.status === 'Failed').length;
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
