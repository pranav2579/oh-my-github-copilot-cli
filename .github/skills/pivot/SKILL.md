---
name: pivot
description: Execute a controlled direction change when project goals, technology choices, or scope needs to change. Updates all state files atomically.
---

# Pivot: Controlled Direction Change

Execute a controlled direction change when settled decisions need revision.

## Workflow

1. Document change and rationale
2. Mark old decision as `superseded` via `omcc_decision_update_status`
3. Record new decision via `omcc_decision_add`
4. Update `project-brief.md`
5. Summarize downstream impact
