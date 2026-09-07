export type SecretFinding = { type: string; line: number };
const patterns: [string, RegExp][] = [
  [
    "Private key",
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  ],
  [
    "GitHub token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  ],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  [
    "Service credential",
    /\b(?:sk_live_|sk_test_|xox[baprs]-|npm_)[A-Za-z0-9_-]{16,}/,
  ],
  [
    "Assigned secret",
    /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9_+\/=.-]{16,}/i,
  ],
];
export function scanSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const [i, line] of text.split("\n").entries())
    for (const [type, re] of patterns)
      if (re.test(line)) findings.push({ type, line: i + 1 });
  return findings.slice(0, 100);
}
