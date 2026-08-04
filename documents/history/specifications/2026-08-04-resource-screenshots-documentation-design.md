# Resource Screenshot Documentation Design

## Goal

Publish nine existing product screenshots directly from `resources/`, unchanged
and under their current filenames, then embed each image once in focused user
guidance. Keep screenshots contextual and maintainable instead of creating a
standalone gallery or a second asset set.

## Documentation structure

Keep all nine PNGs under `resources/`. Create three concise feature guides:

1. `documents/features/deep-research.md` explains completed research flow, tool
   activity, generated report, and state-file access.
2. `documents/features/langsmith-integration.md` explains inspection of a
   research run as a LangSmith graph and trace.
3. `documents/features/skills.md` explains skill configuration, discovery,
   invocation, and result review.

Embed three LLM Wiki screenshots in the existing
`documents/llm-wiki/llm-wiki.md` beside the workflows they demonstrate. Add a
Features section to `documents/README.md` linking the three new guides. Do not
duplicate these screenshots in root `README.md` or create a screenshot gallery.
Existing externally hosted screenshots in root `README.md` remain out of scope.

## Direct resource mapping

Each existing resource is published from its current path and used exactly once
in active documentation:

| Existing resource path                                            | Active documentation use                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| `resources/Deep_Research 2026-04-03 at 12 44 11 PM.png`           | `documents/features/deep-research.md` completed run and report    |
| `resources/LangSmith_Integration 2026-04-03 at 10 27 11 AM.png`   | `documents/features/langsmith-integration.md` graph and trace     |
| `resources/LLM_Wiki_Index-20260723-qcgl.png`                      | `documents/llm-wiki/llm-wiki.md` Wiki tree and index              |
| `resources/LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png`           | `documents/llm-wiki/llm-wiki.md` grounded answer and PDF citation |
| `resources/LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png`          | `documents/llm-wiki/llm-wiki.md` grounded financial answer        |
| `resources/Skills - Configuration_Skills-20260723-pznq.png`       | `documents/features/skills.md` skills configuration               |
| `resources/Skills - Available Skills-20260723-pztn.png`           | `documents/features/skills.md` available-skills catalog           |
| `resources/Skills - Apply a Skill-20260723-qaar.png`              | `documents/features/skills.md` skill invocation request           |
| `resources/Skills - Result of Applying a Skill-20260723-qaee.png` | `documents/features/skills.md` returned skill result              |

Do not generate, edit, copy, move, rename, or delete any screenshot. Preserve
each source byte-for-byte, including PNG format, filename, dimensions, and hash.
Do not create a secondary screenshot asset directory.

## Publication and accessibility

User explicitly approved publication of all nine screenshots as-is, including
visible avatars and browser, LangSmith, and thread identifiers. Prior visual
inspection found no visible API keys, tokens, or passwords. These approved
avatars and identifiers are accepted content, not validation failures. If later
inspection finds an actual secret, stop publication and report exact affected
file; do not modify screenshot.

Every Markdown embed uses descriptive alt text, a one-sentence caption explaining
why screenshot matters, and direct relative path from active guide. Because
filenames contain spaces, every image destination is angle-bracketed. Both
`documents/features/*.md` and `documents/llm-wiki/llm-wiki.md` use this form:

```markdown
![Descriptive action](<../../resources/Existing Filename.png>)
```

Captions must not repeat surrounding prose or rely on color alone.

## Guide contents and placement

Feature guides remain concise and task-oriented. Each includes purpose,
prerequisites or configuration boundaries, workflow steps, relevant screenshot
at illustrated step, and short troubleshooting or interpretation section.
Content describes behavior confirmed by current repository code or maintained
guides; screenshots provide evidence but do not establish setup details alone.

LangSmith guide is limited to external LangSmith Studio graph and trace
inspection. It must not imply this UI automatically opens LangSmith, constructs
trace links, or configures tracing unless current repository code or a maintained
guide verifies that behavior.

Place LLM Wiki images as follows:

- `LLM_Wiki_Index-20260723-qcgl.png` near workspace tree and file inspection.
- `LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png` near query flow and citation
  behavior.
- `LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png` near grounded answers and
  original-source evidence.

Historical plans and specifications remain unchanged except this revised design
record.

## Failure handling and Git safety

- Missing or corrupt PNG blocks completion. Keep every existing resource in
  place and report affected path.
- Any actual secret visible in screenshot blocks completion. Approved avatars
  and browser, LangSmith, or thread identifiers do not.
- If screenshot cannot be matched to verified product behavior, block completion
  and report mismatch instead of omitting image or writing speculative guidance.
- Nine resource PNGs are already staged additions. Commit only those exact nine
  paths with path-limited Git command, leaving every unrelated index and worktree
  path untouched.
- Capture protected staged, tracked-worktree, and untracked state before
  implementation; compare it after each commit and final validation.
- Keep all nine resource files staged until dedicated resource commit. Do not
  alter their index entries except through exact path-limited commit.

## Validation

- Confirm exactly nine PNGs exist directly under `resources/`; compare current
  dimensions and SHA-256 hashes with baseline manifest and require exact matches.
- Confirm all nine filenames are referenced exactly once across four active
  guides: three feature guides plus LLM Wiki guide. Exclude this design and its
  implementation plan from reference counts.
- Resolve every local Markdown and image link after stripping fenced examples
  and optional angle brackets around destinations.
- Confirm no secondary screenshot asset directory or copied screenshot exists.
- Visually inspect all nine original resources at readable scale for
  legibility, correct workflow placement, corruption, and actual secrets. Accept
  user-approved avatars and identifiers.
- Format changed Markdown, run `git diff --check`, run `yarn lint`, and inspect
  implementation diff from recorded base HEAD.
- Compare protected staged, tracked-worktree, and unrelated untracked state with
  baseline. Application code, generated files, and unrelated changes remain
  untouched.
