---
name: skill-eval
description: Evaluate whether a skill actually improves agent performance using dual-arm A/B testing. Grades skills A-F based on measured delta.
---

# Skill A/B Evaluation

## How It Works
1. Define test cases (prompts + expected outcomes)
2. Run each test case WITH the skill loaded
3. Run each test case WITHOUT the skill (baseline)
4. Compare scores to measure the skill's actual impact
5. Grade: A (>=+0.30), B (>=+0.15), C (>=0.00), F (<0.00)

## Workflow
1. `omcc_eval_create(skill_name, test_cases, graders)` — Set up evaluation
2. Run test cases in both arms, submit scores via `omcc_eval_score`
3. `omcc_eval_report(eval_id)` — Get the grade and detailed report
4. `omcc_eval_history(skill_name)` — Track improvements over time

## Grader Types
| Type | What It Checks |
|---|---|
| string-match | Exact string presence in output |
| regex | Pattern match in output |
| file-exists | Whether expected files were created |
| exit-code | Whether command succeeded (0) |
| contains | Substring presence |

## Interpreting Grades
- **A**: Skill clearly helps — keep and promote
- **B**: Skill moderately helps — keep, consider improving
- **C**: Skill is neutral — review if worth the token cost
- **F**: Skill hurts performance — investigate and fix or remove
