'use strict';

const { log } = require('./logger');

const stats = {
  cyclesCompleted: 0,
  cyclesFailed: 0,
  popupRecoveries: 0,
  adbReconnects: 0,
  appRestarts: 0,
  sessionRebuilds: 0,
  screenshotsCaptured: 0,
  recoveredFailures: 0,
  fatalFailures: 0,
  failureReasons: {},
  runStartMs: Date.now(),
};

function startRun() {
  stats.runStartMs = Date.now();
}

function increment(counter, value = 1) {
  if (!Object.prototype.hasOwnProperty.call(stats, counter)) return;
  stats[counter] += value;
}

function classifyFailureReason(message = '') {
  const err = String(message).toLowerCase();

  if (err.includes('socket') || err.includes('econn') || err.includes('hang up')) {
    return 'Socket Error';
  }
  if (err.includes('retry') || err.includes('popup') || err.includes('wait')) {
    return 'Retry Popup';
  }
  if (err.includes('pay') || err.includes('payment')) {
    return 'Payment Failure';
  }
  if (err.includes('device') || err.includes('disconnect') || err.includes('offline') || err.includes('adb')) {
    return 'Device Disconnect';
  }
  if (err.includes('crash') || err.includes('session') || err.includes('instrumentation') || err.includes('watchdog')) {
    return 'App Crash';
  }
  return 'Unknown Failure';
}

function recordCycleSuccess() {
  stats.cyclesCompleted += 1;
}

function recordCycleFailure(reason) {
  stats.cyclesFailed += 1;
  const key = reason || 'Unknown Failure';
  stats.failureReasons[key] = (stats.failureReasons[key] || 0) + 1;
}

function markRecoveredFailure() {
  stats.recoveredFailures += 1;
}

function markFatalFailure(reason) {
  stats.fatalFailures += 1;
  const key = reason || 'Fatal Failure';
  stats.failureReasons[key] = (stats.failureReasons[key] || 0) + 1;
}

function pct(part, total) {
  if (!total || total <= 0) return '0.0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function getSummaryData() {
  const attempts = stats.cyclesCompleted + stats.cyclesFailed;
  const durationMs = Date.now() - stats.runStartMs;
  return {
    cyclesCompleted: stats.cyclesCompleted,
    cyclesFailed: stats.cyclesFailed,
    popupRecoveries: stats.popupRecoveries,
    adbReconnects: stats.adbReconnects,
    appRestarts: stats.appRestarts,
    sessionRebuilds: stats.sessionRebuilds,
    screenshotsCaptured: stats.screenshotsCaptured,
    recoveredFailures: stats.recoveredFailures,
    fatalFailures: stats.fatalFailures,
    failureReasons: { ...stats.failureReasons },
    successRate: pct(stats.cyclesCompleted, attempts),
    failureRate: pct(stats.cyclesFailed, attempts),
    recoveryRate: pct(stats.recoveredFailures, stats.cyclesFailed),
    durationMs,
    durationText: formatDuration(durationMs),
    attempts,
  };
}

function printSummary(status = 'SUCCESS') {
  const attempts = stats.cyclesCompleted + stats.cyclesFailed;
  const duration = formatDuration(Date.now() - stats.runStartMs);

  log('STABILITY', '============================================================');
  log('STABILITY', '=== STABILITY REPORT ===');
  log('STABILITY', `Status: ${status}`);
  log('STABILITY', `Cycles Completed: ${stats.cyclesCompleted}`);
  log('STABILITY', `Cycles Failed: ${stats.cyclesFailed}`);
  log('STABILITY', '');
  log('STABILITY', `Success Rate: ${pct(stats.cyclesCompleted, attempts)}`);
  log('STABILITY', `Failure Rate: ${pct(stats.cyclesFailed, attempts)}`);
  log('STABILITY', `Recovery Rate: ${pct(stats.recoveredFailures, stats.cyclesFailed)}`);
  log('STABILITY', '');
  log('STABILITY', `Popup Recoveries: ${stats.popupRecoveries}`);
  log('STABILITY', `ADB Reconnects: ${stats.adbReconnects}`);
  log('STABILITY', `App Restarts: ${stats.appRestarts}`);
  log('STABILITY', `Session Rebuilds: ${stats.sessionRebuilds}`);
  log('STABILITY', `Screenshots Captured: ${stats.screenshotsCaptured}`);
  log('STABILITY', `Fatal Failures: ${stats.fatalFailures}`);
  log('STABILITY', `Execution Time: ${duration}`);

  const reasonEntries = Object.entries(stats.failureReasons);
  if (reasonEntries.length > 0) {
    log('STABILITY', '');
    log('STABILITY', 'Failure Reasons:');
    reasonEntries
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => log('STABILITY', `- ${reason}: ${count}`));
  }

  log('STABILITY', '============================================================');
}

module.exports = {
  startRun,
  increment,
  classifyFailureReason,
  recordCycleSuccess,
  recordCycleFailure,
  markRecoveredFailure,
  markFatalFailure,
  getSummaryData,
  printSummary,
};
