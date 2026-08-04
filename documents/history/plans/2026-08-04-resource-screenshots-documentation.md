# Resource Screenshot Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish nine existing `resources/` screenshots unchanged and embed each
once in accurate, focused product guidance.

**Architecture:** Keep PNGs at current `resources/` paths with current filenames
and commit them through exact pathspecs. Reference them directly from three new
feature guides and existing LLM Wiki guide, then link new guides from documentation
index. Treat screenshots as immutable inputs and preserve every unrelated staged,
tracked-worktree, and untracked path.

**Tech Stack:** Markdown, existing PNG assets, Git path-limited commits,
Prettier, ESLint, macOS `sips`, Node.js, `shasum`, `rg`, and
`@verification-before-completion`.

**Execution constraint:** Work inline on current dirty `main` worktree. Nine PNGs
already exist as staged additions. Do not create branch, worktree, or clean
checkout, and do not alter unrelated index or worktree state. Screenshot
operations are read-only until exact nine-path resource commit.

---

## File map

**Keep unchanged and commit**

- `resources/Deep_Research 2026-04-03 at 12 44 11 PM.png`
- `resources/LangSmith_Integration 2026-04-03 at 10 27 11 AM.png`
- `resources/LLM_Wiki_Index-20260723-qcgl.png`
- `resources/LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png`
- `resources/LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png`
- `resources/Skills - Configuration_Skills-20260723-pznq.png`
- `resources/Skills - Available Skills-20260723-pztn.png`
- `resources/Skills - Apply a Skill-20260723-qaar.png`
- `resources/Skills - Result of Applying a Skill-20260723-qaee.png`

**Create**

- `documents/features/deep-research.md` - Deep Research user workflow with one
  direct resource embed.
- `documents/features/langsmith-integration.md` - external LangSmith
  trace-inspection guide with one direct resource embed.
- `documents/features/skills.md` - skill configuration and use workflow with four
  direct resource embeds.

**Modify**

- `documents/llm-wiki/llm-wiki.md:41-100` - add Wiki index screenshot after
  upload and inspection flow.
- `documents/llm-wiki/llm-wiki.md:175-254` - add citation and grounded-query
  screenshots to query guidance.
- `documents/README.md:6-33` - add active Features section.

### Task 1: Capture source and repository safeguards (completed baseline)

**Files:**

- Read: `resources/*.png`
- Read: Git index and working tree
- Do not modify repository files

- [x] **Step 1: Record base HEAD and protected repository state**

Commands used:

```bash
git rev-parse HEAD | tee /tmp/bmo-resource-screenshot-base-head.txt
git status --short
git diff --cached --binary -- . ':(exclude)resources/*.png' ':(exclude)documents/features/deep-research.md' ':(exclude)documents/features/langsmith-integration.md' ':(exclude)documents/features/skills.md' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md' | shasum -a 256 | tee /tmp/bmo-resource-screenshot-protected-cached.sha256
git diff --binary -- . ':(exclude)resources/*.png' ':(exclude)documents/features/deep-research.md' ':(exclude)documents/features/langsmith-integration.md' ':(exclude)documents/features/skills.md' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md' | shasum -a 256 | tee /tmp/bmo-resource-screenshot-protected-worktree.sha256
git ls-files --others --exclude-standard -z -- . ':(exclude)documents/features/deep-research.md' ':(exclude)documents/features/langsmith-integration.md' ':(exclude)documents/features/skills.md' | xargs -0 shasum -a 256 | sort | tee /tmp/bmo-resource-screenshot-protected-untracked.sha256
```

Baseline result: base HEAD and protected hashes recorded; all nine resource PNGs
appear as staged additions. Every unrelated path is protected. Re-run this step
and stop if any `/tmp/bmo-resource-screenshot-*` baseline file is missing before
implementation resumes.

- [x] **Step 2: Record exact immutable source manifest**

Commands used:

```bash
rg --files resources -g '*.png'
sips -g pixelWidth -g pixelHeight resources/*.png
shasum -a 256 resources/*.png
git diff --cached --binary -- resources | shasum -a 256
```

Expected source manifest:

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

Expected staged binary hash:
`9f1cddc46a09edf39d9663d91af3986ca9e1076d793e66869be3e841669cb2df`.

- [x] **Step 3: Establish failing active-document acceptance check**

Command used:

