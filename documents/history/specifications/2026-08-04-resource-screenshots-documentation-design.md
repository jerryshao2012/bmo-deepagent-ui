# Resource Screenshot Documentation Design

## Goal

Move nine existing product PNGs from `resources/` into maintained documentation
assets without changing their bytes, then embed each destination once in focused
user guidance. Keep screenshots contextual and maintainable instead of creating a
standalone gallery.

## Documentation structure

Store original PNG bytes under `documents/assets/screenshots/` using stable,
URL-safe names. Create three concise feature guides:

1. `documents/features/deep-research.md` explains completed research flow, tool
   activity, generated report, and state-file access.
2. `documents/features/langsmith-integration.md` explains inspection of a
   research run as a LangSmith graph and trace.
3. `documents/features/skills.md` explains skill configuration, discovery,
   invocation, and result review.

Embed three LLM Wiki screenshots in `documents/llm-wiki/llm-wiki.md` beside the
workflows they demonstrate. Add a Features section to `documents/README.md`
linking three new guides. Do not duplicate screenshots in root `README.md` or
create a screenshot gallery. Existing externally hosted root README screenshots
remain out of scope.

## Unchanged move mapping

Each source moves exactly once to its mapped destination with identical SHA-256
hash and pixel dimensions:

| Source                                                            | Destination                                                    | Documentation use                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `resources/Deep_Research 2026-04-03 at 12 44 11 PM.png`           | `documents/assets/screenshots/deep-research-completed-run.png` | Completed Deep Research run and generated report |
| `resources/LangSmith_Integration 2026-04-03 at 10 27 11 AM.png`   | `documents/assets/screenshots/langsmith-trace-inspection.png`  | LangSmith graph and trace inspection             |
| `resources/LLM_Wiki_Index-20260723-qcgl.png`                      | `documents/assets/screenshots/llm-wiki-index.png`              | Wiki tree and index inspection                   |
| `resources/LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png`           | `documents/assets/screenshots/llm-wiki-document-citation.png`  | Grounded answer linked to cited PDF page         |
| `resources/LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png`          | `documents/assets/screenshots/llm-wiki-grounded-query.png`     | Grounded financial answer with source evidence   |
| `resources/Skills - Configuration_Skills-20260723-pznq.png`       | `documents/assets/screenshots/skills-configuration.png`        | Skills configuration tab                         |
| `resources/Skills - Available Skills-20260723-pztn.png`           | `documents/assets/screenshots/skills-catalog.png`              | Available-skills drawer                          |
| `resources/Skills - Apply a Skill-20260723-qaar.png`              | `documents/assets/screenshots/skills-application-request.png`  | Skill invocation request                         |
| `resources/Skills - Result of Applying a Skill-20260723-qaee.png` | `documents/assets/screenshots/skills-application-result.png`   | Returned skill result                            |

Do not generate, transform, resize, crop, recolor, or otherwise edit screenshots.
Do not create intermediate image files. Source paths disappear only as direct
consequence of verified filesystem moves to mapped destinations.

## Publication and accessibility

User explicitly approved publication of original screenshot bytes as-is,
including visible avatars and browser, LangSmith, and thread identifiers. Prior
visual inspection found no visible API keys, tokens, or passwords. Approved
avatars and identifiers are accepted content, not validation failures. If later
inspection finds an actual secret, stop before move or publication and report
exact affected file; do not alter screenshot.

Every Markdown embed uses descriptive alt text, one-sentence caption explaining
why screenshot matters, and relative destination from active guide. Both
`documents/features/*.md` and `documents/llm-wiki/llm-wiki.md` use:

```markdown
![Descriptive action](../assets/screenshots/clean-name.png)
```

Captions do not repeat surrounding prose or rely on color alone.

## Guide contents and placement

Feature guides remain concise and task-oriented. Each includes purpose,
prerequisites or configuration boundaries, workflow steps, relevant screenshot
at illustrated step, and short troubleshooting or interpretation section.
Content describes behavior confirmed by current repository code or maintained
guides; screenshots provide evidence but do not establish setup details alone.

LangSmith guide is limited to external LangSmith Studio graph and trace
inspection. It must not imply this UI automatically opens LangSmith, constructs
trace links, or configures tracing unless current repository code or maintained
guide verifies that behavior.

Place LLM Wiki destinations as follows:

- `llm-wiki-index.png` near workspace tree and file inspection.
- `llm-wiki-document-citation.png` near query flow and citation behavior.
- `llm-wiki-grounded-query.png` near grounded answers and original-source
  evidence.

Historical plans and specifications remain unchanged except this revised design
record.

## Failure handling and Git safety

- Missing or corrupt source PNG blocks move. Keep all remaining sources in place
  and report affected path.
- Any actual secret visible in screenshot blocks completion. Approved avatars
  and browser, LangSmith, or thread identifiers do not.
- Any source-to-destination hash or dimension mismatch blocks index changes and
  commit. Preserve recoverable moved files and report exact mismatch.
- If screenshot cannot be matched to verified product behavior, block completion
  instead of omitting it or writing speculative guidance.
- Nine source PNGs are staged additions. Verify source manifest before moving,
  verify destination bytes before changing index, restore only exact old source
  paths from index, add only exact destinations, and commit only mapped
  destinations.
- Capture protected staged, tracked-worktree, and unrelated-untracked state at
  pinned base. Compare it after each implementation commit using exact intended
  path exclusions; every unrelated path remains untouched.

## Validation

- Confirm exactly nine mapped PNGs exist under
  `documents/assets/screenshots/`, no PNG remains under `resources/`, and no
  intermediate or generated image artifact exists.
- Compare every destination against original source manifest: SHA-256 and pixel
  dimensions must match exactly.
- Confirm all nine clean destination filenames are embedded exactly once across
  four active guides with `1+1+4+3` distribution. Exclude design and plan records
  from counts.
- Resolve every local Markdown and image link after stripping fenced examples
  and optional angle brackets around destinations.
- Visually inspect all nine moved originals at readable scale for legibility,
  correct workflow placement, corruption, and actual secrets. Accept approved
  avatars and identifiers.
- Format changed Markdown, run `git diff --check`, run `yarn lint`, and inspect
  implementation diff from pinned base HEAD.
- Compare protected cached, tracked-worktree, and unrelated-untracked state after
  Task 3, Task 4, Task 5, and final validation. Application code, generated files,
  and unrelated changes remain untouched.
