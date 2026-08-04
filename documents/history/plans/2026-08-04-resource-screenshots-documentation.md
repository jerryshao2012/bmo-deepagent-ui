# Resource Screenshot Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move nine original `resources/` PNGs unchanged into maintained
documentation assets and embed each once in accurate, focused product guidance.

**Architecture:** Verify staged sources read-only, move original bytes to nine
clean `documents/assets/screenshots/` destinations, and prove destination hashes
and dimensions match source manifest before changing Git index. Reference moved
assets from three new feature guides and existing LLM Wiki guide. Protect every
unrelated staged, tracked-worktree, and untracked path at each commit gate.

**Tech Stack:** Markdown, original PNG assets, filesystem moves, Git path-limited
index operations and commits, Prettier, ESLint, macOS `sips`, Node.js, `shasum`,
`rg`, and `@verification-before-completion`.

**Execution constraint:** Work inline on current dirty `main` worktree. Nine
source PNGs already exist as staged additions. Do not create branch, worktree, or
clean checkout. Do not generate, transform, resize, crop, recolor, or otherwise
edit screenshots. Only exact move and index commands in Task 3 may change image
paths.

---

## File map

**Move unchanged**

- `resources/Deep_Research 2026-04-03 at 12 44 11 PM.png` →
  `documents/assets/screenshots/deep-research-completed-run.png`
- `resources/LangSmith_Integration 2026-04-03 at 10 27 11 AM.png` →
  `documents/assets/screenshots/langsmith-trace-inspection.png`
- `resources/LLM_Wiki_Index-20260723-qcgl.png` →
  `documents/assets/screenshots/llm-wiki-index.png`
- `resources/LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png` →
  `documents/assets/screenshots/llm-wiki-document-citation.png`
- `resources/LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png` →
  `documents/assets/screenshots/llm-wiki-grounded-query.png`
- `resources/Skills - Configuration_Skills-20260723-pznq.png` →
  `documents/assets/screenshots/skills-configuration.png`
- `resources/Skills - Available Skills-20260723-pztn.png` →
  `documents/assets/screenshots/skills-catalog.png`
- `resources/Skills - Apply a Skill-20260723-qaar.png` →
  `documents/assets/screenshots/skills-application-request.png`
- `resources/Skills - Result of Applying a Skill-20260723-qaee.png` →
  `documents/assets/screenshots/skills-application-result.png`

**Create**

- `documents/features/deep-research.md` - Deep Research workflow with one asset.
- `documents/features/langsmith-integration.md` - external LangSmith inspection
  guide with one asset.
- `documents/features/skills.md` - skills workflow with four assets.

**Modify**

- `documents/llm-wiki/llm-wiki.md:41-100` - add Wiki index asset.
- `documents/llm-wiki/llm-wiki.md:175-254` - add citation and grounded-query
  assets.
- `documents/README.md:6-33` - add Features section.

### Task 1: Preserve pinned baseline and repository safeguards

**Files:**

- Read: Git index, working tree, and `/tmp/bmo-resource-screenshot-*`
- Do not modify repository files

- [x] **Step 1: Confirm immutable base and protected diff hashes**

Run:

```bash
set -euo pipefail
test "$(sed -n '1p' /tmp/bmo-resource-screenshot-base-head.txt)" = "986f1dba8f2e6d2592749de410b699ce9c8ffdcf"
test "$(sed -n '1p' /tmp/bmo-resource-screenshot-protected-cached.sha256)" = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  -"
test "$(sed -n '1p' /tmp/bmo-resource-screenshot-protected-worktree.sha256)" = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  -"
```

Expected: all assertions exit `0`. Base remains pinned to
`986f1dba8f2e6d2592749de410b699ce9c8ffdcf`. Never overwrite base file or rerun
`git rev-parse HEAD` to reset it after design/plan revision commits.

- [x] **Step 2: Preserve exact source manifest**

Expected immutable manifest:

