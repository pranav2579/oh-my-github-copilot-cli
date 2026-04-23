---
description: 'Use when the user wants to design or specify a feature: phrases like "write a spec", "plan a feature", "design X", "what should we build for Y", "I need a SPEC for...". Produces SPEC.md and PLAN.md via the planner agent — never code.'
name: 'workflow-spec'
---

# Workflow: Spec & Plan a Feature

The user is requesting feature design / specification work. **Do not write code.** Produce structured artifacts only.

## Steps

1. **Confirm the outcome in one sentence** to the user. Example: *"Building X so that Y. Acceptance is when Z is observable."*
2. **Invoke the `planner` sub-agent** (via the `task` tool with `agent_type: "planner"`) to produce `SPEC.md` for the feature. Pass the user's full ask + any constraints.
3. **Show the SPEC.md** to the user. Wait for explicit approval ("looks good", "proceed", etc.). If the user wants changes, re-invoke planner with feedback.
4. **Once SPEC is approved**, invoke `planner` again to produce `PLAN.md` (file-by-file change list, new symbols, ordered tasks). The plan must cite `path:line` for every existing symbol.
5. **Show the PLAN.md** and wait for approval.
6. **Recommend `workflow-critique`** as the next step. Do NOT proceed to implementation from this skill.

## Hard rules

- No code edits in this skill. The planner enforces this.
- Acceptance criteria must be testable assertions (3–7 of them).
- If the planner can't cite line numbers for symbols it references, send it back.

## Files produced

- `SPEC.md` — what & why, acceptance criteria
- `PLAN.md` — how, file-level

## Next skill

→ `workflow-critique` (red-team the spec+plan before any code is written)
