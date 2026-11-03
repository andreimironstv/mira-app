#!/usr/bin/env node
// Reapplies the Mira brand on top of the upstream buzz-app tree. Idempotent.
//   node rebrand/apply.mjs          apply
//   node rebrand/apply.mjs --check  exit 1 if anything is unbranded
// See rebrand/README.md for what is deliberately left alone.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OVERLAY = join(ROOT, "rebrand", "overlay");

const IN_SCOPE = [
  /^README\.md$/,
  /^(index|huddle)\.html$/,
  /^vite[^/]*\.config\.ts$/,
  /^src-tauri\/build\.rs$/,
  /^src\//,
  /^src-tauri\/(src\/|tauri[^/]*\.json$|[^/]*\.plist$)/,
  /^crates\/[^/]+\/(src|tests)\//,
  /^browser-host\//,
  /^tests\//,
  /^scripts\//,
  /^\.github\/workflows\/(?!rebrand-check)/,
  // Compiled into the MCP help tool.
  /^docs\/buzz-help\.md$/,
];
const OUT_OF_SCOPE = [
  /(^|\/)node_modules\//,
  /\/vendor\//,
  /\.(lock|snap|sql|png|svg)$/,
  // Vectors signed or hashed over exact bytes.
  /(contract|fixtures)\.json$/,
];
const C_COMMENT = /^\s*(\/\/|\/\*|\*|\{\/\*)/;
const COMMENT_BY_EXT = {
  ts: C_COMMENT,
  tsx: C_COMMENT,
  js: C_COMMENT,
  jsx: C_COMMENT,
  mjs: C_COMMENT,
  cjs: C_COMMENT,
  rs: C_COMMENT,
  swift: C_COMMENT,
  css: C_COMMENT,
  sh: /^\s*#/,
  yml: /^\s*#/,
  yaml: /^\s*#/,
  py: /^\s*#/,
  html: /^\s*<!--/,
  plist: /^\s*<!--/,
};
// Where the word is an identifier or test input rather than the product name.
const PROTECTED_LINE = [
  /^\s*(@testable\s+)?import\s+Buzz\b/,
  /BLOCK\/Buzz/,
  // A lowercase "buzz" search finds this fixture's name.
  /🐝 Buzz Bot/,
  // The Cargo package keeps its upstream name.
  /-p Buzz\b/,
  /Based on <a href="https:\/\/github\.com\/block\/buzz-app">Buzz<\/a>/,
];

// `\b` misses the name right after an escaped newline or tab, as in "\nBuzz".
// A host such as "Buzz.Example" is test input, not the name, and "X-Buzz-Live-ID"
// or "Buzz-App" is a protocol header or repository name.
const PRODUCT_NAME =
  /(?:(?<=[\x5c][ntr])|(?<!\bX-)\b)Buzz\b(?!-[A-Z]|:\/\/|\.(?!(?:app|exe|dmg)\b)[A-Za-z])/g;

// Targeted edits for what the word rule cannot express.
const FILE_RULES = [
  {
    // Ranking fixtures search for the product name itself.
    file: /^src\/app\/shell\/SearchResults\.test\.tsx$/,
    from: /\["buzz", "(Channels|People)", "(?:buzz-dev|Mira Aldrin)", \["IdentityBuzz"\]\]/g,
    to: (_, group) =>
      `["mira", "${group}", "${group === "People" ? "Mira Aldrin" : "mira-dev"}", ["IdentityMira"]]`,
  },
  {
    file: /^src\/app\/shell\/SearchSettings\.test\.tsx$/,
    from: /"ShortcutsBuzz"/g,
    to: () => '"ShortcutsMira"',
  },
  {
    // Also the regex-escaped and mixed-case spellings in tests.
    file: /./,
    from: /\bcommunities([\x5c]*\.)buzz\1xyz\b/g,
    to: (_, dot) => `workspace${dot}mira-ai${dot}ro`,
  },
  {
    file: /./,
    from: /\bCommunities\.BUZZ\.xyz\b/g,
    to: () => "Workspace.MIRA-AI.ro",
  },
  {
    // The executable would otherwise keep the Cargo package's name.
    file: /^src-tauri\/tauri\.conf\.json$/,
    from: /("productName": "Mira",)(?!\s*"mainBinaryName")/,
    to: (_, head) => `${head}\n  "mainBinaryName": "Mira",`,
  },
  {
    // Installer file names follow productName.
    file: /^(\.github\/workflows|scripts)\//,
    from: /\bBuzz(?=_)/g,
    to: () => "Mira",
  },
  {
    // Same length as upstream's, so no line ever reflows under a formatter.
    // `xyz.block.buzz.app` stays: it is where old Buzz keeps data to import.
    file: /./,
    from: /xyz([\x5c]*\.)block\1buzz\1desktop\b/g,
    to: (_, dot) => `ro${dot}miraai${dot}mira${dot}desktop`,
  },
  {
    // Hosted services, also the same length. See mira-cloud for the server.
    file: /./,
    from: /\bapp\.builderlab\.xyz\b/g,
    to: () => "account.mira-ai.ro",
  },
  {
    file: /./,
    from: /\bcommunities\.buzz\.xyz\b/g,
    to: () => "workspace.mira-ai.ro",
  },
  {
    // Block's relay key. Mira's own is known only after the first deployment.
    file: /./,
    from: /12f6870117eff1a6318bd38c82a65d51dd19879b7489f57247114d0ee8a96de3/g,
    to: () => "0".repeat(64),
  },
  {
    // Upstream installs as "Buzz Foundation" on Windows and Linux.
    file: /./,
    from: /\bMira Foundation\b/g,
    to: () => "Mira",
  },
  {
    // Releases and the update feed belong to this fork.
    file: /^(\.github\/workflows|scripts|tests\/integration)\//,
    from: /\bblock\/buzz-app\b/g,
    to: () => "andreimironstv/mira-app",
  },
  {
    // Never verify updates with Block's key. No key disables the updater.
    file: /^\.github\/workflows\/release\.yml$/,
    from: /(BUZZ_UPDATER_PUBLIC_KEY: \$\{\{ !inputs\.candidates && )'[^']+'/,
    to: (_, head) => `${head}vars.MIRA_UPDATER_PUBLIC_KEY`,
  },
  {
    file: /^scripts\/preview-feed\.mjs$/,
    from: /const publicKeyBase64 =\s*"[^"]+"/,
    to: () =>
      'const publicKeyBase64 = process.env.MIRA_UPDATER_PUBLIC_KEY ?? ""',
  },
  {
    // The longer repository name no longer fits on one line.
    file: /^scripts\/prune-preview-releases\.mjs$/,
    from: /assert\.equal\(repository, "([^"]+)", "([^"]+)"\);/,
    to: (_, repo, message) =>
      `assert.equal(\n  repository,\n  "${repo}",\n  "${message}",\n);`,
  },
  {
    file: /^src\/features\/agents\/share-card\.ts$/,
    from: /(const MARK =\s*)"[^"]+"/,
    to: (_, head) => `${head}${JSON.stringify(markPath64())}`,
  },
];