```bash
node -e 'const fs=require("fs");const docs=["documents/features/deep-research.md","documents/features/langsmith-integration.md","documents/features/skills.md","documents/llm-wiki/llm-wiki.md"];const names=["Deep_Research 2026-04-03 at 12 44 11 PM.png","LangSmith_Integration 2026-04-03 at 10 27 11 AM.png","LLM_Wiki_Index-20260723-qcgl.png","LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png","LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png","Skills - Configuration_Skills-20260723-pznq.png","Skills - Available Skills-20260723-pztn.png","Skills - Apply a Skill-20260723-qaar.png","Skills - Result of Applying a Skill-20260723-qaee.png"];const text=docs.filter(fs.existsSync).map(f=>fs.readFileSync(f,"utf8")).join("\n");const found=names.filter(n=>text.includes(n));console.log({found});if(found.length!==0)process.exit(1)'
```

Baseline result: exits `0` with `{ found: [] }`, proving active guides did not
yet embed any of nine resources.

### Task 2: Verify existing screenshots for direct use

**Files:**

- Read: exact nine `resources/*.png` files from file map
- Do not create or modify files

- [ ] **Step 1: Verify exact inventory, PNG readability, dimensions, and hashes**

Run:

```bash
node -e 'const fs=require("fs");const expected=["Deep_Research 2026-04-03 at 12 44 11 PM.png","LangSmith_Integration 2026-04-03 at 10 27 11 AM.png","LLM_Wiki_Index-20260723-qcgl.png","LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png","LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png","Skills - Configuration_Skills-20260723-pznq.png","Skills - Available Skills-20260723-pztn.png","Skills - Apply a Skill-20260723-qaar.png","Skills - Result of Applying a Skill-20260723-qaee.png"].sort();const actual=fs.readdirSync("resources").filter(f=>f.endsWith(".png")).sort();if(JSON.stringify(actual)!==JSON.stringify(expected)){console.error({expected,actual});process.exit(1)}console.log("exact nine resource PNGs present")'
file resources/*.png
sips -g pixelWidth -g pixelHeight resources/*.png
shasum -a 256 resources/*.png
git diff --cached --binary -- resources | shasum -a 256
```

Expected: exactly nine readable PNGs; dimensions and hashes match Task 1 manifest;
staged binary hash is
`9f1cddc46a09edf39d9663d91af3986ca9e1076d793e66869be3e841669cb2df`.
Any missing, corrupt, dimension-changed, or hash-changed file blocks completion.

- [ ] **Step 2: Inspect every original at readable scale**

Open each exact resource with `view_image` at original detail. Confirm image is
legible, demonstrates mapped workflow, and contains no visible API key, bearer or
session token, password, or other actual secret. Prior inspection found none.

User approved publication as-is, including visible avatars and browser,
LangSmith, and thread identifiers. Record those as accepted content. If actual
secret is discovered, stop and report affected path; do not change screenshot.

- [ ] **Step 3: Confirm direct-render suitability**

Check each image has expected application content, no decode error or corruption,
and enough surrounding UI to support planned caption. Expected: all nine map to
document use in design table. Behavior mismatch blocks completion; no asset or
index operation occurs in this task.

### Task 3: Commit exact nine existing resources

**Files:**

- Commit unchanged: exact nine `resources/*.png` paths from file map
- Protect: every unrelated staged, tracked-worktree, and untracked path

- [ ] **Step 1: Verify resource and protected-state hashes immediately before commit**

Run:

```bash
git diff --cached --binary -- resources | shasum -a 256
git diff --cached --binary -- . ':(exclude)resources/*.png' ':(exclude)documents/features/deep-research.md' ':(exclude)documents/features/langsmith-integration.md' ':(exclude)documents/features/skills.md' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md' | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-cached.sha256 -
git diff --binary -- . ':(exclude)resources/*.png' ':(exclude)documents/features/deep-research.md' ':(exclude)documents/features/langsmith-integration.md' ':(exclude)documents/features/skills.md' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md' | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-worktree.sha256 -
git ls-files --others --exclude-standard -z -- . ':(exclude)documents/features/deep-research.md' ':(exclude)documents/features/langsmith-integration.md' ':(exclude)documents/features/skills.md' | xargs -0 shasum -a 256 | sort | diff -u /tmp/bmo-resource-screenshot-protected-untracked.sha256 -
```

Expected: resource hash matches Task 1 and all protected comparisons exit `0`.
Stop before commit on any mismatch.

- [ ] **Step 2: Commit only exact nine paths**

Run:

