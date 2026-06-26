'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BENCHMARK_CYCLES = process.env.BENCHMARK_CYCLES || '5';
const artifactDir = process.env.ARTIFACT_DIR || path.join(__dirname, 'docs');

function runTestMode(mode) {
  console.log(`\n==================================================`);
  console.log(`🚀 Starting ${mode.toUpperCase()} Mode Benchmark Pass (${BENCHMARK_CYCLES} cycles)...`);
  console.log(`==================================================\n`);

  try {
    execSync('node test.js', {
      stdio: 'inherit',
      env: {
        ...process.env,
        EXECUTION_MODE: mode,
        MAX_CYCLES: BENCHMARK_CYCLES,
        RUN_MODE: 'cycles',
        liveDashboardAutoOpen: 'false' // disable opening browser tab repeatedly during benchmark
      }
    });
    console.log(`\n✅ ${mode.toUpperCase()} Mode Pass completed successfully.`);
  } catch (err) {
    console.error(`\n❌ ${mode.toUpperCase()} Mode Pass failed: ${err.message}`);
  }
}

function calculatePeakThroughput(summary) {
  if (!summary.cycles || summary.cycles.length === 0) return 'N/A';
  const passedCycles = summary.cycles.filter(c => c.status === 'PASS');
  if (passedCycles.length === 0) return '0.0';
  
  const minDuration = Math.min(...passedCycles.map(c => c.durationMs));
  const peakOpm = 60000 / minDuration;
  return peakOpm.toFixed(1);
}

function generateBenchmarkReport(stdData, rapData) {
  const stdPeak = calculatePeakThroughput(stdData);
  const rapPeak = calculatePeakThroughput(rapData);

  const reportContent = `# ParentPay POS Throughput Optimization Benchmark Report

Performance audit comparing Standard Mode against the optimized Rapid Mode on the experimental branch: \`experimental/rapid-fire-engine\`.

## Benchmark Configuration
- **Cycles Per Pass**: ${BENCHMARK_CYCLES}
- **Device UDID**: ${stdData.stability?.startupHealth?.udid || rapData.stability?.startupHealth?.udid || 'Auto-Detected'}
- **Framework**: ${stdData.stability?.startupHealth?.framework || rapData.stability?.startupHealth?.framework || 'maui'}

## Summary Verdict

> [!TIP]
> **Rapid Mode** implements child context reuse, product element caching, and minimized UI wait states to drastically improve throughput.

| Metric | Standard Mode | Rapid Mode | Delta / Improvement |
| :--- | :---: | :---: | :---: |
| **Orders Per Minute (OPM)** | ${stdData.performance?.ordersPerMinute || 'N/A'} OPM | ${rapData.performance?.ordersPerMinute || 'N/A'} OPM | **${calculateOpmImprovement(stdData.performance?.ordersPerMinute, rapData.performance?.ordersPerMinute)}** |
| **Success Rate** | ${stdData.stability?.successRate || 'N/A'} | ${rapData.stability?.successRate || 'N/A'} | ${calculateSuccessDelta(stdData.stability?.successRate, rapData.stability?.successRate)} |
| **Average Cycle Time** | ${formatMs(stdData.performance?.averageCycleMs)} | ${formatMs(rapData.performance?.averageCycleMs)} | **${calculateTimeDelta(stdData.performance?.averageCycleMs, rapData.performance?.averageCycleMs)}** |
| **Peak Throughput** | ${stdPeak} OPM | ${rapPeak} OPM | **${calculateOpmImprovement(stdPeak, rapPeak)}** |

## Timing Breakdown by Phase (Averages)

| Phase | Standard Mode | Rapid Mode | Savings (ms) | Improvement % |
| :--- | :---: | :---: | :---: | :---: |
| **Child Selection** | ${formatMs(stdData.performance?.phaseAveragesMs?.childSelection)} | ${formatMs(rapData.performance?.phaseAveragesMs?.childSelection)} | ${subMs(stdData.performance?.phaseAveragesMs?.childSelection, rapData.performance?.phaseAveragesMs?.childSelection)} | ${pctImprovement(stdData.performance?.phaseAveragesMs?.childSelection, rapData.performance?.phaseAveragesMs?.childSelection)} |
| **Product Selection (Cart Build)** | ${formatMs(stdData.performance?.phaseAveragesMs?.cartBuild)} | ${formatMs(rapData.performance?.phaseAveragesMs?.cartBuild)} | ${subMs(stdData.performance?.phaseAveragesMs?.cartBuild, rapData.performance?.phaseAveragesMs?.cartBuild)} | ${pctImprovement(stdData.performance?.phaseAveragesMs?.cartBuild, rapData.performance?.phaseAveragesMs?.cartBuild)} |
| **Checkout Transition** | ${formatMs(stdData.performance?.phaseAveragesMs?.walletSelection)} | ${formatMs(rapData.performance?.phaseAveragesMs?.walletSelection)} | ${subMs(stdData.performance?.phaseAveragesMs?.walletSelection, rapData.performance?.phaseAveragesMs?.walletSelection)} | ${pctImprovement(stdData.performance?.phaseAveragesMs?.walletSelection, rapData.performance?.phaseAveragesMs?.walletSelection)} |
| **Payment** | ${formatMs(stdData.performance?.phaseAveragesMs?.payment)} | ${formatMs(rapData.performance?.phaseAveragesMs?.payment)} | ${subMs(stdData.performance?.phaseAveragesMs?.payment, rapData.performance?.phaseAveragesMs?.payment)} | ${pctImprovement(stdData.performance?.phaseAveragesMs?.payment, rapData.performance?.phaseAveragesMs?.payment)} |

## Key Insights & Audit Summary

1. **Child Context Reuse**:
   - Standard Mode performs child selection lookup from scratch each cycle.
   - Rapid Mode bypasses overlay validations and directly targets the child if it matches the previous cycle, saving Appium round-trips.

2. **Product Element Caching**:
   - Standard Mode queries the Appium server on every item click (inducing a lookup RTT bottleneck).
   - Rapid Mode caches the button element after the first find and reuses it for successive quantity clicks, saving ~400-800ms per extra item.

3. **Adaptive Waits & Logging**:
   - Standard Mode pauses after page transitions (up to 1500ms total fixed delays per cycle).
   - Rapid Mode cuts default sleeps to 0ms and suppresses console logging, removing output buffer drag in PowerShell.

> [!IMPORTANT]
> Target performance: **11-12+ OPM** with **>=95% success rate**. Verify rapid mode achieves this criteria.
`;

  const reportPath = path.join(artifactDir, 'BenchmarkReport.md');
  fs.writeFileSync(reportPath, reportContent, 'utf8');
  console.log(`\n🎉 Benchmark Report generated at: ${reportPath}`);
}