| Source                                                  | Dimensions | SHA-256                                                            |
| ------------------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| `Deep_Research 2026-04-03 at 12 44 11 PM.png`           | 1917x945   | `f8c30c260e8fba34af5afa6d1eb18831b310eae5b5dc03a2d4c06a2e5ad4a3d2` |
| `LangSmith_Integration 2026-04-03 at 10 27 11 AM.png`   | 1915x947   | `b1775cdbf26980cd4dfa9af951af2cf5cdae8940fc68d8e3ef351fafabe78edb` |
| `LLM_Wiki_Index-20260723-qcgl.png`                      | 1922x862   | `dcc7758e29eeb79ebf1104e14068078c90edc95adb736891b2080c4b4334e186` |
| `LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png`           | 1909x868   | `1a7aee54240da18fe9a7b82d786631df85051abd55edad500737d1ee5dce6a44` |
| `LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png`          | 1918x930   | `5caf2a88da414410f5b20d6a67884febb95ac0e969977243eaa3776aedf30aa9` |
| `Skills - Configuration_Skills-20260723-pznq.png`       | 1901x849   | `ffac5f511dcafc0eddc3adf284d28e431d384d0fb585b714e0eef9549b087508` |
| `Skills - Available Skills-20260723-pztn.png`           | 1904x867   | `81fa98450b75a53f04e9923c38ac661938fa046b9afa439f3ae589c3bf7881d0` |
| `Skills - Apply a Skill-20260723-qaar.png`              | 1906x869   | `09faf6406458c0f473cf026d931231cc458336ce2005f7a4b238f1b3bbb63005` |
| `Skills - Result of Applying a Skill-20260723-qaee.png` | 1910x856   | `357342f23ea385ebe1b39f375fdbd0f281ab40e337f838cb2f6a25e23c5b838e` |

Expected staged-source binary hash:
`9f1cddc46a09edf39d9663d91af3986ca9e1076d793e66869be3e841669cb2df`.

- [x] **Step 3: Preserve failing pre-implementation embed check**

Pinned-base evidence showed none of nine destination names in four active guides.
Do not rerun this red check after implementation begins.

- [ ] **Step 4: Restore missing unrelated-untracked baseline before Task 2**

Task 1 evidence recorded no untracked files at pinned base. Run:

```bash
set -euo pipefail
test "$(sed -n '1p' /tmp/bmo-resource-screenshot-base-head.txt)" = "986f1dba8f2e6d2592749de410b699ce9c8ffdcf"
git ls-files --others --exclude-standard | LC_ALL=C sort > /tmp/bmo-resource-screenshot-untracked-now.txt
if test -s /tmp/bmo-resource-screenshot-untracked-now.txt; then sed -n '1,200p' /tmp/bmo-resource-screenshot-untracked-now.txt; echo "STOP: unrelated untracked state differs from empty Task 1 evidence" >&2; exit 1; fi
: > /tmp/bmo-resource-screenshot-protected-untracked.txt
test ! -s /tmp/bmo-resource-screenshot-protected-untracked.txt
printf '%s\0' \
  ':(exclude)resources/Deep_Research 2026-04-03 at 12 44 11 PM.png' \
  ':(exclude)resources/LangSmith_Integration 2026-04-03 at 10 27 11 AM.png' \
  ':(exclude)resources/LLM_Wiki_Index-20260723-qcgl.png' \
  ':(exclude)resources/LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png' \
  ':(exclude)resources/LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png' \
  ':(exclude)resources/Skills - Configuration_Skills-20260723-pznq.png' \
  ':(exclude)resources/Skills - Available Skills-20260723-pztn.png' \
  ':(exclude)resources/Skills - Apply a Skill-20260723-qaar.png' \
  ':(exclude)resources/Skills - Result of Applying a Skill-20260723-qaee.png' \
  ':(exclude)documents/assets/screenshots/deep-research-completed-run.png' \
  ':(exclude)documents/assets/screenshots/langsmith-trace-inspection.png' \
  ':(exclude)documents/assets/screenshots/llm-wiki-index.png' \
  ':(exclude)documents/assets/screenshots/llm-wiki-document-citation.png' \
  ':(exclude)documents/assets/screenshots/llm-wiki-grounded-query.png' \
  ':(exclude)documents/assets/screenshots/skills-configuration.png' \
  ':(exclude)documents/assets/screenshots/skills-catalog.png' \
  ':(exclude)documents/assets/screenshots/skills-application-request.png' \
  ':(exclude)documents/assets/screenshots/skills-application-result.png' \
  ':(exclude)documents/features/deep-research.md' \
  ':(exclude)documents/features/langsmith-integration.md' \
  ':(exclude)documents/features/skills.md' \
  ':(exclude)documents/README.md' \
  ':(exclude)documents/llm-wiki/llm-wiki.md' \
  > /tmp/bmo-resource-screenshot-protected-excludes.pathspecs
test "$(perl -0ne 'END { print $. }' /tmp/bmo-resource-screenshot-protected-excludes.pathspecs)" -eq 23
```

Expected: current unrelated-untracked list is empty, then empty protected baseline
and exact 23-path exclusion file are created and verified. No paths are excluded
from unrelated-untracked check because plan/spec are committed and Task 2 is
read-only. If list is nonempty, stop and compare with Task 1 evidence; never
silently baseline new paths.

### Task 2: Verify original sources for unchanged moves

**Files:**

