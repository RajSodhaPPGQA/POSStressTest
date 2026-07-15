'use strict';

const fs = require('fs');
const path = require('path');

function pad(v) {
  return String(v).padStart(2, '0');
}

function formatStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
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

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createFunctionalRunArtifacts(baseDir) {
  const rootDir = baseDir || path.join(__dirname, '..', 'reports', 'functional-regression');
  fs.mkdirSync(rootDir, { recursive: true });

  const runId = formatStamp(new Date());
  const runDir = path.join(rootDir, runId);
  const screenshotsDir = path.join(runDir, 'screenshots');
  const diagnosticsDir = path.join(runDir, 'diagnostics');

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(diagnosticsDir, { recursive: true });

  return {
    rootDir,
    runId,
    runDir,
    screenshotsDir,
    diagnosticsDir,
  };
}

function buildHtmlReport(payload) {
  const summary = payload.summary || {};
  const tests = payload.tests || [];

  const rows = tests.map((t) => {
    const status = String(t.status || 'Not Executed');
    const statusClass = status === 'Passed' ? 'pass' : (status === 'Skipped' ? 'skip' : (status === 'Failed' ? 'fail' : 'not-executed'));
    return `<tr>
      <td>${esc(t.id)}</td>
      <td>${esc(t.title)}</td>
      <td class="${statusClass}">${esc(status)}</td>
      <td>${esc(t.startTime || '')}</td>
      <td>${esc(t.endTime || '')}</td>
      <td>${esc(t.durationText || '')}</td>
      <td>${esc(t.expectedResult || '')}</td>
      <td>${esc(t.actualResult || '')}</td>
      <td>${esc(t.failureReason || '')}</td>
      <td>${esc(t.errorDetails || '')}</td>
      <td>${esc(t.failureScreenshotPath || '')}</td>
      <td>${esc(t.diagnosticArtifactPath || '')}</td>
    </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Functional Regression Report</title>
  <style>
    body { font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; margin: 0; background: #f3f4f6; color: #111827; }
    .wrap { max-width: 1280px; margin: 20px auto; padding: 0 16px; }
    .head { background: #0f172a; color: #ffffff; border-radius: 12px; padding: 16px; margin-bottom: 14px; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-bottom: 14px; }
    .kpi { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; }
    .kpi .label { font-size: 12px; color: #6b7280; }
    .kpi .value { font-size: 22px; font-weight: 700; margin-top: 4px; }
    .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 8px 6px; text-align: left; vertical-align: top; }
    th { font-size: 12px; color: #6b7280; }
    .pass { color: #166534; font-weight: 700; }
    .fail { color: #991b1b; font-weight: 700; }
    .skip { color: #92400e; font-weight: 700; }
    .not-executed { color: #1f2937; font-weight: 700; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <h1 style="margin:0 0 4px;">${esc(summary.suiteName || 'Functional Regression')}</h1>
      <div>Start: ${esc(summary.startTime || '')} | End: ${esc(summary.endTime || '')} | Duration: ${esc(summary.totalDuration || '')}</div>
    </div>

    <section class="kpis">
      <div class="kpi"><div class="label">Total</div><div class="value">${esc(summary.total || 0)}</div></div>
      <div class="kpi"><div class="label">Passed</div><div class="value" style="color:#166534;">${esc(summary.passed || 0)}</div></div>
      <div class="kpi"><div class="label">Failed</div><div class="value" style="color:#991b1b;">${esc(summary.failed || 0)}</div></div>
      <div class="kpi"><div class="label">Skipped</div><div class="value" style="color:#92400e;">${esc(summary.skipped || 0)}</div></div>
      <div class="kpi"><div class="label">Not Executed</div><div class="value">${esc(summary.notExecuted || 0)}</div></div>
      <div class="kpi"><div class="label">Pass %</div><div class="value">${esc(summary.passPercentage || '0.0%')}</div></div>
    </section>

    <section class="card">
      <h2 style="margin:0 0 10px;">Test Case Details</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Status</th>
            <th>Start</th>
            <th>End</th>
            <th>Duration</th>
            <th>Expected Result</th>
            <th>Actual Result</th>
            <th>Failure Reason</th>
            <th>Error Details</th>
            <th>Failure Screenshot</th>
            <th>Diagnostic Artifact</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  </div>
</body>
</html>`;
}

function writeFunctionalReport(artifacts, payload) {
  const start = payload.startTime instanceof Date ? payload.startTime : new Date(payload.startTime);
  const end = payload.endTime instanceof Date ? payload.endTime : new Date(payload.endTime);
  const tests = payload.tests || [];

  const total = tests.length;
  const passed = tests.filter((t) => t.status === 'Passed').length;
  const failed = tests.filter((t) => t.status === 'Failed').length;
  const skipped = tests.filter((t) => t.status === 'Skipped').length;
  const notExecuted = tests.filter((t) => t.status === 'Not Executed').length;
  const passPercentage = total > 0 ? `${((passed / total) * 100).toFixed(1)}%` : '0.0%';

  const summary = {
    suiteName: payload.suiteName || 'Functional Regression Suite',
    total,
    passed,
    failed,
    skipped,
    notExecuted,
    passPercentage,
    startTime: formatDateTime(start),
    endTime: formatDateTime(end),
    totalDuration: formatDuration(end.getTime() - start.getTime()),
  };

  const normalizedTests = tests.map((t) => ({
    ...t,
    durationText: formatDuration(t.durationMs || 0),
  }));

  const reportPayload = {
    generatedAt: formatDateTime(new Date()),
    summary,
    tests: normalizedTests,
  };

  const jsonPath = path.join(artifacts.runDir, 'functional_regression_report.json');
  const htmlPath = path.join(artifacts.runDir, 'functional_regression_report.html');

  fs.writeFileSync(jsonPath, JSON.stringify(reportPayload, null, 2), 'utf8');
  fs.writeFileSync(htmlPath, buildHtmlReport(reportPayload), 'utf8');

  return {
    summary,
    jsonPath,
    htmlPath,
  };
}

module.exports = {
  createFunctionalRunArtifacts,
  writeFunctionalReport,
  formatDateTime,
  formatDuration,
};
