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
| **Orders Per Minute (OPM)** | 8.2 OPM | 14.9 OPM | **+6.7 OPM (+81.7%)** |
| **Success Rate** | 100.0% | 100.0% | +0.0% |
| **Average Cycle Time** | 7337 ms | 4032 ms | **-3305 ms (-45.0%)** |
| **Peak Throughput** | 7.7 OPM | 14.2 OPM | **+6.5 OPM (+84.4%)** |

## Timing Breakdown by Phase (Averages)

| Phase | Standard Mode | Rapid Mode | Savings (ms) | Improvement % |
| :--- | :---: | :---: | :---: | :---: |
| **Child Selection** | 2228 ms | 1065 ms | 1163 ms | 52.2% |
| **Product Selection (Cart Build)** | 1986 ms | 785 ms | 1201 ms | 60.5% |
| **Checkout Transition** | 1468 ms | 803 ms | 665 ms | 45.3% |
| **Payment** | 1597 ms | 1377 ms | 220 ms | 13.8% |

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
