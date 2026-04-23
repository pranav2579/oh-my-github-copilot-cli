---
description: 'Use when the user wants adversarial review of a plan, spec, design, or code change: phrases like "critique my plan", "review this design", "red-team this", "what could go wrong", "find bugs in", "is this right?". Invokes the critic sub-agent for brutal-but-actionable findings.'
name: 'workflow-critique'
---

# Workflow: Adversarial Critique

The user wants their plan/spec/code reviewed for problems. **Find what's wrong — don't be polite.**

## Steps

1. **Identify the artifact** to critique: SPEC.md, PLAN.md, a diff (`git diff`), or a specific file. If unclear, ask once.
2. **Invoke the `critic` sub-agent** (via `task` with `agent_type: "critic"`). Pass it:
   - The artifact path(s)
   - SPEC.md if reviewing PLAN.md or code (so it has acceptance criteria to check against)
   - Any specific concerns the user mentioned
3. **Show the critique** verbatim — do not soften or filter findings.
4. **For each finding**, ask the user whether to:
   - 🔴 **Block** — must fix before proceeding (default for 🔴 severity)
   - 🟠 **Address** — fold into PLAN.md / next iteration
   - 🟡 **Note** — acknowledge, defer
   - ⏭️ **Skip** — disagree, move on (require justification)
5. **Update PLAN.md** (if reviewing a plan) with the must-fix items folded in.
6. **Recommend next skill:**
   - If reviewing SPEC/PLAN → `workflow-tdd` (write tests, then implement)
   - If reviewing code/diff → fix → re-run critique → `workflow-verify`

## Hard rules

- Critic is read-only. It cannot fix what it finds.
- Don't accept fewer than 5 findings. If critic returns < 5, re-invoke with "look harder."
- Don't silently dismiss findings. Every dismissal must be explicit and justified.

## What good critique looks like

Each finding has: `path:line` reference, concrete consequence, specific fix. No hedging.
