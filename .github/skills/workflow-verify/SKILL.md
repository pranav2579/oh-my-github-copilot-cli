---
description: 'Use when the user asks if work is done, wants to verify completion, ship, finalize, merge: phrases like "is this done?", "verify", "finalize", "can we ship?", "are we good?", "check this is complete". Invokes the done-checker agent which runs lint/typecheck/tests/grep-TODO with raw output. Refuses to declare done if anything is red.'
name: 'workflow-verify'
---

# Workflow: Definition-of-Done Verification

The user wants to know if work is actually complete. **Tests don't lie. Vibes do.**

## Preconditions

- A change has been made (uncommitted diff, recent commits, or named branch).
- Per-repo `AGENTS.md` exists with canonical commands (test, lint, typecheck). If absent → STOP with `🚧 BLOCKED: AGENTS.md missing — refusing to vibe-check the build.`

## Steps

1. **Identify the scope** to verify: uncommitted changes, branch vs main, last N commits. Default to `git diff main...HEAD` if branch-based.
2. **Invoke the `done-checker` sub-agent** (via `task` with `agent_type: "done-checker"`). Pass:
   - Path to SPEC.md (for AC mapping)
   - Path to AGENTS.md (for commands)
   - Diff scope
3. **Show the full DoD report** including raw tool output. Do NOT paraphrase — paste verbatim.
4. **Verdict:**
   - 🟢 **PASS** → user may declare done. Recommend they commit/push/PR.
   - 🔴 **FAIL** → list the red items at the top. Recommend looping back to `workflow-tdd` (or fixing directly if scope is small).

## Hard rules

- Done-checker is the only thing allowed to declare PASS. Not you. Not the user's optimism.
- Never override a FAIL verdict. If the user disagrees, they fix the failure or explicitly accept the broken state in writing.
- "It compiled" is not done. "Tests pass" is.

## What's checked

1. Tests pass
2. Lint clean
3. Typecheck clean
4. No new `TODO|FIXME|XXX` in diff
5. Every acceptance criterion → green test
6. No debug droppings (`console.log`, `print(`, `dbg!`, `fmt.Println`)
7. (If UI) Playwright smoke
8. Diff size sanity (< 400 lines or justified)

## After PASS

Suggest:
- `git diff` review
- Commit with conventional message
- Push & open PR
- Link the SPEC.md / acceptance criteria mapping in PR description
