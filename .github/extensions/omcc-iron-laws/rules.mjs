// Iron Laws — pure detection functions (testable without hook wiring).

const DEBUG_PATTERNS = [
  { pattern: /\bconsole\.log\b/, label: "console.log" },
  { pattern: /\bconsole\.debug\b/, label: "console.debug" },
  { pattern: /\bDebug\.WriteLine\b/, label: "Debug.WriteLine" },
  { pattern: /\bdebugger\s*;/, label: "debugger statement" },
];

const PY_DEBUG_PATTERNS = [
  { pattern: /\bprint\s*\(/, label: "print()" },
];

const TEST_FILE_RE = /(?:(?:^|[\\/])(?:__tests__|tests?|specs?|__mocks__)[\\/])|(?:\.(?:test|spec|stories)\.[cm]?[jt]sx?$)|(?:_test\.(?:py|go|rs)$)/i;

const FORMAT_CMD_RE = /\b(?:prettier|eslint|biome|dprint|dotnet\s+format|pnpm\s+format|npm\s+run\s+(?:format|lint)|npx\s+prettier)\b/;

const GIT_COMMIT_RE = /\bgit\s+commit\b/;

/**
 * Check whether a file path looks like a test file.
 */
export function isTestFile(filePath) {
  if (!filePath) return false;
  return TEST_FILE_RE.test(filePath);
}

/**
 * Scan content for debug artifacts. Returns an array of matched labels.
 * Skips Python-specific patterns unless the file has a .py extension.
 */
export function detectDebugArtifacts(content, filePath) {
  if (!content) return [];
  const matches = [];
  for (const { pattern, label } of DEBUG_PATTERNS) {
    if (pattern.test(content)) matches.push(label);
  }
  if (filePath && /\.py$/i.test(filePath)) {
    for (const { pattern, label } of PY_DEBUG_PATTERNS) {
      if (pattern.test(content)) matches.push(label);
    }
  }
  return matches;
}

/**
 * Extract the target file path from tool arguments.
 */
export function extractFilePath(toolArgs) {
  return toolArgs?.path ?? toolArgs?.file_path ?? toolArgs?.filePath ?? "";
}

/**
 * Check whether a shell command contains `git commit`.
 */
export function isGitCommitCommand(command) {
  return GIT_COMMIT_RE.test(command ?? "");
}

/**
 * Check whether a shell command is a formatting or linting command.
 */
export function isFormatCommand(command) {
  return FORMAT_CMD_RE.test(command ?? "");
}

/**
 * Update circuit breaker state. Returns the new consecutive failure count.
 * @param {boolean} success - whether the command succeeded
 * @param {number} current - current consecutive failure count
 * @returns {number} updated count
 */
export function updateCircuitBreaker(success, current) {
  return success ? 0 : current + 1;
}
