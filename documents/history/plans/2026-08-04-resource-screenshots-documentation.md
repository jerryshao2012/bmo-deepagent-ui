# Resource Screenshot Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sanitize nine screenshots from `resources/`, move them into maintained documentation assets, and embed each image in accurate feature guidance.

**Architecture:** Treat screenshots as immutable source inputs until edited destinations pass privacy, dimension, and visual-fidelity checks. Store sanitized PNGs under `documents/assets/screenshots/`; keep task guidance in focused feature documents and add LLM Wiki images to its existing guide. Replace only the nine staged source paths in Git index and preserve every unrelated staged or working-tree change.

**Tech Stack:** Markdown, PNG assets, `@imagegen`, Git path-limited index operations, Prettier, ESLint, macOS `sips`, `shasum`, `rg`, and `@verification-before-completion`.

**Execution constraint:** Work inline on the current dirty `main` worktree because
the nine source PNGs exist only in its index and working tree. Override any
`subagent-driven-development` or `executing-plans` instruction to create a branch,
worktree, or clean checkout. Only the exact path-limited index and commit commands
in this plan are authorized.

---

## File map

**Create**

- `documents/assets/screenshots/deep-research-completed-run.png` - sanitized completed research run.
- `documents/assets/screenshots/langsmith-trace-inspection.png` - sanitized external LangSmith Studio trace.
- `documents/assets/screenshots/llm-wiki-index.png` - sanitized Wiki tree and index.
- `documents/assets/screenshots/llm-wiki-document-citation.png` - sanitized query-to-PDF citation example.
- `documents/assets/screenshots/llm-wiki-grounded-query.png` - sanitized grounded financial query example.
- `documents/assets/screenshots/skills-configuration.png` - sanitized configuration dialog.
- `documents/assets/screenshots/skills-catalog.png` - sanitized available-skills drawer.
- `documents/assets/screenshots/skills-application-request.png` - sanitized skill invocation.
- `documents/assets/screenshots/skills-application-result.png` - sanitized skill output.
- `documents/features/deep-research.md` - Deep Research user workflow.
- `documents/features/langsmith-integration.md` - external LangSmith trace-inspection guide.
- `documents/features/skills.md` - skill configuration and use workflow.

**Modify**

- `documents/llm-wiki/llm-wiki.md:41-100` - add Wiki index screenshot after upload/inspection flow.
- `documents/llm-wiki/llm-wiki.md:175-254` - add citation and grounded-query screenshots to query guidance.
- `documents/README.md:6-33` - add active Features section.

**Remove after verification**

- `resources/Deep_Research 2026-04-03 at 12 44 11 PM.png`
- `resources/LangSmith_Integration 2026-04-03 at 10 27 11 AM.png`
- `resources/LLM_Wiki_Index-20260723-qcgl.png`
- `resources/LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png`
- `resources/LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png`
- `resources/Skills - Configuration_Skills-20260723-pznq.png`
- `resources/Skills - Available Skills-20260723-pztn.png`
- `resources/Skills - Apply a Skill-20260723-qaar.png`
- `resources/Skills - Result of Applying a Skill-20260723-qaee.png`

### Task 1: Capture source and repository safeguards

**Files:**

- Read: `resources/*.png`
- Read: Git index and working tree
- Do not modify repository files

- [ ] **Step 1: Record initial repository state**

Run:

```bash
git rev-parse HEAD | tee /tmp/bmo-resource-screenshot-base-head.txt
git status --short
git diff --cached --name-status -- . ':(exclude)resources/*.png' ':(exclude)documents/assets/screenshots/**' ':(exclude)documents/features/**' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md'
git diff --cached --binary -- . ':(exclude)resources/*.png' ':(exclude)documents/assets/screenshots/**' ':(exclude)documents/features/**' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md' | shasum -a 256 | tee /tmp/bmo-resource-screenshot-protected-cached.sha256
git diff --binary -- . ':(exclude)resources/*.png' ':(exclude)documents/assets/screenshots/**' ':(exclude)documents/features/**' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md' | shasum -a 256 | tee /tmp/bmo-resource-screenshot-protected-worktree.sha256
git ls-files --others --exclude-standard
```

Expected: base HEAD is recorded; all nine `resources/*.png` files appear as staged
additions; path-excluded hashes capture unrelated cached and tracked worktree
changes. For each unrelated untracked file listed, run
`shasum -a 256 <exact-path>` and record its hash in task notes. Treat every
unrelated path as protected. Do not use a whole-diff hash after intentional paths
begin changing.

