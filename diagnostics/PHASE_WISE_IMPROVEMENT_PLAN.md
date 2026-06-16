# ParentPay POS Non-Breaking Improvement Plan

Date: 2026-06-16
Scope: Safe, non-breaking, performance + reliability hardening only.

## Phase 1 - Reliability Guardrails (Implemented)
Objective: Remove unattended deadlocks and tighten recovery safety without changing business flow.

Changes:
- Added unattended-mode detection (`config.unattended === true` or `CI=true`).
- Block interactive multi-device prompt in unattended mode with explicit error.
- Enforced ADB connectivity gates before session start, setup, and each cycle.
- Ensured watchdog timer cleanup on both success and failure paths.
- Added startup HEALTH snapshot log for triage.

Expected impact:
- Fewer stuck unattended runs.
- Faster and clearer failure classification.

Risk: Low

## Phase 2 - Throughput Reporting + Low-Value Overhead Reduction (Implemented)
Objective: Improve perceived and actual throughput with conservative, safe cadence controls.

Changes:
- Live dashboard OPM now prefers `perf.getSummaryData().ordersPerMinute` (cycle-based throughput) instead of startup-inclusive OPM.
- Introduced configurable cadence for network/memory checks:
  - `networkAndMemoryCheckEveryNCycles` (set to 12)
- Introduced configurable cadence for Appium health check (`getWindowSize`):
  - `driverHealthCheckEveryNCycles` (set to 2)

Expected impact:
- More accurate real-time OPM (closer to steady-state throughput).
- Modest cycle-time improvement by reducing non-critical driver/ADB overhead.

Risk: Low

## Phase 3 - Stability + Cleanup Hardening (Planned, Not Implemented)
Objective: Keep long-run 4h/8h behavior stable and operationally clean.

Candidates:
- Artifact retention policy (age/count) for `logs/` run directories.
- Optional runtime guard to stop on repeated watchdog chains.
- Add explicit login/tutorial state detectors (recovery coverage gap closure).

Expected impact:
- Better long-run maintainability.
- Lower operational toil and disk growth.

Risk: Low to Medium (depends on retention strategy)

## Phase 4 - Safe Performance Experiments (Planned, Not Implemented)
Objective: Incremental OPM improvements without business-logic change.

Candidates:
- Config-only experiments for check cadence and quantity delay.
- Targeted removal of redundant setup pauses where transitions are already verified.
- Add optional rolling-window OPM telemetry for tuning.

Expected impact:
- Additional OPM gains with controlled rollback.

Risk: Low if experiment flags are config-gated.

## Validation Performed
- `node --check .\\test.js`
- `node --check .\\test.js` after config + code updates

## Rollback Strategy
- Revert only `config.json` cadence keys to previous values.
- Revert `test.js` updateDashboardMetrics and cadence conditionals if needed.
