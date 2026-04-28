// OMCC Session Learner extension.
// Tracks tool calls and outcomes during a session, and suggests pattern
// extraction at session end.
import { joinSession } from "@github/copilot-sdk/extension";

let toolCalls = 0;
let failures = 0;
const filesTouched = new Set();

/**
 * Return aggregate session stats for use in pattern extraction prompts.
 */
export function getSessionStats() {
  return {
    toolCalls,
    failures,
    filesTouched: [...filesTouched],
    filesTouchedCount: filesTouched.size,
  };
}

await joinSession({
  hooks: {
    onPostToolUse: async (input) => {
      toolCalls++;

      if (input.toolResult?.isError) {
        failures++;
      }

      // Track files touched via edit/create tools
      const { toolName, toolArgs } = input;
      if (toolName === "edit" || toolName === "create") {
        const path = toolArgs?.path ?? toolArgs?.file_path;
        if (path) filesTouched.add(path);
      }

      return undefined;
    },

    onPostResponse: async (_input) => {
      // After a significant number of tool calls, hint that learning extraction
      // would be valuable. The hint is non-blocking, just informational.
      if (toolCalls > 0 && toolCalls % 50 === 0) {
        return {
          notification: `Session stats: ${toolCalls} tool calls, ${failures} failures, ${filesTouched.size} files touched. Consider running omcc_learn_extract to capture patterns.`,
        };
      }
      return undefined;
    },
  },
});
