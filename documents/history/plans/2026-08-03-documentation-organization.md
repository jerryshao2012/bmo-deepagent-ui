# Documentation Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Execution constraint:** Work inline in current dirty `main` worktree. Override
> any referenced skill steps that create a branch/worktree, stage, or commit.
> Existing index state belongs to user and must remain byte-for-byte unchanged.

**Goal:** Organize all project documentation under a navigable `documents/` taxonomy and polish every guide, plan, specification, and README.

**Architecture:** Keep root `README.md` as concise project entry point and `documents/README.md` as documentation hub. Group active material by topic, archive dated records under `documents/history/`, update repository-owned references, and preserve runtime `docs/threads/` paths.

**Tech Stack:** Markdown, Mermaid, Git, Node.js test scripts, Yarn

---

### Task 1: Build final document tree

**Files:**

- Create: `documents/README.md`
- Move: `documents/passkey-authentication.md` to `documents/authentication/passkey-authentication.md`
- Move: `documents/vercel-deployment.md` to `documents/deployment/vercel.md`
- Move: `documents/superpowers/plans/*.md` to `documents/history/plans/`
- Move: `documents/superpowers/specs/*.md` to `documents/history/specifications/`
- Modify: `tests/architecture-boundaries.test.mjs`

- [x] **Step 1: Move documents to approved destinations**

Before moving, require each source to exist and each destination to be absent.
Snapshot existing state:

```bash
git diff --cached --binary | shasum -a 256
git diff --binary -- .dockerignore src/generated/backend-api.ts | shasum -a 256
shasum -a 256 .dockerignore src/generated/backend-api.ts
```

Create destinations and use plain filesystem moves so Git index is not altered:

```bash
mkdir -p documents/authentication documents/deployment documents/history/plans documents/history/specifications
mv documents/passkey-authentication.md documents/authentication/passkey-authentication.md
mv documents/vercel-deployment.md documents/deployment/vercel.md
mv documents/superpowers/plans/2026-07-27-oracle-amd-deployment.md documents/history/plans/2026-07-27-oracle-amd-deployment.md
mv documents/superpowers/plans/2026-08-03-passkey-authentication-documentation.md documents/history/plans/2026-08-03-passkey-authentication-documentation.md
mv documents/superpowers/specs/2026-07-27-oracle-amd-deployment-design.md documents/history/specifications/2026-07-27-oracle-amd-deployment-design.md
mv documents/superpowers/specs/2026-08-03-passkey-authentication-documentation-design.md documents/history/specifications/2026-08-03-passkey-authentication-documentation-design.md
```

Do not use `git mv`. Do not change `AGENTS.md`, `CLAUDE.md`, runtime
`docs/threads/` strings, or unrelated files.

- [x] **Step 2: Add documentation index**

Create categorized links for architecture, authentication, deployment, historical plans, and historical specifications. Add short maintenance rules explaining active versus historical content.

- [x] **Step 3: Update path-dependent architecture test**

Change only expected guide path from `docs/architecture/clean-architecture.md` to `documents/architecture/clean-architecture.md`.

- [x] **Step 4: Verify tree and path assertion**

Run:

```bash
rg --files -g '*.md' -g '*.mdx' -g '!node_modules/**' -g '!.git/**' -g '!documents/**' . | sort
rg --files documents -g '*.md' -g '*.mdx' | sort
yarn test:architecture
```

Expected: every document appears once at final path; architecture test passes.

### Task 2: Rewrite root project README

**Files:**

- Modify: `README.md`

- [x] **Step 1: Establish consistent hierarchy**

Use one H1 and ordered H2 sections: overview, prerequisites, quick start, configuration, authentication, usage, deployment, documentation, resources.

- [x] **Step 2: Make commands safe and current**

Correct repository directory name, separate corporate registry setup from standard setup, remove force-kill defaults, use fenced-language annotations, and retain accurate environment settings.

- [x] **Step 3: Consolidate duplicated material**

Merge duplicate usage headings, convert bold pseudo-headings to Markdown headings, improve link labels, and link the documentation hub plus active guides.