- [ ] **Step 2: Confirm exact source inventory**

Run:

```bash
rg --files resources -g '*.png'
sips -g pixelWidth -g pixelHeight resources/*.png
shasum -a 256 resources/*.png
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

- [ ] **Step 3: Establish the failing asset acceptance check**

Run:

```bash
test -d documents/assets/screenshots
test "$(find documents/assets/screenshots -maxdepth 1 -type f -name '*.png' | wc -l | awk '{print $1}')" -eq 9
```

Expected before implementation: nonzero exit because directory does not exist or
count is not `9`.

### Task 2: Create and verify sanitized screenshot assets

**Files:**

- Create: all nine `documents/assets/screenshots/*.png` files from file map
- Read: all nine `resources/*.png` sources

- [ ] **Step 1: Edit each source with `@imagegen`**

Inspect each source with `view_image`, then call `image_gen.imagegen` once per
source with `referenced_image_paths: [<exact-source-path>]`; do not use
`num_last_images_to_include`. Read exact artifact path returned by tool and copy
that artifact to mapped workspace destination. Never infer a "latest" output or
assume tool accepts destination argument. Use this base instruction for every
edit:

```text
Privacy-redact this product screenshot only. Preserve original pixel dimensions,
layout, text, controls, colors, and all non-sensitive application content exactly.
Replace every identifiable personal avatar in browser profile chrome and
application-shell chrome, regardless of screen location, with a neutral solid-gray
circle of same size. Do not crop, reframe, restyle, sharpen, or regenerate any
other region.
```

Append to Deep Research prompt:

```text
In browser address bar, remove only threadId value while preserving localhost:3000,
assistantId=research, separators, and browser chrome. Do not add a replacement ID.
```

Append to LangSmith prompt:

```text
In browser address bar, remove organization ID, thread ID, and encoded render/base
URL identifiers while preserving smith.langchain.com and recognizable trace-view
route context. In application UI, replace value after Thread with [redacted] while
preserving Thread label, dropdown, and surrounding controls.
```

Use this per-image redaction checklist before accepting output:

- Deep Research: browser profile avatar, application-shell avatar, browser
  `threadId` value.
- LangSmith: browser profile avatar, bottom-left application avatar, browser
  organization/thread/render identifiers, in-app `Thread <UUID>` value.
- Three LLM Wiki images: every top-right application-shell avatar.
- Four Skills images: every top-right application-shell avatar.

- [ ] **Step 2: Verify destination count and dimensions while sources exist**

Run:

```bash
find documents/assets/screenshots -maxdepth 1 -type f -name '*.png' | wc -l
sips -g pixelWidth -g pixelHeight documents/assets/screenshots/*.png
```

Expected: exactly `9`; each destination dimension equals mapped source manifest.
If any dimension differs, reject that output and repeat its image edit. Do not
resize with another tool because privacy edit must remain within `@imagegen` flow.

- [ ] **Step 3: Visually compare every source and destination**

Open each source/destination pair with `view_image`. Check:

- avatars are neutral circles in every browser and application-shell region;
- Deep Research browser `threadId` value is absent;
- LangSmith browser identifiers and in-app Thread UUID are absent;
- citations, document names, task output, skill names, controls, and layout match;
- no generated artifacts, garbled text, cropping, or content changes appear.

Expected: all nine pairs pass. Any mismatch blocks source removal.

- [ ] **Step 4: Scan accepted outputs for visible secrets**

At high detail, inspect browser chrome, app chrome, message text, document viewers,
and trace panels for API keys, bearer/session tokens, passwords, private client
identifiers, email addresses, or any identifiers covered by redaction rules.

Expected: no visible secret or covered identifier remains. Public document names,
citations, and non-sensitive product text remain unchanged.

- [ ] **Step 5: Record sanitized hashes**

Run:

```bash
shasum -a 256 documents/assets/screenshots/*.png
```

Expected: nine destination hashes recorded in task notes; edited images differ
from their source hashes.

### Task 3: Replace staged source paths safely

**Files:**

- Preserve in working tree: exact nine `resources/*.png` paths listed in file map
- Unstage: exact nine `resources/*.png` paths listed in file map
- Stage: exact nine `documents/assets/screenshots/*.png` paths listed in file map

- [ ] **Step 1: Remove unsanitized additions from index while retaining sources**

Run path-limited commands:

```bash
git restore --staged -- "resources/Deep_Research 2026-04-03 at 12 44 11 PM.png" "resources/LangSmith_Integration 2026-04-03 at 10 27 11 AM.png" "resources/LLM_Wiki_Index-20260723-qcgl.png" "resources/LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png" "resources/LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png" "resources/Skills - Configuration_Skills-20260723-pznq.png" "resources/Skills - Available Skills-20260723-pztn.png" "resources/Skills - Apply a Skill-20260723-qaar.png" "resources/Skills - Result of Applying a Skill-20260723-qaee.png"
git add documents/assets/screenshots/deep-research-completed-run.png documents/assets/screenshots/langsmith-trace-inspection.png documents/assets/screenshots/llm-wiki-index.png documents/assets/screenshots/llm-wiki-document-citation.png documents/assets/screenshots/llm-wiki-grounded-query.png documents/assets/screenshots/skills-configuration.png documents/assets/screenshots/skills-catalog.png documents/assets/screenshots/skills-application-request.png documents/assets/screenshots/skills-application-result.png
```

Expected: old source paths absent from index but still present in working tree;
nine sanitized destinations staged.

- [ ] **Step 2: Verify path-limited index replacement and protected state**

Run:

```bash
git diff --cached --name-status -- documents/assets/screenshots resources
git status --short
git diff --cached --binary -- . ':(exclude)resources/*.png' ':(exclude)documents/assets/screenshots/**' ':(exclude)documents/features/**' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md' | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-cached.sha256 -
git diff --binary -- . ':(exclude)resources/*.png' ':(exclude)documents/assets/screenshots/**' ':(exclude)documents/features/**' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md' | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-worktree.sha256 -
```

Expected: screenshot diff lists only nine staged destinations plus nine untracked
working-tree sources. Both protected-state comparisons have no output and exit
`0`. Re-check recorded unrelated untracked hashes. Stop if any protected path
changed.

- [ ] **Step 3: Commit sanitized assets only**

```bash
git commit --only -m "docs: add sanitized product screenshots" -- documents/assets/screenshots/deep-research-completed-run.png documents/assets/screenshots/langsmith-trace-inspection.png documents/assets/screenshots/llm-wiki-index.png documents/assets/screenshots/llm-wiki-document-citation.png documents/assets/screenshots/llm-wiki-grounded-query.png documents/assets/screenshots/skills-configuration.png documents/assets/screenshots/skills-catalog.png documents/assets/screenshots/skills-application-request.png documents/assets/screenshots/skills-application-result.png
```

Expected: commit contains nine sanitized PNGs and no old `resources/` path.

### Task 4: Add focused feature guides

**Files:**

- Create: `documents/features/deep-research.md`
- Create: `documents/features/langsmith-integration.md`
- Create: `documents/features/skills.md`

- [ ] **Step 1: Write Deep Research guide**

Use these sections in order:

```markdown
# Deep Research Workflow

Return to [documentation index](../README.md).

## Run a research request

## Follow task execution

![Completed Deep Research run showing tool activity and generated report](../assets/screenshots/deep-research-completed-run.png)

_Completed run keeps tool progress, rendered report, and generated state files in one workflow._

## Review generated files

## Troubleshooting
```

Explain only visible/current behavior: submit request, observe task/tool activity,
read rendered result, and open generated state files. Ground workflow in
`README.md`, `src/app/components/ChatInterface.tsx`, and
`src/app/components/TasksFilesSidebar.tsx`; use screenshot only as illustration.
Do not infer backend setup from screenshot.

- [ ] **Step 2: Write LangSmith trace-inspection guide**

Use these sections in order:

```markdown
# Inspect a Deep Research Trace in LangSmith

Return to [documentation index](../README.md).

## Scope and prerequisites

## Inspect graph execution

![LangSmith Studio graph and trace panels for a completed research run](../assets/screenshots/langsmith-trace-inspection.png)

_Trace view correlates graph nodes, timing, tool calls, model calls, inputs, and outputs._

## Interpret the trace

## Security and troubleshooting
```

State this is external LangSmith Studio inspection. Do not claim UI automatically
opens LangSmith, constructs trace links, or configures tracing. Mention
`NEXT_PUBLIC_LANGSMITH_API_KEY` only as local-development configuration from root
README and repeat that production secrets must not use `NEXT_PUBLIC_*`.

- [ ] **Step 3: Write Skills guide**

Use these image placements in workflow order:

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

Sections: `Configure skills`, `Browse and select a skill`, `Apply a skill`,
`Review the result`, and `Troubleshooting`. Ground details in
`src/app/components/ConfigDialog.tsx`, `src/app/components/SkillsDrawer.tsx`,
`src/app/utils/buildSkillDraftPrompt.ts`, and
`src/features/skills/infrastructure/http-skills-gateway.ts`. Explain live-backend
status, search, selected-skill prompt drafting, and returned output without
claiming every backend supports upload or deletion.

- [ ] **Step 4: Format and check new guides**

Run:

```bash
yarn prettier --write documents/features/deep-research.md documents/features/langsmith-integration.md documents/features/skills.md
yarn prettier --check documents/features/deep-research.md documents/features/langsmith-integration.md documents/features/skills.md
```

Expected: Prettier reports all three guides match style.

- [ ] **Step 5: Commit feature guides**

```bash
git add documents/features/deep-research.md documents/features/langsmith-integration.md documents/features/skills.md
git commit --only -m "docs: add illustrated feature guides" -- documents/features/deep-research.md documents/features/langsmith-integration.md documents/features/skills.md
```

Expected: commit contains only three Markdown guides.

### Task 5: Embed LLM Wiki screenshots and update index

**Files:**

- Modify: `documents/llm-wiki/llm-wiki.md:41-100`
- Modify: `documents/llm-wiki/llm-wiki.md:175-254`
- Modify: `documents/README.md:6-33`

- [ ] **Step 1: Add Wiki workspace screenshot**

After upload/inspection sequence, add:

```markdown
![LLM Wiki workspace tree open beside its generated index](../assets/screenshots/llm-wiki-index.png)

_Workspace tree exposes generated Wiki files for inspection without replacing original source evidence._
```

- [ ] **Step 2: Add query and citation screenshots**

Near query sequence and citation explanation, add each once:

```markdown
![Grounded LLM Wiki answer linked to the corresponding PDF page](../assets/screenshots/llm-wiki-document-citation.png)

_Citation links let readers compare a grounded answer with the relevant original document page._

![Grounded financial answer shown beside supporting annual-report evidence](../assets/screenshots/llm-wiki-grounded-query.png)

_Grounded query output remains connected to the original report used as evidence._
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

- [ ] **Step 4: Format changed Markdown**

Run:

```bash
yarn prettier --write documents/README.md documents/llm-wiki/llm-wiki.md
yarn prettier --check documents/README.md documents/llm-wiki/llm-wiki.md documents/features/*.md
```

Expected: all changed Markdown matches Prettier style.

- [ ] **Step 5: Commit contextual embeds and index**

```bash
git add documents/README.md documents/llm-wiki/llm-wiki.md
git commit --only -m "docs: embed screenshots in active guides" -- documents/README.md documents/llm-wiki/llm-wiki.md
```

Expected: commit contains only index and LLM Wiki guide changes.

### Task 6: Run full privacy, link, and repository verification

**Files:**

- Verify: all changed Markdown and PNG assets
- Protect: all unrelated staged and working-tree paths

- [ ] **Step 1: Verify asset inventory and active-document path ownership**

Run:

```bash
test -d documents/assets/screenshots
test "$(find documents/assets/screenshots -maxdepth 1 -type f -name '*.png' | wc -l | awk '{print $1}')" -eq 9
rg --files resources -g '*.png'
rg -n '\]\([^)]*resources/' documents/README.md documents/features documents/llm-wiki/llm-wiki.md --glob '*.md'
```

Expected: destination assertions pass; source inventory still lists nine originals;
active-document old-link scan returns no matches. Historical plan/spec mappings
are intentionally excluded.

- [ ] **Step 2: Verify every destination is referenced exactly once**

Run:

```bash
node -e 'const fs=require("fs");const files=["documents/features/deep-research.md","documents/features/langsmith-integration.md","documents/features/skills.md","documents/llm-wiki/llm-wiki.md"];const text=files.map(f=>fs.readFileSync(f,"utf8")).join("\n");const assets=fs.readdirSync("documents/assets/screenshots").filter(f=>f.endsWith(".png"));const bad=assets.filter(a=>(text.match(new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"g"))||[]).length!==1);if(assets.length!==9||bad.length){console.error({count:assets.length,bad});process.exit(1)}console.log("9 active screenshot embeds reference each asset exactly once")'
```

Expected: `9 active screenshot embeds reference each asset exactly once`.

- [ ] **Step 3: Verify every relative Markdown link resolves**

Run:

````bash
node -e 'const fs=require("fs"),path=require("path");const md=["documents/README.md","documents/features/deep-research.md","documents/features/langsmith-integration.md","documents/features/skills.md","documents/llm-wiki/llm-wiki.md"];const bad=[];for(const f of md){const t=fs.readFileSync(f,"utf8").replace(/```[\s\S]*?```/g,"");for(const m of t.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){const u=m[1].split("#")[0];if(!u||/^(https?:|mailto:|#)/.test(u))continue;const p=path.resolve(path.dirname(f),u);if(!fs.existsSync(p))bad.push(`${f}: ${u}`)}}if(bad.length){console.error(bad.join("\n"));process.exit(1)}console.log("5 changed active Markdown files: local links resolve")'
````

Expected: all local links in changed active documents resolve; fenced examples are
excluded from link semantics.

- [ ] **Step 4: Re-run visual privacy inspection**

Open all nine destination PNGs with `view_image` at high detail. Confirm defined
redaction regions contain no personal avatars or thread/organization IDs and all
other application content remains legible and unchanged.

- [ ] **Step 5: Scan changed Markdown for secrets**

Run:

```bash
rg -n '(sk-[A-Za-z0-9_-]{16,}|Bearer [A-Za-z0-9._-]{12,}|api[_-]?key[[:space:]]*[:=][[:space:]]*[^<[:space:]]+|session[_-]?token[[:space:]]*[:=][[:space:]]*[^<[:space:]]+)' documents/README.md documents/features documents/llm-wiki/llm-wiki.md --glob '*.md'
```

Expected: no real credential values. Review any configuration-name match manually;
placeholders and warnings are permitted, secrets are not.

- [ ] **Step 6: Run repository checks across committed implementation**

Run:

```bash
git diff --check
SCREENSHOT_BASE_HEAD=$(sed -n '1p' /tmp/bmo-resource-screenshot-base-head.txt)
git diff --check "$SCREENSHOT_BASE_HEAD"..HEAD
yarn prettier --check documents/README.md documents/llm-wiki/llm-wiki.md documents/features/*.md documents/history/specifications/2026-08-04-resource-screenshots-documentation-design.md documents/history/plans/2026-08-04-resource-screenshots-documentation.md
yarn lint
```

Expected: all commands exit `0`.

- [ ] **Step 7: Remove validated originals**

Only after Steps 1-6 pass, remove exact source paths with no glob and no recursive
removal:

```bash
rm -f "resources/Deep_Research 2026-04-03 at 12 44 11 PM.png" "resources/LangSmith_Integration 2026-04-03 at 10 27 11 AM.png" "resources/LLM_Wiki_Index-20260723-qcgl.png" "resources/LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png" "resources/LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png" "resources/Skills - Configuration_Skills-20260723-pznq.png" "resources/Skills - Available Skills-20260723-pztn.png" "resources/Skills - Apply a Skill-20260723-qaar.png" "resources/Skills - Result of Applying a Skill-20260723-qaee.png"
```

Expected: exactly nine originals removed after sanitized assets are committed,
referenced, privacy-checked, and link-checked.

- [ ] **Step 8: Confirm source removal and protected repository state**

Run:

```bash
git status --short
git diff --cached --name-status
git log -4 --oneline
test -z "$(rg --files resources -g '*.png')"
git diff --cached --binary -- . ':(exclude)resources/*.png' ':(exclude)documents/assets/screenshots/**' ':(exclude)documents/features/**' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md' | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-cached.sha256 -
git diff --binary -- . ':(exclude)resources/*.png' ':(exclude)documents/assets/screenshots/**' ':(exclude)documents/features/**' ':(exclude)documents/README.md' ':(exclude)documents/llm-wiki/llm-wiki.md' | shasum -a 256 | diff -u /tmp/bmo-resource-screenshot-protected-worktree.sha256 -
```

Expected: source `resources/*.png` paths absent; implementation commits contain
only intended screenshot/docs paths; both protected-state comparisons exit `0`;
every recorded unrelated untracked hash still matches Task 1 snapshot.

- [ ] **Step 9: Apply `@verification-before-completion`**

Review fresh outputs from Tasks 2 and 6 before claiming completion. Report exact
commits, changed guides, nine-asset count, privacy checks, lint result, and any
remaining unrelated worktree state.