- Read: exact nine `resources/*.png` sources from file map
- Do not create or modify files

- [ ] **Step 1: Assert exact source inventory, format, dimensions, and hashes**

Run:

```bash
set -euo pipefail
node -e 'const fs=require("fs"),path=require("path"),crypto=require("crypto");const expected={"Deep_Research 2026-04-03 at 12 44 11 PM.png":[1917,945,"f8c30c260e8fba34af5afa6d1eb18831b310eae5b5dc03a2d4c06a2e5ad4a3d2"],"LangSmith_Integration 2026-04-03 at 10 27 11 AM.png":[1915,947,"b1775cdbf26980cd4dfa9af951af2cf5cdae8940fc68d8e3ef351fafabe78edb"],"LLM_Wiki_Index-20260723-qcgl.png":[1922,862,"dcc7758e29eeb79ebf1104e14068078c90edc95adb736891b2080c4b4334e186"],"LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png":[1909,868,"1a7aee54240da18fe9a7b82d786631df85051abd55edad500737d1ee5dce6a44"],"LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png":[1918,930,"5caf2a88da414410f5b20d6a67884febb95ac0e969977243eaa3776aedf30aa9"],"Skills - Configuration_Skills-20260723-pznq.png":[1901,849,"ffac5f511dcafc0eddc3adf284d28e431d384d0fb585b714e0eef9549b087508"],"Skills - Available Skills-20260723-pztn.png":[1904,867,"81fa98450b75a53f04e9923c38ac661938fa046b9afa439f3ae589c3bf7881d0"],"Skills - Apply a Skill-20260723-qaar.png":[1906,869,"09faf6406458c0f473cf026d931231cc458336ce2005f7a4b238f1b3bbb63005"],"Skills - Result of Applying a Skill-20260723-qaee.png":[1910,856,"357342f23ea385ebe1b39f375fdbd0f281ab40e337f838cb2f6a25e23c5b838e"]};const names=Object.keys(expected).sort(),actual=fs.readdirSync("resources").filter(f=>f.endsWith(".png")).sort(),bad=[];if(JSON.stringify(actual)!==JSON.stringify(names))bad.push({inventory:{expected:names,actual}});for(const n of names){const b=fs.readFileSync(path.join("resources",n)),w=b.readUInt32BE(16),h=b.readUInt32BE(20),hash=crypto.createHash("sha256").update(b).digest("hex"),want=expected[n];if(b.toString("ascii",1,4)!=="PNG"||w!==want[0]||h!==want[1]||hash!==want[2])bad.push({name:n,w,h,hash,want})}if(bad.length){console.error(bad);process.exit(1)}console.log("exact nine source PNGs match immutable manifest")'
test "$(git diff --cached --binary -- resources | shasum -a 256)" = "9f1cddc46a09edf39d9663d91af3986ca9e1076d793e66869be3e841669cb2df  -"
```

Expected: source assertion succeeds and staged binary hash equals
`9f1cddc46a09edf39d9663d91af3986ca9e1076d793e66869be3e841669cb2df`.
Missing, corrupt, changed, or extra resource PNG blocks move.

- [ ] **Step 2: Inspect all nine originals at readable scale**

Open every source with `view_image` at original detail. Confirm image is legible,
demonstrates mapped workflow, and contains no visible API key, bearer or session
token, password, or other actual secret. Prior inspection found none.

User approved publication as-is, including visible avatars and browser,
LangSmith, and thread identifiers. Record those as accepted content. Actual
secret or product-behavior mismatch blocks move; do not change screenshot.

### Task 3: Move unchanged originals and commit destinations

**Files:**

- Move: exact nine source/destination pairs from file map
- Commit: exact nine `documents/assets/screenshots/*.png` destinations
- Protect: every unrelated staged, tracked-worktree, and untracked path

- [ ] **Step 1: Verify source and protected state immediately before move**

Run:

```bash
set -euo pipefail
test "$(perl -0ne 'END { print $. }' /tmp/bmo-resource-screenshot-protected-excludes.pathspecs)" -eq 23
git diff --cached --binary -- resources | shasum -a 256 | grep -F '9f1cddc46a09edf39d9663d91af3986ca9e1076d793e66869be3e841669cb2df'
xargs -0 git diff --cached --binary -- . < /tmp/bmo-resource-screenshot-protected-excludes.pathspecs | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-cached.sha256 -
xargs -0 git diff --binary -- . < /tmp/bmo-resource-screenshot-protected-excludes.pathspecs | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-worktree.sha256 -
git ls-files --others --exclude-standard | LC_ALL=C sort | diff -u /tmp/bmo-resource-screenshot-protected-untracked.txt -
```

