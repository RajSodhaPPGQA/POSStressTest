'use strict';

const fs = require('fs');
const path = require('path');

function pad(v) {
  return String(v).padStart(2, '0');
}

function formatTimestamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function formatDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function row(label, value, cls = '') {
  return `<tr><td>${esc(label)}</td><td class="${cls}">${esc(value)}</td></tr>`;
}

function buildHtml(payload) {
  const {
    status,
    startTime,
    endTime,
    metadata,
    performance,
    stability,
    longRun,
  } = payload;

  const bottlenecks = (performance.bottlenecks || [])
    .map((b) => `<li>${esc(b.label)} - ${esc(`${b.ms} ms`)}</li>`)
    .join('');

  const failureReasons = Object.entries(stability.failureReasons || {});
  const failureRows = failureReasons.length
    ? failureReasons.map(([k, v]) => row(k, v)).join('')
    : row('No failures recorded', '-');

  const statusClass = status === 'SUCCESS' ? 'pass' : 'fail';
  const recoveryClass = (stability.recoveredFailures || 0) > 0 ? 'recovery' : '';
  const longRunData = longRun || {};
  const slowdown = longRunData.slowdown || {};
  const memoryLeak = longRunData.memoryLeak || {};
  const recoverySpikes = longRunData.recoverySpikes || {};

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ParentPay POS Automation Report</title>
  <style>
    :root {
      --bg: #f4f6f8;
      --card: #ffffff;
      --text: #1f2937;
      --muted: #6b7280;
      --pass: #15803d;
      --fail: #b91c1c;
      --recovery: #c2410c;
      --border: #e5e7eb;
    }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    .wrap {
      max-width: 1100px;
      margin: 24px auto;
      padding: 0 16px;
    }
    .header {
      background: linear-gradient(135deg, #0f172a, #1e293b);
      color: #fff;
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 18px;
    }
    .pill {
      display: inline-block;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .2px;
    }
    .pass { color: var(--pass); font-weight: 700; }
    .fail { color: var(--fail); font-weight: 700; }
    .recovery { color: var(--recovery); font-weight: 700; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 14px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
    }
    h2 {
      margin: 0 0 10px;
      font-size: 16px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    td {
      padding: 7px 0;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    td:first-child {
      color: var(--muted);
      width: 45%;
      padding-right: 8px;
    }
    ul {
      margin: 6px 0 0 18px;
      padding: 0;
    }
    .footer {
      margin-top: 14px;
      color: var(--muted);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1 style="margin:0 0 6px; font-size:22px;">ParentPay POS Automation Report</h1>
      <div class="pill ${statusClass}">Status: ${esc(status)}</div>
    </div>

    <div class="grid">
      <section class="card">
        <h2>Execution Summary</h2>
        <table>
          ${row('Start Time', formatDateTime(startTime))}
          ${row('End Time', formatDateTime(endTime))}
          ${row('Duration', formatDuration(new Date(endTime) - new Date(startTime)))}
          ${row('Device Name', metadata.deviceName || 'Unknown')}
          ${row('Android Version', metadata.androidVersion || 'Unknown')}
          ${row('Appium Version', metadata.appiumVersion || 'Unknown')}
          ${row('Execution Status', status, statusClass)}
        </table>
      </section>

      <section class="card">
        <h2>Performance Summary</h2>
        <table>
          ${row('Completed Cycles', performance.completedCycles || 0)}
          ${row('Orders Per Minute', performance.ordersPerMinute || 'N/A')}
          ${row('Average Cycle Time', `${performance.averageCycleMs || 0} ms`)}
          ${row('Child Selection Avg', `${performance.phaseAveragesMs?.childSelection || 0} ms`)}
          ${row('Cart Build Avg', `${performance.phaseAveragesMs?.cartBuild || 0} ms`)}
          ${row('Wallet Selection Avg', `${performance.phaseAveragesMs?.walletSelection || 0} ms`)}
          ${row('Payment Avg', `${performance.phaseAveragesMs?.payment || 0} ms`)}
        </table>
        <div style="margin-top:8px; font-size:14px;">
          <strong>Top Bottlenecks</strong>
          <ul>${bottlenecks || '<li>None</li>'}</ul>
        </div>
      </section>

      <section class="card">
        <h2>Stability Summary</h2>
        <table>
          ${row('Cycles Completed', stability.cyclesCompleted || 0)}
          ${row('Cycles Failed', stability.cyclesFailed || 0)}
          ${row('Success Rate', stability.successRate || '0.0%', 'pass')}
          ${row('Failure Rate', stability.failureRate || '0.0%', (stability.cyclesFailed || 0) > 0 ? 'fail' : '')}
          ${row('Recovery Rate', stability.recoveryRate || '0.0%', recoveryClass)}
          ${row('Popup Recoveries', stability.popupRecoveries || 0, (stability.popupRecoveries || 0) > 0 ? 'recovery' : '')}
          ${row('ADB Reconnects', stability.adbReconnects || 0, (stability.adbReconnects || 0) > 0 ? 'recovery' : '')}
          ${row('App Restarts', stability.appRestarts || 0, (stability.appRestarts || 0) > 0 ? 'recovery' : '')}
          ${row('Session Rebuilds', stability.sessionRebuilds || 0, (stability.sessionRebuilds || 0) > 0 ? 'recovery' : '')}
          ${row('Screenshots Captured', stability.screenshotsCaptured || 0)}
        </table>
      </section>

      <section class="card">
        <h2>Failure Summary</h2>
        <table>
          ${row('Fatal Failures', stability.fatalFailures || 0, (stability.fatalFailures || 0) > 0 ? 'fail' : '')}
          ${failureRows}
        </table>
      </section>

      <section class="card">
        <h2>Long Run Analytics</h2>
        <table>
          ${row('Cycles Tracked', longRunData.totalCyclesTracked || 0)}
          ${row('Cycle Duration Trend', slowdown.detected ? 'Slowdown Detected' : 'Stable', slowdown.detected ? 'fail' : 'pass')}
          ${row('Cycle 1 -> Last', `${slowdown.firstCycleSeconds || 0}s -> ${slowdown.lastCycleSeconds || 0}s`)}
          ${row('Slowdown Percent', `${slowdown.slowdownPercent || 0}%`, slowdown.detected ? 'fail' : 'pass')}
          ${row('Memory Leak Indicator', memoryLeak.detected ? 'Detected' : 'Not Detected', memoryLeak.detected ? 'fail' : 'pass')}
          ${row('Memory Net Increase', `${memoryLeak.netIncreaseMb || 0} MB`, memoryLeak.detected ? 'fail' : '')}
          ${row('Recovery Spikes', recoverySpikes.detected ? 'Detected' : 'Not Detected', recoverySpikes.detected ? 'recovery' : 'pass')}
          ${row('Recovery Count', recoverySpikes.totalRecoveries || 0, (recoverySpikes.totalRecoveries || 0) > 0 ? 'recovery' : '')}
        </table>
      </section>
    </div>

    <div class="footer">Generated by ParentPay POS Automation Framework</div>
  </div>
</body>
</html>`;
}

function generateReport(payload) {
  const reportsDir = path.join(__dirname, '..', 'Analytics', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const stamp = formatTimestamp(new Date());
  const fileName = `report_${stamp}.html`;
  const fullPath = path.join(reportsDir, fileName);
  const html = buildHtml(payload);
  fs.writeFileSync(fullPath, html, 'utf8');
  return fullPath;
}

module.exports = { generateReport };
