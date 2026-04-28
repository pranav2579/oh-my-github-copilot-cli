---
name: parallel-execute
description: Execute multiple tasks in parallel using isolated git worktrees. Each task gets its own branch and working directory with no conflicts.
---

# Parallel Execute

## When to Use
- Multiple independent tasks need to run simultaneously
- Workflow engine identifies parallel nodes in a DAG
- You want to fix multiple issues at once

## Workflow

1. `omcc_worktree_create(branch_name="fix-42", base_branch="main")` per task
2. Work in each worktree independently
3. `omcc_worktree_list` to check status
4. `omcc_worktree_merge(branch_name="fix-42")` to merge back
5. `omcc_worktree_cleanup(branch_name="fix-42")` to clean up

## Conflict Handling

If merge reports conflicts, resolve manually or use the code-reviewer agent.