Expected: source hash and all protected comparisons exit `0`.

- [ ] **Step 2: Move exact original files**

Run:

```bash
set -euo pipefail
if test -e documents/assets/screenshots; then
  test -d documents/assets/screenshots
  test -z "$(find documents/assets/screenshots -mindepth 1 -maxdepth 1 -print -quit)"
fi
for destination in \
  documents/assets/screenshots/deep-research-completed-run.png \
  documents/assets/screenshots/langsmith-trace-inspection.png \
  documents/assets/screenshots/llm-wiki-index.png \
  documents/assets/screenshots/llm-wiki-document-citation.png \
  documents/assets/screenshots/llm-wiki-grounded-query.png \
  documents/assets/screenshots/skills-configuration.png \
  documents/assets/screenshots/skills-catalog.png \
  documents/assets/screenshots/skills-application-request.png \
  documents/assets/screenshots/skills-application-result.png; do
  test ! -e "$destination"
done
mkdir -p documents/assets/screenshots
mv "resources/Deep_Research 2026-04-03 at 12 44 11 PM.png" documents/assets/screenshots/deep-research-completed-run.png
mv "resources/LangSmith_Integration 2026-04-03 at 10 27 11 AM.png" documents/assets/screenshots/langsmith-trace-inspection.png
mv "resources/LLM_Wiki_Index-20260723-qcgl.png" documents/assets/screenshots/llm-wiki-index.png
mv "resources/LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png" documents/assets/screenshots/llm-wiki-document-citation.png
mv "resources/LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png" documents/assets/screenshots/llm-wiki-grounded-query.png
mv "resources/Skills - Configuration_Skills-20260723-pznq.png" documents/assets/screenshots/skills-configuration.png
mv "resources/Skills - Available Skills-20260723-pztn.png" documents/assets/screenshots/skills-catalog.png
mv "resources/Skills - Apply a Skill-20260723-qaar.png" documents/assets/screenshots/skills-application-request.png
mv "resources/Skills - Result of Applying a Skill-20260723-qaee.png" documents/assets/screenshots/skills-application-result.png
```

Expected: nine originals now exist only at mapped destinations. Do not change
index yet.

- [ ] **Step 3: Prove destination bytes before index change**

Run:

```bash
node -e 'const fs=require("fs"),path=require("path"),crypto=require("crypto");const expected={"deep-research-completed-run.png":[1917,945,"f8c30c260e8fba34af5afa6d1eb18831b310eae5b5dc03a2d4c06a2e5ad4a3d2"],"langsmith-trace-inspection.png":[1915,947,"b1775cdbf26980cd4dfa9af951af2cf5cdae8940fc68d8e3ef351fafabe78edb"],"llm-wiki-index.png":[1922,862,"dcc7758e29eeb79ebf1104e14068078c90edc95adb736891b2080c4b4334e186"],"llm-wiki-document-citation.png":[1909,868,"1a7aee54240da18fe9a7b82d786631df85051abd55edad500737d1ee5dce6a44"],"llm-wiki-grounded-query.png":[1918,930,"5caf2a88da414410f5b20d6a67884febb95ac0e969977243eaa3776aedf30aa9"],"skills-configuration.png":[1901,849,"ffac5f511dcafc0eddc3adf284d28e431d384d0fb585b714e0eef9549b087508"],"skills-catalog.png":[1904,867,"81fa98450b75a53f04e9923c38ac661938fa046b9afa439f3ae589c3bf7881d0"],"skills-application-request.png":[1906,869,"09faf6406458c0f473cf026d931231cc458336ce2005f7a4b238f1b3bbb63005"],"skills-application-result.png":[1910,856,"357342f23ea385ebe1b39f375fdbd0f281ab40e337f838cb2f6a25e23c5b838e"]};const dir="documents/assets/screenshots",actual=fs.readdirSync(dir).filter(f=>f.endsWith(".png")).sort(),names=Object.keys(expected).sort(),bad=[];if(JSON.stringify(actual)!==JSON.stringify(names))bad.push({inventory:{expected:names,actual}});for(const n of names){const b=fs.readFileSync(path.join(dir,n)),w=b.readUInt32BE(16),h=b.readUInt32BE(20),hash=crypto.createHash("sha256").update(b).digest("hex"),want=expected[n];if(b.toString("ascii",1,4)!=="PNG"||w!==want[0]||h!==want[1]||hash!==want[2])bad.push({name:n,w,h,hash,want})}const old=fs.existsSync("resources")?fs.readdirSync("resources").filter(f=>f.endsWith(".png")):[];if(old.length)bad.push({remainingResourcePngs:old});if(bad.length){console.error(bad);process.exit(1)}console.log("nine moved destinations exactly match source manifest")'
```

