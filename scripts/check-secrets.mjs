#!/usr/bin/env node
// Check Git's index, never the working copy: an unstaged edit cannot hide a staged secret.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/check-secrets.mjs [--all-tracked]\nChecks staged additions/changes by default, or every indexed file with --all-tracked. Reports paths and rule names only.');
  process.exit(0);
}
if (args.some(arg => arg !== '--all-tracked') || args.length > 1) {
  console.error('Unknown argument. Use --help for usage.');
  process.exit(2);
}

let root;
function git(...arguments_) {
  try {
    return execFileSync('git', arguments_, {
      cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // Git diagnostics can contain object content or other local details; do not echo them.
    throw new Error('Unable to read the Git index or a staged blob. No files were skipped.');
  }
}

const pathRules = [
  ['credential-file', /(?:^|\/)(?:\.aws|\.ssh)(?:\/|$)|(?:^|\/)(?:\.iam_key|credentials|credentials\.json|config\.tar\.gz\.gpg)$|(?:^|\/)config\/(?:aws|imgix)\.json$/i],
  ['environment-file', /(?:^|\/)\.env(?:\..*)?$/i],
  ['private-key-file', /\.(?:key|pem|p12|pfx|jks|keystore)$/i],
  ['ssh-private-key-file', /(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?$/i],
  ['editor-swap', /(?:^|\/)\.swp$|\.sw[op]$/i],
];

const contentRules = [
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{50,})\b/g],
  ['openai-token', /\bsk-(?:(?:proj-|svcacct-)[A-Za-z0-9_-]{30,}|[A-Za-z0-9]{48})\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['password-in-url', /\bhttps?:\/\/[^\s/:@]{1,80}:([^\s/@]{6,})@/g],
  ['credential-assignment', /\b(?:aws_secret_access_key|secretAccessKey|api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*["']([^"'\r\n]{12,})["']/gi],
  ['credential-assignment', /\b(?:aws_secret_access_key|secretAccessKey|api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|client[_-]?secret)["']?\s*[:=]\s*([A-Za-z0-9_+/.=-]{20,})(?=[\s,;}]|$)/gi],
];

function placeholder(value) {
  return value === 'AKIAIOSFODNN7EXAMPLE'
    || value === 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    || /^(?:<[^>]+>|\$\{[^}]+\}|process\.env\.[A-Z_]+|(?:your|example|placeholder|dummy|fake|test|not-a-real|replace)[-_ ][A-Za-z0-9_ -]*)$/i.test(value)
    || /^(.)\1+$/.test(value);
}

try {
  root = git('rev-parse', '--show-toplevel').toString('utf8').trim();
  const changed = args.includes('--all-tracked') ? null : new Set(
    git('diff', '--cached', '--name-only', '--diff-filter=ACMRTU', '-z').toString('utf8').split('\0').filter(Boolean),
  );
  const entries = git('ls-files', '--stage', '-z').toString('utf8').split('\0').filter(Boolean);
  const findings = new Map();
  const blobs = new Map();
  let scanned = 0;
  function flag(file, rule) {
    if (!findings.has(file)) findings.set(file, new Set());
    findings.get(file).add(rule);
  }
  for (const entry of entries) {
    const match = /^(\d+) ([a-f\d]+) (\d)\t([\s\S]+)$/.exec(entry);
    if (!match) throw new Error('Unable to parse a Git index entry. No files were skipped.');
    const [, mode, object, stage, file] = match;
    if (changed && !changed.has(file)) continue;
    if (stage !== '0') { flag(file, 'unmerged-index-entry'); continue; }
    if (mode === '160000') { flag(file, 'unscanned-submodule'); continue; }
    scanned++;
    const isExample = /\.(?:example|sample|template)$/i.test(file);
    for (const [rule, pattern] of pathRules) {
      if (pattern.test(file) && !(rule === 'environment-file' && isExample)) flag(file, rule);
    }
    if (!blobs.has(object)) blobs.set(object, git('cat-file', 'blob', object).toString('utf8'));
    const content = blobs.get(object);
    for (const [rule, pattern] of contentRules) {
      for (const match of content.matchAll(pattern)) {
        const value = match[1] ?? match[0];
        if (rule !== 'private-key' && placeholder(value)) continue;
        flag(file, rule);
      }
    }
  }
  if (findings.size) {
    console.error(`Secret check failed in ${findings.size} file(s); values are redacted:`);
    for (const [file, rules] of [...findings].sort(([a], [b]) => a.localeCompare(b))) {
      console.error(`${JSON.stringify(file)}: ${[...rules].sort().join(', ')}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Secret check passed: ${scanned} ${changed ? 'staged' : 'indexed'} file(s).`);
  }
} catch (error) {
  console.error(`Secret check failed: ${error.message}`);
  process.exitCode = 2;
}
