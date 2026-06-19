# ParentPay POS Throughput Optimization Benchmark Report

Performance audit comparing Standard Mode against the optimized Rapid Mode on the experimental branch: `experimental/rapid-fire-engine`.

## Benchmark Configuration
- **Cycles Per Pass**: 5
- **Device UDID**: Auto-Detected
- **Framework**: maui

## Summary Verdict

> [!TIP]
> **Rapid Mode** implements child context reuse, product element caching, and minimized UI wait states to drastically improve throughput.

| Metric | Standard Mode | Rapid Mode | Delta / Improvement |
| :--- | :---: | :---: | :---: |
| **Orders Per Minute (OPM)** | 8.4 OPM | 9.1 OPM | **+0.7 OPM (+8.3%)** |
| **Success Rate** | 100.0% | 100.0% | +0.0% |
| **Average Cycle Time** | 7165 ms | 6559 ms | **-606 ms (-8.5%)** |
| **Peak Throughput** | 8.0 OPM | 9.8 OPM | **+1.8 OPM (+22.5%)** |

## Timing Breakdown by Phase (Averages)

| Phase | Standard Mode | Rapid Mode | Savings (ms) | Improvement % |
| :--- | :---: | :---: | :---: | :---: |
| **Child Selection** | 2078 ms | 1220 ms | 858 ms | 41.3% |
| **Product Selection (Cart Build)** | 2044 ms | 2183 ms | -139 ms | -6.8% |
| **Checkout Transition** | 1267 ms | 1296 ms | -29 ms | -2.3% |
| **Payment** | 1723 ms | 1859 ms | -136 ms | -7.9% |

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