```bash
git commit --only -m "docs: add product screenshots" -- "resources/Deep_Research 2026-04-03 at 12 44 11 PM.png" "resources/LangSmith_Integration 2026-04-03 at 10 27 11 AM.png" "resources/LLM_Wiki_Index-20260723-qcgl.png" "resources/LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png" "resources/LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png" "resources/Skills - Configuration_Skills-20260723-pznq.png" "resources/Skills - Available Skills-20260723-pztn.png" "resources/Skills - Apply a Skill-20260723-qaar.png" "resources/Skills - Result of Applying a Skill-20260723-qaee.png"
```

Expected: commit contains exactly nine unchanged resource PNGs. Unrelated staged
entries remain staged.

- [ ] **Step 3: Verify committed blobs and protected state**

Run:

```bash
git show --stat --oneline HEAD
git diff-tree --no-commit-id --name-only -r HEAD
shasum -a 256 resources/*.png
git diff --cached --binary -- . ':(exclude)resources/*.png' ':(exclude)documents/features/deep-research.md' ':(exclude)documents/features/langsmith-integration.md' ':(exclude)documents/features/skills.md' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md' | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-cached.sha256 -
git diff --binary -- . ':(exclude)resources/*.png' ':(exclude)documents/features/deep-research.md' ':(exclude)documents/features/langsmith-integration.md' ':(exclude)documents/features/skills.md' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md' | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-worktree.sha256 -
git ls-files --others --exclude-standard -z -- . ':(exclude)documents/features/deep-research.md' ':(exclude)documents/features/langsmith-integration.md' ':(exclude)documents/features/skills.md' | xargs -0 shasum -a 256 | sort | diff -u /tmp/bmo-resource-screenshot-protected-untracked.sha256 -
```

Expected: commit lists exact nine paths; current file hashes still match manifest;
all protected comparisons exit `0`.

### Task 4: Add focused feature guides

**Files:**

- Create: `documents/features/deep-research.md`
- Create: `documents/features/langsmith-integration.md`
- Create: `documents/features/skills.md`

- [ ] **Step 1: Ground Deep Research guide in current code**

Use `context_search` for Deep Research request submission, task/tool activity,
rendered results, and generated state-file access. Expand only relevant chunks
from `README.md`, `src/app/components/ChatInterface.tsx`, and
`src/app/components/TasksFilesSidebar.tsx`. Explain only confirmed behavior and
do not infer backend setup from screenshot.

Use sections in order and exact embed:

```markdown
# Deep Research Workflow

Return to [documentation index](../README.md).

## Run a research request

## Follow task execution

![Completed Deep Research run showing tool activity and generated report](<../../resources/Deep_Research 2026-04-03 at 12 44 11 PM.png>)

_Completed run keeps tool progress, rendered report, and generated state files in one workflow._

## Review generated files

## Troubleshooting
```

- [ ] **Step 2: Ground LangSmith guide in maintained documentation**

Use `context_search` for LangSmith and tracing configuration in root `README.md`
and maintained guides; expand only relevant chunks. State guide covers external
LangSmith Studio inspection. Do not claim UI automatically opens LangSmith,
constructs trace links, or configures tracing. Mention
`NEXT_PUBLIC_LANGSMITH_API_KEY` only as local-development configuration from root
README and repeat production secrets must not use `NEXT_PUBLIC_*`.

Use sections in order and exact embed:

```markdown
# Inspect a Deep Research Trace in LangSmith

Return to [documentation index](../README.md).

## Scope and prerequisites

## Inspect graph execution

![LangSmith Studio graph and trace panels for a completed research run](<../../resources/LangSmith_Integration 2026-04-03 at 10 27 11 AM.png>)

_Trace view correlates graph nodes, timing, tool calls, model calls, inputs, and outputs._

## Interpret the trace

## Security and troubleshooting
```

- [ ] **Step 3: Ground Skills guide in current code**

Use `context_search` for live skill-backend status, search, selected-skill prompt
drafting, and returned output. Expand only relevant chunks from
`src/app/components/ConfigDialog.tsx`, `src/app/components/SkillsDrawer.tsx`,
`src/app/utils/buildSkillDraftPrompt.ts`, and
`src/features/skills/infrastructure/http-skills-gateway.ts`. Explain confirmed
behavior without claiming every backend supports upload or deletion.

Use sections `Configure skills`, `Browse and select a skill`, `Apply a skill`,
`Review the result`, and `Troubleshooting`. Place exact embeds and one-sentence
captions in workflow order:

