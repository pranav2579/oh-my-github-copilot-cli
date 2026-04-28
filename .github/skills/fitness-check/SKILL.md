---
name: fitness-check
description: Compute a deterministic quality score for recent changes. Use before declaring a task complete to verify quality meets thresholds.
---

# Fitness Check

## When to Use
- Before declaring a task "done"
- Before creating a PR
- After implementing changes to verify quality

## Workflow
1. Identify changed files using `git diff --name-only`
2. Run build, lint, test, and format commands
3. Call `omcc_fitness_score` with the results
4. If score < 0.4 (REJECT): fix issues before proceeding
5. If score 0.4-0.7 (WARN): review warnings and fix if possible
6. If score > 0.7 (PASS): proceed with confidence

## Score Components
| Component | Weight | What It Measures |
|---|---|---|
| Build health | 20% | Does the project build? |
| Lint clean | 20% | Are there lint errors? |
| Test pass | 25% | Do tests pass? |
| No debug artifacts | 10% | console.log, debugger, Debug.WriteLine |
| Format check | 10% | Is code formatted? |
| No TODOs added | 10% | New TODO/FIXME/HACK comments |
| Security | 5% | Hardcoded secrets/credentials |

## Grade Thresholds
| Grade | Range | Action |
|---|---|---|
| PASS | > 0.70 | Ship it |
| WARN | 0.40 - 0.70 | Review warnings, fix if possible |
| REJECT | < 0.40 | Must fix before proceeding |

## Example Usage

```
# 1. Get changed files
git diff --name-only HEAD~1

# 2. Run quality commands and capture exit codes
npm run build        # capture exit code
npm run lint         # capture exit code + error count
npm test             # capture exit code + pass/total
npm run format:check # capture exit code

# 3. Feed results to the MCP tool
omcc_fitness_score({
  project_root: "/path/to/project",
  changed_files: ["src/auth.ts", "src/utils.ts"],
  build_cmd: "npm run build",
  build_exit_code: 0,
  lint_cmd: "npm run lint",
  lint_exit_code: 0,
  test_cmd: "npm test",
  test_exit_code: 0,
  test_passed: 47,
  test_total: 47,
  format_cmd: "npm run format:check",
  format_exit_code: 0
})
```