---
name: harness-evolve
description: Automatically improve harness skills and agents through proposed mutations, evaluation, and selective promotion. Use to systematically optimize the harness over time.
---

# Harness Self-Evolution

Systematic improvement of skills and agents through a propose/evaluate/decide loop.

## Evolution Loop

1. **Propose**: Identify a skill or agent to improve, then call `omcc_evolve_propose`
2. **Evaluate**: Run A/B eval (use skill-eval) comparing original vs proposed, then call `omcc_evolve_evaluate`
3. **Decide**: If score improved, promote; if not, rollback
   - `omcc_evolve_promote` applies the improvement (returns content for file write)
   - `omcc_evolve_rollback` keeps the original
4. **Learn**: Review `omcc_evolve_history` to see what types of mutations work

## Mutation Types

| Type | What It Does |
|---|---|
| refine | Improve clarity, fix edge cases |
| expand | Add missing capabilities |
| simplify | Remove unnecessary complexity (reduce tokens) |
| restructure | Reorganize for better flow |

## Safety

- Original content is always preserved in the database
- Rollback is always possible
- Only promote when eval_score shows positive improvement (> 0.0)
- The agent performs the actual file write after promotion; the tool only returns content

## Example Workflow

```
# 1. Read the current skill
view .github/skills/debug/SKILL.md

# 2. Draft an improved version and propose it
omcc_evolve_propose(target_file=".github/skills/debug/SKILL.md", mutation_type="refine", ...)

# 3. Evaluate original vs proposed (use skill-eval or manual A/B)
omcc_evolve_evaluate(candidate_id="evo-abc12345", eval_score=0.72)

# 4. Score is positive, promote
omcc_evolve_promote(candidate_id="evo-abc12345")

# 5. Write the returned proposed_content to the file
edit .github/skills/debug/SKILL.md ...
```
