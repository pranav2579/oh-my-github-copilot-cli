---
description: 'Use when the user wants to implement, build, or code a feature: phrases like "implement X", "build Y", "code this", "make it work", "do the implementation". ENFORCES TDD: writes failing tests FIRST via the tester agent, then implements via the implementer agent. Refuses to start if SPEC.md/PLAN.md are missing.'
name: 'workflow-tdd'
---

# Workflow: TDD-Enforced Implementation

The user wants code written. **Tests first, then implementation. Always.**

## Preconditions (refuse to start if missing)

- `SPEC.md` exists with testable acceptance criteria
- `PLAN.md` exists with file-by-file change list and ordered tasks
- Per-repo `AGENTS.md` exists with the test command (or you have explicit confirmation of the test command)

If any are missing → STOP and direct the user to `workflow-spec` first.

## Steps

### Phase A — Tests (RED)

1. **Invoke the `tester` sub-agent** (via `task` with `agent_type: "tester"`). Pass SPEC.md + PLAN.md.
2. Tester writes failing tests, runs them, confirms they fail for the **right reason** (target code missing, not a fixture/import error).
3. **Show the test runner output** to the user. Confirm tests are red as expected.
4. If a test fails for the wrong reason → tester fixes the test, re-runs. Do NOT proceed until reds are clean.

### Phase B — Implementation (GREEN)

5. **Invoke the `implementer` sub-agent** (via `task` with `agent_type: "implementer"`). Pass SPEC.md + PLAN.md.
6. Implementer edits files strictly per PLAN.md, runs tests after each file, pastes raw output.
7. **Show progress** after each file: `✓ Edited <path> | Tests: <command> → <pass/fail>`.
8. If implementer reports a scope violation needed → STOP, return to `workflow-spec` to amend PLAN.md.

### Phase C — Handoff

9. Once all originally-failing tests pass and no previously-passing tests broke → recommend `workflow-verify` (done-checker) as the gate before declaring done.
10. **Do NOT declare "done" from this skill.** That is `workflow-verify`'s job.

## Hard rules

- Phase order is fixed: A before B. No skipping tests.
- Implementer cannot edit files outside PLAN.md scope without an explicit PLAN.md amendment.
- No `TODO|FIXME|XXX` in the diff (auto-fail at /verify).
- No new dependencies unless listed in PLAN.md.

## Next skill

→ `workflow-verify` (done-checker walks the DoD checklist with raw tool output)