Expected: assertion exits `0`. Any mismatch blocks index change.

- [ ] **Step 4: Replace exact source index entries with destinations**

Run:

```bash
set -euo pipefail
git restore --staged -- "resources/Deep_Research 2026-04-03 at 12 44 11 PM.png" "resources/LangSmith_Integration 2026-04-03 at 10 27 11 AM.png" "resources/LLM_Wiki_Index-20260723-qcgl.png" "resources/LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png" "resources/LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png" "resources/Skills - Configuration_Skills-20260723-pznq.png" "resources/Skills - Available Skills-20260723-pztn.png" "resources/Skills - Apply a Skill-20260723-qaar.png" "resources/Skills - Result of Applying a Skill-20260723-qaee.png"
git add documents/assets/screenshots/deep-research-completed-run.png documents/assets/screenshots/langsmith-trace-inspection.png documents/assets/screenshots/llm-wiki-index.png documents/assets/screenshots/llm-wiki-document-citation.png documents/assets/screenshots/llm-wiki-grounded-query.png documents/assets/screenshots/skills-configuration.png documents/assets/screenshots/skills-catalog.png documents/assets/screenshots/skills-application-request.png documents/assets/screenshots/skills-application-result.png
```

Expected: source additions leave index; exact nine destinations enter index.

- [ ] **Step 5: Verify staged mapping and protected state**

Run:

```bash
set -euo pipefail
node -e 'const cp=require("child_process");const expected=["documents/assets/screenshots/deep-research-completed-run.png","documents/assets/screenshots/langsmith-trace-inspection.png","documents/assets/screenshots/llm-wiki-index.png","documents/assets/screenshots/llm-wiki-document-citation.png","documents/assets/screenshots/llm-wiki-grounded-query.png","documents/assets/screenshots/skills-configuration.png","documents/assets/screenshots/skills-catalog.png","documents/assets/screenshots/skills-application-request.png","documents/assets/screenshots/skills-application-result.png"].map(p=>`A\t${p}`).sort();const actual=cp.execFileSync("git",["diff","--cached","--name-status","--","resources","documents/assets/screenshots"],{encoding:"utf8"}).trim().split("\n").filter(Boolean).sort();if(JSON.stringify(actual)!==JSON.stringify(expected)){console.error({expected,actual});process.exit(1)}console.log("index contains exact nine destination additions")'
xargs -0 git diff --cached --binary -- . < /tmp/bmo-resource-screenshot-protected-excludes.pathspecs | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-cached.sha256 -
xargs -0 git diff --binary -- . < /tmp/bmo-resource-screenshot-protected-excludes.pathspecs | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-worktree.sha256 -
git ls-files --others --exclude-standard | LC_ALL=C sort | diff -u /tmp/bmo-resource-screenshot-protected-untracked.txt -
```

Expected: exact mapping assertion and all protected comparisons exit `0`.

- [ ] **Step 6: Commit only nine destinations**

Run:

```bash
git commit --only -m "docs: add product screenshots" -- documents/assets/screenshots/deep-research-completed-run.png documents/assets/screenshots/langsmith-trace-inspection.png documents/assets/screenshots/llm-wiki-index.png documents/assets/screenshots/llm-wiki-document-citation.png documents/assets/screenshots/llm-wiki-grounded-query.png documents/assets/screenshots/skills-configuration.png documents/assets/screenshots/skills-catalog.png documents/assets/screenshots/skills-application-request.png documents/assets/screenshots/skills-application-result.png
```

Expected: commit contains exact nine unchanged destinations.

- [ ] **Step 7: Gate resource commit and protected state**

Run immediately after Step 6:

```bash
set -euo pipefail
node -e 'const cp=require("child_process");const expected=["documents/assets/screenshots/deep-research-completed-run.png","documents/assets/screenshots/langsmith-trace-inspection.png","documents/assets/screenshots/llm-wiki-index.png","documents/assets/screenshots/llm-wiki-document-citation.png","documents/assets/screenshots/llm-wiki-grounded-query.png","documents/assets/screenshots/skills-configuration.png","documents/assets/screenshots/skills-catalog.png","documents/assets/screenshots/skills-application-request.png","documents/assets/screenshots/skills-application-result.png"].sort();const actual=cp.execFileSync("git",["diff-tree","--no-commit-id","--name-only","-r","HEAD"],{encoding:"utf8"}).trim().split("\n").filter(Boolean).sort();if(JSON.stringify(actual)!==JSON.stringify(expected)){console.error({expected,actual});process.exit(1)}console.log("resource commit contains exact nine destinations")'
xargs -0 git diff --cached --binary -- . < /tmp/bmo-resource-screenshot-protected-excludes.pathspecs | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-cached.sha256 -
xargs -0 git diff --binary -- . < /tmp/bmo-resource-screenshot-protected-excludes.pathspecs | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-worktree.sha256 -
git ls-files --others --exclude-standard | LC_ALL=C sort | diff -u /tmp/bmo-resource-screenshot-protected-untracked.txt -
```