```markdown
![Skills tab showing backend status and available agent skills](<../../resources/Skills - Configuration_Skills-20260723-pznq.png>)

_Configuration distinguishes live backend skill data from an unavailable or disconnected backend._

![Available Skills drawer with searchable capabilities](<../../resources/Skills - Available Skills-20260723-pztn.png>)

_Searchable catalog helps choose a capability without leaving current thread._

![Chat request prepared to invoke a selected skill](<../../resources/Skills - Apply a Skill-20260723-qaar.png>)

_Selecting a skill prepares explicit invocation text while preserving current thread context._

![Rendered result returned after applying the selected skill](<../../resources/Skills - Result of Applying a Skill-20260723-qaee.png>)

_Completed response shows skill output in same conversation where it was requested._
```

- [ ] **Step 4: Format and check new guides**

Run:

```bash
yarn prettier --write documents/features/deep-research.md documents/features/langsmith-integration.md documents/features/skills.md
yarn prettier --check documents/features/deep-research.md documents/features/langsmith-integration.md documents/features/skills.md
git diff --check -- documents/features/deep-research.md documents/features/langsmith-integration.md documents/features/skills.md
```

Expected: Prettier and whitespace checks exit `0`.

- [ ] **Step 5: Commit feature guides only**

Run:

```bash
git add documents/features/deep-research.md documents/features/langsmith-integration.md documents/features/skills.md
git commit --only -m "docs: add illustrated feature guides" -- documents/features/deep-research.md documents/features/langsmith-integration.md documents/features/skills.md
```

Expected: commit contains only three feature guides; unrelated staged state is
unchanged.

### Task 5: Embed LLM Wiki screenshots and update index

**Files:**

- Modify: `documents/llm-wiki/llm-wiki.md:41-100`
- Modify: `documents/llm-wiki/llm-wiki.md:175-254`
- Modify: `documents/README.md:6-33`

- [ ] **Step 1: Add Wiki workspace screenshot**

After upload and inspection sequence, add exact embed and caption:

```markdown
<!-- prettier-ignore -->
![LLM Wiki workspace tree open beside its generated index](<../../resources/LLM_Wiki_Index-20260723-qcgl.png>)

_Workspace tree exposes generated Wiki files for inspection without replacing original source evidence._
```

- [ ] **Step 2: Add query and citation screenshots**

Near query sequence and citation explanation, add each exact embed once:

```markdown
![Grounded LLM Wiki answer linked to corresponding PDF page](<../../resources/LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png>)

_Citation links let readers compare grounded answer with relevant original document page._

![Grounded financial answer shown beside supporting annual-report evidence](<../../resources/LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png>)

_Grounded query output remains connected to original report used as evidence._
```

- [ ] **Step 3: Add Features section to documentation index**

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

- [ ] **Step 4: Format and check changed Markdown**

Run:

```bash
yarn prettier --write documents/README.md documents/llm-wiki/llm-wiki.md
yarn prettier --check documents/README.md documents/llm-wiki/llm-wiki.md documents/features/*.md
git diff --check -- documents/README.md documents/llm-wiki/llm-wiki.md
```

Expected: all formatting and whitespace checks exit `0`.

- [ ] **Step 5: Commit index and Wiki guide only**

Run:

```bash
git add documents/README.md documents/llm-wiki/llm-wiki.md
git commit --only -m "docs: embed screenshots in active guides" -- documents/README.md documents/llm-wiki/llm-wiki.md
```

Expected: commit contains only documentation index and LLM Wiki guide changes;
unrelated staged state remains unchanged.

### Task 6: Run full resource, link, secret, and repository verification

**Files:**

- Verify: exact nine `resources/*.png` and four active guides
- Protect: every unrelated staged, tracked-worktree, and untracked path

- [ ] **Step 1: Assert exact resource inventory and absence of copied assets**

Run:

