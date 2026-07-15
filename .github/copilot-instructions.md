# Copilot Instructions

This project is a Node.js CommonJS automation framework for ParentPay POS Android stress testing with WebdriverIO, Appium, ADB helpers, live dashboards, and HTML/Excel reporting.

Use the local caveman instructions in `.github/instructions/caveman.instructions.md` for communication style and implementation discipline.

## Project Rules

- Prefer small, direct changes that preserve the recovery-first design.
- Keep CommonJS style: `require`, `module.exports`, and async functions.
- Treat Appium, ADB, and long-running test stability as core concerns.
- Avoid adding new dependencies unless the task clearly needs one.
- Keep logs actionable and short. Include enough context to diagnose device, session, and checkout failures.
- Do not remove retry, reconnect, popup handling, artifact, or reporting behavior without replacing it.
- Prefer existing helpers in `utils/`, page objects in `pages/`, and runners in `runners/`.
- Keep generated reports, logs, screenshots, and transient run output out of source changes unless explicitly requested.

## Useful Commands

- `npm run stress` runs the main stress test.
- `npm run functional-regression` runs the functional regression runner.
- `npm run benchmark` runs the benchmark flow.

## Testing Guidance

When changing automation flow, recovery, reporting, or metrics, suggest the smallest practical command to validate it. If a real Android device or Appium server is required, say so plainly.