Expected: exact commit assertion and all protected comparisons exit `0`.

### Task 4: Add focused feature guides

**Files:**

- Create: `documents/features/deep-research.md`
- Create: `documents/features/langsmith-integration.md`
- Create: `documents/features/skills.md`

- [ ] **Step 1: Write code-grounded Deep Research guide**

Use `context_search` for request submission, task/tool activity, rendered results,
and generated state-file access. Expand only relevant chunks from `README.md`,
`src/app/components/ChatInterface.tsx`, and
`src/app/components/TasksFilesSidebar.tsx`. Use exact embed and caption:

```markdown
![Completed Deep Research run showing tool activity and generated report](../assets/screenshots/deep-research-completed-run.png)

_Completed run keeps tool progress, rendered report, and generated state files in one workflow._
```

- [ ] **Step 2: Write maintained-guide-grounded LangSmith guide**

Use `context_search` for LangSmith and tracing configuration in root `README.md`
and maintained guides. Cover external LangSmith Studio inspection; do not claim UI
opens LangSmith, constructs trace links, or configures tracing. Use exact embed:

```markdown
![LangSmith Studio graph and trace panels for a completed research run](../assets/screenshots/langsmith-trace-inspection.png)

_Trace view correlates graph nodes, timing, tool calls, model calls, inputs, and outputs._
```

- [ ] **Step 3: Write code-grounded Skills guide**

Use `context_search` for live backend status, search, prompt drafting, and returned
output in `ConfigDialog.tsx`, `SkillsDrawer.tsx`, `buildSkillDraftPrompt.ts`, and
`http-skills-gateway.ts`. Place exact embeds in workflow order:

```markdown
![Skills tab showing backend status and available agent skills](../assets/screenshots/skills-configuration.png)

_Configuration distinguishes live backend skill data from an unavailable or disconnected backend._

![Available Skills drawer with searchable capabilities](../assets/screenshots/skills-catalog.png)

_Searchable catalog helps choose a capability without leaving current thread._

![Chat request prepared to invoke a selected skill](../assets/screenshots/skills-application-request.png)

_Selecting a skill prepares explicit invocation text while preserving current thread context._

![Rendered result returned after applying the selected skill](../assets/screenshots/skills-application-result.png)

_Completed response shows skill output in same conversation where it was requested._
```

- [ ] **Step 4: Format, check, and commit three guides**

Run:

```bash
set -euo pipefail
yarn prettier --write documents/features/deep-research.md documents/features/langsmith-integration.md documents/features/skills.md
yarn prettier --check documents/features/deep-research.md documents/features/langsmith-integration.md documents/features/skills.md
git diff --check -- documents/features/deep-research.md documents/features/langsmith-integration.md documents/features/skills.md
git add documents/features/deep-research.md documents/features/langsmith-integration.md documents/features/skills.md
git commit --only -m "docs: add illustrated feature guides" -- documents/features/deep-research.md documents/features/langsmith-integration.md documents/features/skills.md
```

Expected: commit succeeds with three guides only.

- [ ] **Step 5: Gate guide commit and protected state**

Run immediately after Step 4:

```bash
set -euo pipefail
node -e 'const cp=require("child_process");const expected=["documents/features/deep-research.md","documents/features/langsmith-integration.md","documents/features/skills.md"].sort();const actual=cp.execFileSync("git",["diff-tree","--no-commit-id","--name-only","-r","HEAD"],{encoding:"utf8"}).trim().split("\n").filter(Boolean).sort();if(JSON.stringify(actual)!==JSON.stringify(expected)){console.error({expected,actual});process.exit(1)}console.log("guide commit contains exact three paths")'
xargs -0 git diff --cached --binary -- . < /tmp/bmo-resource-screenshot-protected-excludes.pathspecs | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-cached.sha256 -
xargs -0 git diff --binary -- . < /tmp/bmo-resource-screenshot-protected-excludes.pathspecs | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-worktree.sha256 -
git ls-files --others --exclude-standard | LC_ALL=C sort | diff -u /tmp/bmo-resource-screenshot-protected-untracked.txt -
```

Expected: exact commit assertion and all protected comparisons exit `0`.

### Task 5: Embed LLM Wiki assets and update index

