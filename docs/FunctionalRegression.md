# Functional Regression Automation

This document defines the initial functional regression execution layer added to this repository.

## Purpose

The functional regression layer validates business outcomes independently from the stress engine.

Stress testing and functional regression share stable Page Objects and utilities, but they run through separate runners and produce separate reports.

## Execution Commands

- Stress execution (existing behavior):
  - `npm run stress`
- Functional regression execution (new independent runner):
  - `npm run functional-regression`

## Initial Functional Regression Cases

The current implementation includes exactly three initial proof-of-architecture cases:

- `FR-001` Application Launch and Valid State
- `FR-002` POS Navigation and Child Selection
- `FR-003` Basic Order Using Default Wallet

No separate smoke suite is created.

## Architecture

Functional runner:

- `runners/functionalRegressionRunner.js`

Functional case modules:

- `tests/regression/cases/fr001LaunchValidState.js`
- `tests/regression/cases/fr002PosNavigationChildSelection.js`
- `tests/regression/cases/fr003BasicDefaultWalletOrder.js`

Shared assertions/helper modules:

- `tests/regression/assertions/assertions.js`
- `tests/regression/helpers/regressionContext.js`

Functional reporting:

- `utils/functionalRegressionReport.js`
- Output root: `reports/functional-regression/`

## Test Data Setup

Functional regression reuses existing repository configuration from `config.json`.

Values are not hardcoded in case files. The runner reads configured values such as child and product from existing config fields.

If local environment data differs, update local configuration values before execution.

## Reporting Separation

Functional regression reports are stored separately from stress analytics:

- `reports/functional-regression/<run-id>/functional_regression_report.html`
- `reports/functional-regression/<run-id>/functional_regression_report.json`
- Failure screenshots and diagnostics are stored under the same run folder.

Stress report utilities, dashboard behavior, and stress metrics remain unchanged.

## How To Add A Future Regression Case

1. Add a new case module in `tests/regression/cases/`.
2. Export `id`, `title`, `expectedResult`, and async `run(ctx)`.
3. Use shared page objects and helper context methods.
4. Use assertion helpers in `tests/regression/assertions/assertions.js` for deterministic outcome checks.
5. Register the case in `runners/functionalRegressionRunner.js`.
6. Keep results in the functional report only.

## Scope Guardrails

- Do not modify stress-loop behavior in `test.js` for functional-only needs.
- Do not merge functional and stress metrics into one report.
- Keep functional failures classified as functional assertion/test-data/locator/session/device categories where applicable.