```bash
node -e 'const fs=require("fs"),path=require("path"),crypto=require("crypto");const expected={"Deep_Research 2026-04-03 at 12 44 11 PM.png":[1917,945,"f8c30c260e8fba34af5afa6d1eb18831b310eae5b5dc03a2d4c06a2e5ad4a3d2"],"LangSmith_Integration 2026-04-03 at 10 27 11 AM.png":[1915,947,"b1775cdbf26980cd4dfa9af951af2cf5cdae8940fc68d8e3ef351fafabe78edb"],"LLM_Wiki_Index-20260723-qcgl.png":[1922,862,"dcc7758e29eeb79ebf1104e14068078c90edc95adb736891b2080c4b4334e186"],"LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png":[1909,868,"1a7aee54240da18fe9a7b82d786631df85051abd55edad500737d1ee5dce6a44"],"LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png":[1918,930,"5caf2a88da414410f5b20d6a67884febb95ac0e969977243eaa3776aedf30aa9"],"Skills - Configuration_Skills-20260723-pznq.png":[1901,849,"ffac5f511dcafc0eddc3adf284d28e431d384d0fb585b714e0eef9549b087508"],"Skills - Available Skills-20260723-pztn.png":[1904,867,"81fa98450b75a53f04e9923c38ac661938fa046b9afa439f3ae589c3bf7881d0"],"Skills - Apply a Skill-20260723-qaar.png":[1906,869,"09faf6406458c0f473cf026d931231cc458336ce2005f7a4b238f1b3bbb63005"],"Skills - Result of Applying a Skill-20260723-qaee.png":[1910,856,"357342f23ea385ebe1b39f375fdbd0f281ab40e337f838cb2f6a25e23c5b838e"]};const names=Object.keys(expected).sort(),actual=fs.readdirSync("resources").filter(f=>f.endsWith(".png")).sort(),bad=[];if(JSON.stringify(actual)!==JSON.stringify(names))bad.push({inventory:{expected:names,actual}});for(const n of names){const p=path.join("resources",n),b=fs.readFileSync(p),w=b.readUInt32BE(16),h=b.readUInt32BE(20),hash=crypto.createHash("sha256").update(b).digest("hex"),want=expected[n];if(b.toString("ascii",1,4)!=="PNG"||w!==want[0]||h!==want[1]||hash!==want[2])bad.push({name:n,w,h,hash,want})}const oldDir=path.join("documents","assets","screenshots");if(fs.existsSync(oldDir))bad.push({unexpectedDirectory:oldDir});const sourceHashes=new Set(names.map(n=>expected[n][2])),copies=[];const walk=d=>{if(!fs.existsSync(d))return;for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith(".png")){const h=crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");if(sourceHashes.has(h))copies.push(p)}}};walk("documents");if(copies.length)bad.push({copies});if(bad.length){console.error(bad);process.exit(1)}console.log("exact nine unchanged resources present; no documentation copies")'
sips -g pixelWidth -g pixelHeight resources/*.png
shasum -a 256 resources/*.png
```

Expected: exact nine filenames, no secondary asset directory, no byte-identical
copies under `documents/`, and manifest dimensions and hashes unchanged.

- [ ] **Step 2: Verify exact direct embeds and per-guide distribution**

Run:

````bash
node -e 'const fs=require("fs");const expected={"documents/features/deep-research.md":["../../resources/Deep_Research 2026-04-03 at 12 44 11 PM.png"],"documents/features/langsmith-integration.md":["../../resources/LangSmith_Integration 2026-04-03 at 10 27 11 AM.png"],"documents/features/skills.md":["../../resources/Skills - Configuration_Skills-20260723-pznq.png","../../resources/Skills - Available Skills-20260723-pztn.png","../../resources/Skills - Apply a Skill-20260723-qaar.png","../../resources/Skills - Result of Applying a Skill-20260723-qaee.png"],"documents/llm-wiki/llm-wiki.md":["../../resources/LLM_Wiki_Index-20260723-qcgl.png","../../resources/LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png","../../resources/LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png"]};const bad=[],texts=[];for(const [f,want] of Object.entries(expected)){const t=fs.readFileSync(f,"utf8").replace(/```[\s\S]*?```/g,"");texts.push(t);const raw=[...t.matchAll(/!\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["\x27][^"\x27]*["\x27])?\)/g)].map(m=>m[1]).filter(u=>u.includes("../../resources/"));const angle=raw.every(u=>u.startsWith("<")&&u.endsWith(">")),got=raw.map(u=>u.slice(1,-1));if(!angle||JSON.stringify(got)!==JSON.stringify(want))bad.push({file:f,want,raw})}const all=texts.join("\n");for(const p of Object.values(expected).flat()){const n=p.slice("../../resources/".length),count=all.split(n).length-1;if(count!==1)bad.push({filename:n,count})}if(bad.length){console.error(bad);process.exit(1)}console.log("nine angle-bracketed direct embeds match 1+1+4+3 guide mapping and each filename appears once")'
````

