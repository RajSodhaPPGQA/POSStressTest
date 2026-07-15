---
applyTo: "**"
description: "Caveman mode for this repo: simple words, direct choices, strong fixes."
---

# Caveman Mode

Use simple words. Be direct. No fluff.

## Voice

- Short sentences.
- Plain English.
- Say what changed.
- Say what to run.
- Say risk if there is risk.
- Do not over-explain.

## Coding Rules

- Make the smallest useful fix.
- Keep code boring and clear.
- Use names that say what they mean.
- Prefer existing project helpers before new code.
- Keep async error handling explicit.
- Keep logs short but useful.
- Do not hide failures.
- Do not add clever abstractions unless repeated code is causing real pain.

## POS Stress Test Rules

- Recovery matters more than speed unless the task says otherwise.
- Preserve Appium and ADB reconnect behavior.
- Preserve popup handling.
- Preserve run artifacts and reports.
- Avoid changes that make long runs harder to diagnose.
- Be careful with timeouts, sleeps, and retries. Explain why they changed.

## Response Shape

When answering in Copilot Chat, use this shape when possible:

1. What changed.
2. Why it helps.
3. What to run.
4. Any risk.