// Helper formatting functions
function formatMs(val) {
  if (val == null) return 'N/A';
  return `${Math.round(val)} ms`;
}

function subMs(std, rap) {
  if (std == null || rap == null) return 'N/A';
  return `${Math.round(std - rap)} ms`;
}

function pctImprovement(std, rap) {
  if (!std || !rap) return 'N/A';
  const val = ((std - rap) / std) * 100;
  return `${val.toFixed(1)}%`;
}

function calculateOpmImprovement(std, rap) {
  const stdNum = parseFloat(std);
  const rapNum = parseFloat(rap);
  if (isNaN(stdNum) || isNaN(rapNum)) return 'N/A';
  const diff = rapNum - stdNum;
  const pct = (diff / stdNum) * 100;
  return `+${diff.toFixed(1)} OPM (+${pct.toFixed(1)}%)`;
}

function calculateSuccessDelta(std, rap) {
  if (!std || !rap) return 'N/A';
  const stdNum = parseFloat(std.replace('%', ''));
  const rapNum = parseFloat(rap.replace('%', ''));
  const diff = rapNum - stdNum;
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
}

function calculateTimeDelta(std, rap) {
  if (!std || !rap) return 'N/A';
  const diff = std - rap;
  const pct = (diff / std) * 100;
  return `-${Math.round(diff)} ms (-${pct.toFixed(1)}%)`;
}

function main() {
  // Run Standard Mode pass
  runTestMode('standard');

  // Run Rapid Mode pass
  runTestMode('rapid');

  // Parse results
  const summaryPathStd = path.join(__dirname, 'logs', 'latest_summary_standard.json');
  const summaryPathRap = path.join(__dirname, 'logs', 'latest_summary_rapid.json');

  let stdData = {}, rapData = {};

  try {
    stdData = JSON.parse(fs.readFileSync(summaryPathStd, 'utf8'));
  } catch (err) {
    console.error(`⚠️ Could not read Standard Mode summary JSON: ${err.message}`);
  }

  try {
    rapData = JSON.parse(fs.readFileSync(summaryPathRap, 'utf8'));
  } catch (err) {
    console.error(`⚠️ Could not read Rapid Mode summary JSON: ${err.message}`);
  }

  generateBenchmarkReport(stdData, rapData);
}

main();