Expected: exact success message. Check enforces image syntax, angle brackets,
direct paths, order, `1+1+4+3` distribution, and one global occurrence per
filename. Historical plan and design are excluded.

- [ ] **Step 3: Verify relative Markdown links, including angle-bracketed destinations**

Run:

````bash
node -e 'const fs=require("fs"),path=require("path");const md=["documents/README.md","documents/features/deep-research.md","documents/features/langsmith-integration.md","documents/features/skills.md","documents/llm-wiki/llm-wiki.md"];const bad=[];for(const f of md){const t=fs.readFileSync(f,"utf8").replace(/```[\s\S]*?```/g,"");for(const m of t.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["\x27][^"\x27]*["\x27])?\)/g)){let u=m[1];if(u.startsWith("<")&&u.endsWith(">"))u=u.slice(1,-1);u=u.split("#")[0];if(!u||/^(https?:|mailto:|#)/.test(u))continue;const p=path.resolve(path.dirname(f),u);if(!fs.existsSync(p))bad.push(`${f}: ${u}`)}}if(bad.length){console.error(bad.join("\n"));process.exit(1)}console.log("five active Markdown files: local links resolve")'
````

Expected: all local links resolve. Checker ignores fenced blocks and removes
optional `<...>` around image destination before `path.resolve`.

- [ ] **Step 4: Re-run visual inspection of original resources**

Open all nine `resources/*.png` files with `view_image` at original detail.
Confirm readable content and correct contextual placement; inspect for actual API
keys, bearer or session tokens, passwords, or other actual secrets. Visible
avatars and browser, LangSmith, and thread identifiers remain explicitly approved
and do not fail validation. Missing/corrupt image or actual secret blocks
completion.

- [ ] **Step 5: Scan active Markdown for credential values**

Run:

```bash
rg -n '(sk-[A-Za-z0-9_-]{16,}|Bearer [A-Za-z0-9._-]{12,}|api[_-]?key[[:space:]]*[:=][[:space:]]*[^<[:space:]]+|session[_-]?token[[:space:]]*[:=][[:space:]]*[^<[:space:]]+)' documents/README.md documents/features documents/llm-wiki/llm-wiki.md --glob '*.md'
```

Expected: no real credential value. Review configuration-name matches manually;
placeholders and warnings are permitted, secrets are not.

- [ ] **Step 6: Run formatting, diff, lint, and implementation-scope checks**

Run:

```bash
BASE_HEAD=$(sed -n '1p' /tmp/bmo-resource-screenshot-base-head.txt)
git diff --check
git diff --check "$BASE_HEAD"..HEAD
yarn prettier --check documents/README.md documents/llm-wiki/llm-wiki.md documents/features/*.md documents/history/specifications/2026-08-04-resource-screenshots-documentation-design.md documents/history/plans/2026-08-04-resource-screenshots-documentation.md
yarn lint
git diff --name-status "$BASE_HEAD"..HEAD
```

Expected: diff checks, Prettier, and lint exit `0`. Name-status review contains
revised design/plan records from their path-limited approval commit, then exact
nine resources, three feature guides, documentation index, and LLM Wiki guide.
No application code or generated file appears.

- [ ] **Step 7: Compare final protected repository state**

Run:

```bash
git diff --cached --binary -- . ':(exclude)resources/*.png' ':(exclude)documents/features/deep-research.md' ':(exclude)documents/features/langsmith-integration.md' ':(exclude)documents/features/skills.md' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md' | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-cached.sha256 -
git diff --binary -- . ':(exclude)resources/*.png' ':(exclude)documents/features/deep-research.md' ':(exclude)documents/features/langsmith-integration.md' ':(exclude)documents/features/skills.md' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md' | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-worktree.sha256 -
git ls-files --others --exclude-standard -z -- . ':(exclude)documents/features/deep-research.md' ':(exclude)documents/features/langsmith-integration.md' ':(exclude)documents/features/skills.md' | xargs -0 shasum -a 256 | sort | diff -u /tmp/bmo-resource-screenshot-protected-untracked.sha256 -
git status --short
git log -4 --oneline
```

Expected: all protected comparisons exit `0`; unrelated staged and worktree state
matches baseline; recent commits are path-limited as specified.

- [ ] **Step 8: Apply `@verification-before-completion`**

Review fresh Task 6 output before claiming completion. Report exact commits,
four active guides, exact nine-resource count, unchanged hashes and dimensions,
direct-link check, secret inspection, lint result, and remaining unrelated
worktree state.
