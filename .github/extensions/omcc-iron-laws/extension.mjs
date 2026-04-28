// OMCC Iron Laws — non-negotiable agent behavior enforcement.
import { joinSession } from "@github/copilot-sdk/extension";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectDebugArtifacts,
  extractFilePath,
  isFormatCommand,
  isGitCommitCommand,
  isTestFile,
  updateCircuitBreaker,
} from "./rules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const laws = JSON.parse(readFileSync(join(__dirname, "laws.json"), "utf8"));

function enabled(law) {
  return laws[law]?.enabled !== false;
}

function prefix(law) {
  const sev = (laws[law]?.severity ?? "warn").toUpperCase();
  return `OMCC Iron Law [${sev}]:`;
}

// Session-scoped state (reset on each session start).
const state = {
  viewedFiles: new Set(),
  consecutiveFailures: 0,
  formatRanInSession: false,
};

function resetState() {
  state.viewedFiles.clear();
  state.consecutiveFailures = 0;
  state.formatRanInSession = false;
}

await joinSession({
  hooks: {
    onSessionStart: () => {
      resetState();
    },

    onPreToolUse: (input) => {
      const { toolName, toolArgs } = input;

      // Law 1: Read Before Write
      if (enabled("read-before-write") && toolName === "edit") {
        const target = extractFilePath(toolArgs);
        if (target && !state.viewedFiles.has(target)) {
          console.error(
            `${prefix("read-before-write")} Editing "${target}" without a prior view/grep. Read files before editing them.`,
          );
        }
      }

      // Law 4: Format Before Commit
      if (enabled("format-before-commit") && toolName === "powershell") {
        const cmd = toolArgs?.command ?? "";
        if (isGitCommitCommand(cmd) && !state.formatRanInSession) {
          console.error(
            `${prefix("format-before-commit")} Committing without running a formatter/linter this session. Run format/lint first.`,
          );
        }
      }
    },

    onPostToolUse: (input) => {
      const { toolName, toolArgs } = input;

      // Track viewed files for Law 1
      if (toolName === "view" || toolName === "grep") {
        const target = extractFilePath(toolArgs);
        if (target) state.viewedFiles.add(target);
        // grep may search directories; also track glob patterns if present
        const paths = toolArgs?.paths;
        if (Array.isArray(paths)) paths.forEach((p) => state.viewedFiles.add(p));
        else if (typeof paths === "string") state.viewedFiles.add(paths);
      }

      // Track format commands for Law 4
      if (toolName === "powershell" || toolName === "bash") {
        const cmd = toolArgs?.command ?? "";
        if (isFormatCommand(cmd)) {
          state.formatRanInSession = true;
        }
      }

      // Law 2: No Debug Artifacts
      if (enabled("no-debug-artifacts") && (toolName === "edit" || toolName === "create")) {
        const target = extractFilePath(toolArgs);
        if (!isTestFile(target)) {
          const content = toolArgs?.new_str ?? toolArgs?.file_text ?? toolArgs?.content ?? "";
          const hits = detectDebugArtifacts(content, target);
          if (hits.length > 0) {
            console.error(
              `${prefix("no-debug-artifacts")} Debug artifacts detected in "${target}": ${hits.join(", ")}. Remove before shipping.`,
            );
          }
        }
      }

      // Law 3: Circuit Breaker
      if (enabled("circuit-breaker") && (toolName === "powershell" || toolName === "bash")) {
        const exitCode = input.exitCode ?? input.toolResult?.exitCode ?? null;
        const success = exitCode === 0 || exitCode === null;
        state.consecutiveFailures = updateCircuitBreaker(success, state.consecutiveFailures);
        const threshold = laws["circuit-breaker"]?.threshold ?? 3;
        if (state.consecutiveFailures >= threshold) {
          console.error(
            `${prefix("circuit-breaker")} ${state.consecutiveFailures} consecutive command failures. Stop and re-plan your approach.`,
          );
        }
      }
    },
  },
});
