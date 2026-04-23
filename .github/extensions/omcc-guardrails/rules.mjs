// Guardrail rules: unit-testable, no SDK deps. Used by extension.mjs.

const SECRET_PATTERNS = [
  { name: "OpenAI API key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "GitHub PAT", re: /\bgh[pous]_[A-Za-z0-9]{30,}\b/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Slack bot token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "Generic 'apikey=' literal", re: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_/+=-]{16,}["']/i },
];

const DESTRUCTIVE_PATTERNS = [
  { name: "rm -rf root or home",        re: /\brm\s+(?:-[a-zA-Z]*[rRfF][a-zA-Z]*\s+)+(?:\/|~|\$HOME|\/\*)\s*(?:$|\s)/ },
  { name: "rm -rf with wildcard at /",  re: /\brm\s+(?:-[a-zA-Z]*[rRfF][a-zA-Z]*\s+)+\/[^\s]*\*/ },
  { name: "chmod 777 recursive",        re: /\bchmod\s+(?:-R\s+)?0?777\b/ },
  { name: "dd to /dev/sd?",             re: /\bdd\s+.*of=\/dev\/sd[a-z]/ },
  { name: "mkfs against /dev/sd?",      re: /\bmkfs(?:\.\w+)?\s+\/dev\/sd[a-z]/ },
  { name: "curl|sh anti-pattern",       re: /\bcurl\s+[^|]*\|\s*(?:sudo\s+)?(?:bash|sh|zsh)\b/ },
  { name: "fork bomb",                  re: /:\(\)\{\s*:\|:&\s*\};:/ },
];

const SENSITIVE_PATHS = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.env$/,
  /(^|\/)id_rsa(\.|$)/,
  /(^|\/)id_rsa$/,
  /\.pem$/,
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)\.npmrc$/,
];

export function scanDiffForSecrets(diff) {
  const matches = [];
  for (const p of SECRET_PATTERNS) if (p.re.test(diff)) matches.push(p.name);
  return { found: matches.length > 0, matches };
}

export function evaluateBashCommand(cmd, opts = {}) {
  if (typeof cmd !== "string" || cmd.trim() === "") return { decision: "allow", reason: "" };
  const protectedBranches = opts.protectedBranches ?? ["main", "master"];
  for (const p of DESTRUCTIVE_PATTERNS) {
    if (p.re.test(cmd)) {
      return {
        decision: "deny",
        reason: `OMCC guardrail: blocked destructive command (${p.name}).`,
      };
    }
  }
  if (/\bgit\s+push\b/.test(cmd) && /(--force|-f\b|--force-with-lease)/.test(cmd)) {
    for (const branch of protectedBranches) {
      const re = new RegExp(`\\b(?:origin|upstream)?\\s*${branch}\\b`);
      if (re.test(cmd)) {
        return { decision: "deny", reason: `OMCC guardrail: blocked force-push to '${branch}'.` };
      }
    }
  }
  return { decision: "allow", reason: "" };
}

export function evaluateFileWrite(filePath, opts = {}) {
  if (typeof filePath !== "string") return { decision: "allow", reason: "" };
  if (opts.allowSecrets === true) return { decision: "allow", reason: "" };
  for (const re of SENSITIVE_PATHS) {
    if (re.test(filePath)) {
      return {
        decision: "deny",
        reason: `OMCC guardrail: refused to write secret-bearing file '${filePath}'. Set OMCC_ALLOW_SECRETS=1 to override.`,
      };
    }
  }
  return { decision: "allow", reason: "" };
}