- [x] **Step 4: Check root README references**

Run targeted searches for moved paths and duplicate headings. Expected: links use final `documents/` paths and heading hierarchy is consistent.

### Task 3: Polish active and historical documents

**Files:**

- Modify: `documents/architecture/clean-architecture.md`
- Modify: `documents/authentication/passkey-authentication.md`
- Modify: `documents/deployment/vercel.md`
- Modify: `documents/history/plans/*.md`
- Modify: `documents/history/specifications/*.md`

- [x] **Step 1: Polish active guides**

Normalize titles, introductions, heading levels, lists, tables, terminology, and command examples. Remove marketing guarantees from Vercel cost language and avoid embedding deployment-specific example resource names as defaults.

- [x] **Step 2: Polish historical records non-semantically**

Fix spelling, formatting, and navigational references. Preserve original decisions, commands, and historically accurate paths; annotate old paths when they could be mistaken for current guidance.

- [x] **Step 3: Validate Mermaid fences and document structure**

Confirm every fence is balanced and all three passkey `sequenceDiagram` blocks remain intact.

### Task 4: Verify complete migration

**Files:**

- Verify: `README.md`
- Verify: `documents/**/*.md`
- Verify: `tests/architecture-boundaries.test.mjs`

- [x] **Step 1: Check local links and fragments**

Run this repository-local checker for relative files, same-file anchors, and
cross-file fragments:

```bash
node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const files = execFileSync("rg", ["--files", "-g", "*.md", "-g", "*.mdx", "-g", "!node_modules/**", "-g", "!.git/**"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const anchors = new Map();
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const seen = new Map();
  const ids = new Set();
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = match[1].replace(/<[^>]+>/g, "").replace(/[`*_~]/g, "").trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    ids.add(count ? `${base}-${count}` : base);
  }
  anchors.set(path.resolve(file), ids);
}

const errors = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (!raw || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) continue;
    const [targetPart, fragment = ""] = raw.split("#", 2);
    const target = path.resolve(path.dirname(file), decodeURIComponent(targetPart || path.basename(file)));
    if (!fs.existsSync(target)) {
      errors.push(`${file}: missing ${raw}`);
    } else if (fragment && anchors.has(target) && !anchors.get(target).has(decodeURIComponent(fragment).toLowerCase())) {
      errors.push(`${file}: missing fragment ${raw}`);
    }
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Checked ${files.length} Markdown files.`);
NODE
```

Expected: no broken local links or fragments.

- [x] **Step 2: Classify stale path matches**

Run repository-wide search:

```bash
rg --hidden -n 'docs/architecture/|docs/passkey-authentication\.md|docs/vercel-deployment\.md|documents/passkey-authentication\.md|documents/vercel-deployment\.md|documents/superpowers/' . --glob '!node_modules/**' --glob '!.git/**' --glob '!.next/**' --glob '!.yarn/**'
```

Allow matches only inside migration design, verification instructions, or clearly
annotated historical context. Do not modify runtime `docs/threads/` storage paths.

- [x] **Step 3: Run required verification**

```bash
git diff --check
set +e
rg -n '[[:blank:]]+$' README.md documents --glob '*.md'
whitespace_status=$?
set -e
if [ "$whitespace_status" -eq 0 ]; then
  echo "Trailing whitespace found" >&2
  exit 1
elif [ "$whitespace_status" -ne 1 ]; then
  exit "$whitespace_status"
fi
yarn test:architecture
yarn lint
yarn build
```

Expected: commands pass. If environment or pre-existing changes cause failure, capture exact output and identify whether documentation work contributed.

- [x] **Step 4: Inspect final scope**

Review `git status --short` and documentation-focused diff. Repeat snapshots:

```bash
git diff --cached --binary | shasum -a 256
git diff --binary -- .dockerignore src/generated/backend-api.ts | shasum -a 256
shasum -a 256 .dockerignore src/generated/backend-api.ts
```

Confirm all three hashes equal Task 1 baselines. Do not stage or commit
implementation changes because worktree contains pre-existing staged edits; leave
final diff for user review.