**Files:**

- Modify: `documents/llm-wiki/llm-wiki.md:41-100`
- Modify: `documents/llm-wiki/llm-wiki.md:175-254`
- Modify: `documents/README.md:6-33`

- [ ] **Step 1: Add three exact Wiki embeds and captions**

Place each beside mapped workflow:

```markdown
![LLM Wiki workspace tree open beside its generated index](../assets/screenshots/llm-wiki-index.png)

_Workspace tree exposes generated Wiki files for inspection without replacing original source evidence._

![Grounded LLM Wiki answer linked to corresponding PDF page](../assets/screenshots/llm-wiki-document-citation.png)

_Citation links let readers compare grounded answer with relevant original document page._

![Grounded financial answer shown beside supporting annual-report evidence](../assets/screenshots/llm-wiki-grounded-query.png)

_Grounded query output remains connected to original report used as evidence._
```

- [ ] **Step 2: Add Features section to documentation index**

Add after Architecture:

```markdown
### Features

- [Deep Research workflow](features/deep-research.md) - run research, follow tool
  activity, and review generated results and files.
- [LangSmith trace inspection](features/langsmith-integration.md) - inspect graph
  execution, timing, tool/model calls, inputs, and outputs in LangSmith Studio.
- [Agent skills](features/skills.md) - configure, discover, select, apply, and
  review agent skills.
```

- [ ] **Step 3: Format, check, and commit index/Wiki guide**

Run:

```bash
set -euo pipefail
yarn prettier --write documents/README.md documents/llm-wiki/llm-wiki.md
yarn prettier --check documents/README.md documents/llm-wiki/llm-wiki.md documents/features/*.md
git diff --check -- documents/README.md documents/llm-wiki/llm-wiki.md
git add documents/README.md documents/llm-wiki/llm-wiki.md
git commit --only -m "docs: embed screenshots in active guides" -- documents/README.md documents/llm-wiki/llm-wiki.md
```

Expected: commit succeeds with index and LLM Wiki guide only.

- [ ] **Step 4: Gate index/Wiki commit and protected state**

Run immediately after Step 3:

```bash
set -euo pipefail
node -e 'const cp=require("child_process");const expected=["documents/README.md","documents/llm-wiki/llm-wiki.md"].sort();const actual=cp.execFileSync("git",["diff-tree","--no-commit-id","--name-only","-r","HEAD"],{encoding:"utf8"}).trim().split("\n").filter(Boolean).sort();if(JSON.stringify(actual)!==JSON.stringify(expected)){console.error({expected,actual});process.exit(1)}console.log("index/Wiki commit contains exact two paths")'
xargs -0 git diff --cached --binary -- . < /tmp/bmo-resource-screenshot-protected-excludes.pathspecs | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-cached.sha256 -
xargs -0 git diff --binary -- . < /tmp/bmo-resource-screenshot-protected-excludes.pathspecs | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-worktree.sha256 -
git ls-files --others --exclude-standard | LC_ALL=C sort | diff -u /tmp/bmo-resource-screenshot-protected-untracked.txt -
```

Expected: exact commit assertion and all protected comparisons exit `0`.

### Task 6: Run full asset, embed, secret, and repository verification

**Files:**

- Verify: nine destinations and four active guides
- Protect: every unrelated staged, tracked-worktree, and untracked path

- [ ] **Step 1: Assert final asset inventory, hashes, and dimensions**

Re-run Task 3 Step 3 destination-manifest assertion. Then run:

```bash
set -euo pipefail
test -z "$(find resources -maxdepth 1 -type f -name '*.png' -print)"
test "$(find documents/assets/screenshots -mindepth 1 -maxdepth 1 | wc -l | awk '{print $1}')" -eq 9
```

Expected: exactly nine mapped destination files, zero resource PNGs, and every
destination hash/dimension equals original source manifest. Exact inventory rules
out intermediate or generated image artifacts.

- [ ] **Step 2: Verify exact `1+1+4+3` embeds and single filename occurrences**

Run:

