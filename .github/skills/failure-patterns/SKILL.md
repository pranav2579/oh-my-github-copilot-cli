---
name: failure-patterns
description: Review, add, and manage failure patterns that help agents avoid recurring mistakes. Use when debugging repeated issues or at session end to capture lessons learned.
---

# Failure Patterns

## When to Use
- After fixing a bug that was caused by a recurring mistake
- At the end of a session to capture lessons learned
- When you notice the same type of error happening repeatedly

## Workflow
1. Use `omcc_failure_pattern_list` to review existing patterns
2. Use `omcc_failure_pattern_check` with the current context to see if there are known patterns
3. If a new pattern is discovered, use `omcc_failure_pattern_add` to record it
4. Patterns with scope 'global' apply across all projects
5. Patterns with scope 'project' apply only to the current project

## Pattern Format
- **pattern**: Concise description of what goes wrong (e.g., "Editing files without reading them first leads to stale content errors")
- **prevention**: Specific action to prevent it (e.g., "Always use view tool on a file before editing it")
