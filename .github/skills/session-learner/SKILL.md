---
name: session-learner
description: Extract and record patterns learned during the current session. Use at session end to capture conventions, anti-patterns, and workflow improvements.
---

# Session Learner

Capture reusable patterns from the current session and graduate them through
confidence-scored memory layers.

## When to Use

- End of a session with significant code changes or debugging
- After discovering a non-obvious convention or anti-pattern
- When repeated corrections suggest a pattern worth remembering

## Workflow

1. Review what happened in this session (changes, corrections, discoveries)
2. `omcc_learn_extract(session_summary)` to extract candidate patterns
3. Review candidates; adjust confidence and category as needed
4. `omcc_learn_record(pattern, category, confidence)` to save good ones
5. For patterns with confidence >= 0.7: `omcc_learn_promote(id, 'L2')` to project state
6. Run `node scripts/generate-essential-rules.mjs` to update L1 if patterns were promoted

## Memory Layers

| Layer | Confidence | Storage | Scope |
|-------|-----------|---------|-------|
| L0 (candidates) | 0.0 - 0.69 | `learned_patterns` table | Session-local |
| L1 (project rules) | 0.7+ promoted | `.omcc/` files | Project |
| L2 (global memory) | 0.7+ promoted | OMCC state store | Cross-project |

## Categories

- **convention**: Coding style, naming, or structural patterns
- **anti-pattern**: Things to avoid (detected via "never", "avoid", "don't")
- **command**: Build, test, or deployment commands
- **architecture**: Module structure, service boundaries, design decisions
- **workflow**: Process steps, review gates, CI/CD patterns

## Confidence Scoring

- Initial extraction: 0.3
- Each duplicate recording: +0.1 (capped at 1.0)
- Promotion threshold: 0.7

## Example

```
Session summary: "We always use vitest for testing in this repo. Never use
jest. The build must pass before running tests. Should always run lint before
committing."

→ Extracts 4 candidates:
  1. "We always use vitest for testing in this repo" (convention, 0.3)
  2. "Never use jest" (anti-pattern, 0.3)
  3. "The build must pass before running tests" (command, 0.3)
  4. "Should always run lint before committing" (workflow, 0.3)
```
