# ParentPay POS - Phase-wise Non-Breaking Improvement Plan

Date: 2026-06-16
Goal: Improve unattended stability and practical throughput without changing business logic or architecture.

## Baseline (from recent run)
- Current Cycle: 33
- Dashboard OPM shown: ~4.5
- Success Rate: 100%
- Perf summary OPM in logs: ~7.0

Note: Dashboard OPM included startup/setup time, so it under-reported transaction throughput.

## Phase 1 (Implemented) - Reliability Hardening (Safe)
Status: Done

1. Unattended-safe device selection
- Prevent interactive device prompt when unattended mode is enabled.
- Fails fast if multiple devices are present in unattended mode.

2. Stronger ADB health gates
- Enforce ADB connected checks before session start, setup, and each cycle.
- Keep network check warning-only to avoid brittle false negatives.

3. Watchdog timer cleanup hardening
- Ensure watchdog timer is cleared on both success and failure paths.

4. Startup health snapshot logging
- One structured HEALTH log at pre-session stage.

Expected effect:
- Lower risk of unattended hangs/recovery races; no behavior change in transaction flow.

## Phase 2 (Implemented) - Low-risk Performance Optimizations
Status: Done

1. Correct dashboard OPM signal
- Dashboard now prefers perf summary OPM (cycle-time based) when available.
- Falls back to startup-inclusive OPM if needed.

2. Reduce non-critical cycle overhead via configurable cadence
- Added config:
  - networkAndMemoryCheckEveryNCycles (default: 12)
  - driverHealthCheckEveryNCycles (default: 2)
- Network/memory and window-size health probes now run at configured cadence instead of every cycle (or every 10 fixed cycles).

Expected effect:
- Better OPM observability accuracy.
- Small throughput gain by reducing non-essential per-cycle overhead.

## Phase 3 (Next, Safe)
Status: Planned

1. Tune quantity delay only when qty > 1 test profile is used
- Lower delayBetweenQuantityClicksMs incrementally (1000 -> 850 -> 700) with validation.
- Roll back immediately if cart increment reliability drops.

2. Tighten setup fixed waits to condition-first where already available
- Replace selected fixed pauses in setup paths with existing state checks.
- Keep fallback waits for flaky transitions.

Expected effect:
- Moderate throughput gain with low-to-medium risk if done carefully.

## Phase 4 (Optional, Safe)
Status: Planned

1. Artifact retention policy
- Keep last N run folders or last X days to control disk growth.
- No impact on run logic.

2. Health-gate summary in reports
- Add startup HEALTH snapshot in final report for quicker diagnostics.

Expected effect:
- Operational stability and easier diagnostics over long-run usage.

## Rollout / Verification
1. Run 20-30 minute duration mode smoke after each phase.
2. Check:
- successRate >= 98%
- no repeated watchdog failures
- no increase in recovery churn
- OPM trend improved or unchanged with equal stability

## Rollback Guidance
- Revert only these keys if needed:
  - networkAndMemoryCheckEveryNCycles
  - driverHealthCheckEveryNCycles
- Dashboard OPM source change is display-only and can be reverted independently.