````bash
node -e 'const fs=require("fs");const expected={"documents/features/deep-research.md":["../assets/screenshots/deep-research-completed-run.png"],"documents/features/langsmith-integration.md":["../assets/screenshots/langsmith-trace-inspection.png"],"documents/features/skills.md":["../assets/screenshots/skills-configuration.png","../assets/screenshots/skills-catalog.png","../assets/screenshots/skills-application-request.png","../assets/screenshots/skills-application-result.png"],"documents/llm-wiki/llm-wiki.md":["../assets/screenshots/llm-wiki-index.png","../assets/screenshots/llm-wiki-document-citation.png","../assets/screenshots/llm-wiki-grounded-query.png"]};const bad=[],texts=[];for(const [f,want] of Object.entries(expected)){const t=fs.readFileSync(f,"utf8").replace(/```[\s\S]*?```/g,"");texts.push(t);const got=[...t.matchAll(/!\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["\x27][^"\x27]*["\x27])?\)/g)].map(m=>m[1].replace(/^<|>$/g,"")).filter(u=>u.includes("../assets/screenshots/"));if(JSON.stringify(got)!==JSON.stringify(want))bad.push({file:f,want,got})}const all=texts.join("\n");for(const p of Object.values(expected).flat()){const n=p.slice("../assets/screenshots/".length),count=all.split(n).length-1;if(count!==1)bad.push({filename:n,count})}if(bad.length){console.error(bad);process.exit(1)}console.log("nine exact embeds match 1+1+4+3 mapping and each filename appears once")'
````

Expected: exact success message. Design and plan records are excluded.

- [ ] **Step 3: Verify all changed active-document links resolve**

Run:

````bash
node -e 'const fs=require("fs"),path=require("path");const md=["documents/README.md","documents/features/deep-research.md","documents/features/langsmith-integration.md","documents/features/skills.md","documents/llm-wiki/llm-wiki.md"],bad=[];for(const f of md){const t=fs.readFileSync(f,"utf8").replace(/```[\s\S]*?```/g,"");for(const m of t.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["\x27][^"\x27]*["\x27])?\)/g)){let u=m[1].replace(/^<|>$/g,"").split("#")[0];if(!u||/^(https?:|mailto:|#)/.test(u))continue;const p=path.resolve(path.dirname(f),u);if(!fs.existsSync(p))bad.push(`${f}: ${u}`)}}if(bad.length){console.error(bad.join("\n"));process.exit(1)}console.log("five active Markdown files: local links resolve")'
````

Expected: all local links resolve; fenced examples and optional angle brackets
are handled.

- [ ] **Step 4: Visually inspect moved originals and scan for actual secrets**

Open all nine destination PNGs with `view_image` at original detail. Confirm
legibility, correct workflow placement, and no actual API key, bearer/session
token, password, or other secret. Visible avatars and browser, LangSmith, and
thread identifiers remain explicitly approved. Actual secret blocks completion;
approved identifiers do not.

Run Markdown credential scan:

```bash
rg -n '(sk-[A-Za-z0-9_-]{16,}|Bearer [A-Za-z0-9._-]{12,}|api[_-]?key[[:space:]]*[:=][[:space:]]*[^<[:space:]]+|session[_-]?token[[:space:]]*[:=][[:space:]]*[^<[:space:]]+)' documents/README.md documents/features documents/llm-wiki/llm-wiki.md --glob '*.md'
```

Expected: no real credential value. Review configuration-name matches manually.

- [ ] **Step 5: Run formatting, lint, diff, and final protected-state checks**

Run:

```bash
set -euo pipefail
BASE_HEAD=$(sed -n '1p' /tmp/bmo-resource-screenshot-base-head.txt)
test "$BASE_HEAD" = "986f1dba8f2e6d2592749de410b699ce9c8ffdcf"
git diff --check
git diff --check "$BASE_HEAD"..HEAD
yarn prettier --check documents/README.md documents/llm-wiki/llm-wiki.md documents/features/*.md documents/history/specifications/2026-08-04-resource-screenshots-documentation-design.md documents/history/plans/2026-08-04-resource-screenshots-documentation.md
yarn lint
git log --oneline "$BASE_HEAD"..HEAD
git diff --name-status "$BASE_HEAD"..HEAD
xargs -0 git diff --cached --binary -- . < /tmp/bmo-resource-screenshot-protected-excludes.pathspecs | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-cached.sha256 -
xargs -0 git diff --binary -- . < /tmp/bmo-resource-screenshot-protected-excludes.pathspecs | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-worktree.sha256 -
git ls-files --others --exclude-standard | LC_ALL=C sort | diff -u /tmp/bmo-resource-screenshot-protected-untracked.txt -
```

Expected: all checks exit `0`. Base-to-HEAD diff includes every approved
design/plan safeguard revision commit after pinned base and Task 3-5 implementation
commits: exact nine destinations, three feature guides, documentation index, and
LLM Wiki guide. No source PNG, application code, generated image, or unrelated
path appears. Never reset base file to newer HEAD.

- [ ] **Step 6: Apply `@verification-before-completion`**

Review fresh Task 6 output before claiming completion. Report exact commits,
nine unchanged destination hashes/dimensions, zero resource PNGs, exact embed and
link checks, secret inspection, lint result, and remaining unrelated state.
