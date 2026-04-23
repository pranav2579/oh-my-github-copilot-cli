// OMCC Guardrails extension.
import { joinSession } from "@github/copilot-sdk/extension";
import { execFileSync } from "node:child_process";
import { evaluateBashCommand, evaluateFileWrite, scanDiffForSecrets } from "./rules.mjs";

const allowSecrets = process.env.OMCC_ALLOW_SECRETS === "1";
const protectedBranches = (process.env.OMCC_PROTECTED_BRANCHES ?? "main,master")
  .split(",").map((s) => s.trim()).filter(Boolean);

await joinSession({
  hooks: {
    onPreToolUse: async (input) => {
      const { toolName, toolArgs } = input;
      if (toolName === "bash") {
        const cmd = toolArgs?.command ?? "";
        const verdict = evaluateBashCommand(cmd, { protectedBranches });
        if (verdict.decision === "deny") {
          return { permissionDecision: "deny", permissionDecisionReason: verdict.reason };
        }
        if (!allowSecrets && /\bgit\s+commit\b/.test(cmd)) {
          try {
            const diff = execFileSync("git", ["diff", "--cached"], {
              cwd: input.cwd, encoding: "utf8",
              stdio: ["ignore", "pipe", "ignore"],
              maxBuffer: 16 * 1024 * 1024,
            });
            const scan = scanDiffForSecrets(diff);
            if (scan.found) {
              return {
                permissionDecision: "deny",
                permissionDecisionReason: `OMCC guardrail: staged diff appears to contain secrets (${scan.matches.join(", ")}). Unstage them or set OMCC_ALLOW_SECRETS=1.`,
              };
            }
          } catch { /* not a git repo: skip */ }
        }
        return;
      }
      if (toolName === "edit" || toolName === "create") {
        const target = toolArgs?.path ?? toolArgs?.file_path ?? "";
        const verdict = evaluateFileWrite(target, { allowSecrets });
        if (verdict.decision === "deny") {
          return { permissionDecision: "deny", permissionDecisionReason: verdict.reason };
        }
      }
    },
  },
});
