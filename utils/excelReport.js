'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

async function generateExcelReport(payload) {
  const { cycleRows = [], summary = {} } = payload || {};
  const reportsDir = path.join(__dirname, '..', 'Analytics', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const outPath = path.join(reportsDir, 'report.xlsx');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ParentPay POS Automation';
  workbook.created = new Date();

  const cyclesSheet = workbook.addWorksheet('Cycles');
  cyclesSheet.columns = [
    { header: 'Cycle', key: 'cycle', width: 10 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Duration', key: 'duration', width: 14 },
    { header: 'Recovery', key: 'recovery', width: 14 },
  ];

  const headerFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F2937' },
  };

  cyclesSheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = headerFill;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  for (const row of cycleRows) {
    const rec = cyclesSheet.addRow({
      cycle: row.cycle,
      status: row.status,
      duration: `${row.durationMs} ms`,
      recovery: row.recovery,
    });

    const statusCell = rec.getCell(2);
    const recoveryCell = rec.getCell(4);

    if (String(row.status).toUpperCase() === 'PASS') {
      statusCell.font = { color: { argb: 'FF15803D' }, bold: true };
    } else {
      statusCell.font = { color: { argb: 'FFB91C1C' }, bold: true };
    }

    if (String(row.recovery).toUpperCase() === 'YES') {
      recoveryCell.font = { color: { argb: 'FFC2410C' }, bold: true };
    }
  }

  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 28 },
    { header: 'Value', key: 'value', width: 24 },
  ];

  summarySheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = headerFill;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const summaryRows = [
    { metric: 'Success Rate', value: summary.successRate || '0.0%' },
    { metric: 'Failure Rate', value: summary.failureRate || '0.0%' },
    { metric: 'Orders Per Minute', value: summary.ordersPerMinute || 'N/A' },
    { metric: 'Recoveries', value: summary.recoveries || 0 },
    { metric: 'Reconnects', value: summary.reconnects || 0 },
    { metric: 'Slowdown Detected', value: summary.longRun?.slowdownDetected ? 'Yes' : 'No' },
    { metric: 'Slowdown Percent', value: `${summary.longRun?.slowdownPercent ?? 0}%` },
    { metric: 'Memory Leak Indicator', value: summary.longRun?.memoryLeakDetected ? 'Yes' : 'No' },
    { metric: 'Recovery Spikes', value: summary.longRun?.recoverySpikesDetected ? 'Yes' : 'No' },
  ];

  summaryRows.forEach((r) => summarySheet.addRow(r));

  for (let i = 2; i <= summarySheet.rowCount; i++) {
    const metric = String(summarySheet.getRow(i).getCell(1).value || '');
    const valueCell = summarySheet.getRow(i).getCell(2);
    if (metric === 'Success Rate') {
      valueCell.font = { color: { argb: 'FF15803D' }, bold: true };
    }
    if (metric === 'Failure Rate') {
      valueCell.font = { color: { argb: 'FFB91C1C' }, bold: true };
    }
    if (metric === 'Recoveries') {
      valueCell.font = { color: { argb: 'FFC2410C' }, bold: true };
    }
    if (metric === 'Slowdown Detected' || metric === 'Memory Leak Indicator') {
      const isYes = String(valueCell.value || '').toLowerCase() === 'yes';
      valueCell.font = { color: { argb: isYes ? 'FFB91C1C' : 'FF15803D' }, bold: true };
    }
    if (metric === 'Recovery Spikes') {
      const isYes = String(valueCell.value || '').toLowerCase() === 'yes';
      valueCell.font = { color: { argb: isYes ? 'FFC2410C' : 'FF15803D' }, bold: true };
    }
  }

  await workbook.xlsx.writeFile(outPath);
  return outPath;
}

module.exports = { generateExcelReport };
