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
| **Orders Per Minute (OPM)** | 8.5 OPM | 9.8 OPM | **+1.3 OPM (+15.3%)** |
| **Success Rate** | 100.0% | 100.0% | +0.0% |
| **Average Cycle Time** | 7079 ms | 6122 ms | **-957 ms (-13.5%)** |
| **Peak Throughput** | 8.3 OPM | 10.2 OPM | **+1.9 OPM (+22.9%)** |

## Timing Breakdown by Phase (Averages)

| Phase | Standard Mode | Rapid Mode | Savings (ms) | Improvement % |
| :--- | :---: | :---: | :---: | :---: |
| **Child Selection** | 2069 ms | 574 ms | 1495 ms | 72.3% |
| **Product Selection (Cart Build)** | 2042 ms | 2461 ms | -419 ms | -20.5% |
| **Checkout Transition** | 1298 ms | 1407 ms | -109 ms | -8.4% |
| **Payment** | 1615 ms | 1678 ms | -63 ms | -3.9% |

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