function markPath64() {
  return readFileSync(
    join(ROOT, "rebrand/brand/mira-mark-64.txt"),
    "utf8",
  ).trim();
}

function inScope(path) {
  return (
    IN_SCOPE.some((re) => re.test(path)) &&
    !OUT_OF_SCOPE.some((re) => re.test(path))
  );
}

/** The branded form of a file's text. Pure, so sync can compare it to history. */
export function transform(path, text) {
  if (!inScope(path)) return text;
  const comment = COMMENT_BY_EXT[path.split(".").pop()];
  let out = text;
  if (out.includes("Buzz")) {
    out = out
      .split("\n")
      .map((line) =>
        !line.includes("Buzz") ||
        comment?.test(line) ||
        PROTECTED_LINE.some((re) => re.test(line))
          ? line
          : line.replace(PRODUCT_NAME, "Mira"),
      )
      .join("\n");
  }
  for (const rule of FILE_RULES) {
    if (rule.file.test(path)) out = out.replace(rule.from, rule.to);
  }
  return out;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

export function overlayFiles() {
  if (!existsSync(OVERLAY)) return [];
  return walk(OVERLAY).map((file) =>
    relative(OVERLAY, file).split(sep).join("/"),
  );
}

function run({ check }) {
  const stale = [];
  const overlay = overlayFiles();
  for (const path of overlay) {
    const from = join(OVERLAY, path);
    const to = join(ROOT, path);
    if (existsSync(to) && readFileSync(from).equals(readFileSync(to))) continue;
    stale.push(path);
    if (!check) cpSync(from, to);
  }
  const overlaid = new Set(overlay);
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    maxBuffer: 1 << 28,
    encoding: "utf8",
  }).split("\0");
  for (const path of tracked) {
    if (!path || overlaid.has(path) || !inScope(path)) continue;
    const full = join(ROOT, path);
    if (!existsSync(full)) continue;
    const bytes = readFileSync(full);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) continue;
    const branded = transform(path, text);
    if (branded === text) continue;
    stale.push(path);
    if (!check) writeFileSync(full, branded);
  }
  if (check) {
    for (const path of stale) console.error(`unbranded: ${path}`);
    console.log(
      stale.length
        ? `${stale.length} files need branding`
        : "Branding is up to date",
    );
    process.exit(stale.length ? 1 : 0);
  }
  console.log(`Branded ${stale.length} files`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run({ check: process.argv.includes("--check") });
}
