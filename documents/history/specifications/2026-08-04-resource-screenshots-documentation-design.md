# Resource Screenshot Documentation Design

## Goal

Move nine existing product screenshots from `resources/` into repository-owned
documentation assets, sanitize visible personal and trace identifiers, and embed
each image in focused user guidance. Keep screenshots contextual, accessible,
and maintainable instead of creating a standalone gallery.

## Documentation structure

Create `documents/assets/screenshots/` for sanitized PNG assets and
`documents/features/` for concise feature guides. Add three active guides:

1. `documents/features/deep-research.md` explains the completed research flow,
   tool activity, generated report, and state-file access.
2. `documents/features/langsmith-integration.md` explains how a research run is
   inspected as a LangSmith graph and trace.
3. `documents/features/skills.md` explains skill configuration, discovery,
   invocation, and result review.

Add the three LLM Wiki screenshots to the existing
`documents/llm-wiki/llm-wiki.md` beside the workflow each image demonstrates.
Add a Features section to `documents/README.md` linking the three new guides.
Do not duplicate the new screenshots in root `README.md` or create a screenshot
gallery.

## Asset mapping

Move each source to a descriptive, URL-safe destination after sanitization:

| Source                                                            | Destination                                                    | Documentation use                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `resources/Deep_Research 2026-04-03 at 12 44 11 PM.png`           | `documents/assets/screenshots/deep-research-completed-run.png` | Completed Deep Research run and generated report |
| `resources/LangSmith_Integration 2026-04-03 at 10 27 11 AM.png`   | `documents/assets/screenshots/langsmith-trace-inspection.png`  | LangSmith graph and trace inspection             |
| `resources/LLM_Wiki_Index-20260723-qcgl.png`                      | `documents/assets/screenshots/llm-wiki-index.png`              | Wiki tree and index inspection                   |
| `resources/LLM_Wiki_Query 2026-07-04 at 9 31 11 AM.png`           | `documents/assets/screenshots/llm-wiki-document-citation.png`  | Grounded answer linked to a cited PDF page       |
| `resources/LLM_Wiki_Query 2026-07-27 at 12 18 11 PM.png`          | `documents/assets/screenshots/llm-wiki-grounded-query.png`     | Grounded financial answer with source evidence   |
| `resources/Skills - Configuration_Skills-20260723-pznq.png`       | `documents/assets/screenshots/skills-configuration.png`        | Skills configuration tab                         |
| `resources/Skills - Available Skills-20260723-pztn.png`           | `documents/assets/screenshots/skills-catalog.png`              | Available-skills drawer                          |
| `resources/Skills - Apply a Skill-20260723-qaar.png`              | `documents/assets/screenshots/skills-application-request.png`  | Skill invocation request                         |
| `resources/Skills - Result of Applying a Skill-20260723-qaee.png` | `documents/assets/screenshots/skills-application-result.png`   | Generated skill result                           |

Before editing, record every source filename, pixel dimensions, and SHA-256 hash.
Create sanitized destinations while originals remain available, then compare
dimensions and visually verify fidelity and privacy. Remove the original
`resources/` PNGs only after all nine replacements and references pass those
checks. Preserve PNG format and original pixel dimensions.

## Sanitization and accessibility

Use image editing only for privacy sanitization:

- Replace every personal avatar in browser profile chrome and application-shell
  chrome with a neutral, non-identifying circle in every screenshot.
- Remove local thread IDs from browser address bars while preserving useful route
  context such as `localhost:3000` and assistant selection.
- Remove LangSmith organization and thread identifiers from browser chrome while
  preserving the LangSmith domain and trace-view context.
- Redact the LangSmith in-application `Thread <UUID>` trace identifier. Preserve
  the surrounding trace controls and the fact that a thread is selected.
- Preserve all other application content, citations, document names, controls,
  layout, colors, and workflow evidence. Do not crop explanatory UI or alter
  displayed results.
- Visually inspect every edited image at readable scale. Reject an edit if it
  changes non-sensitive application content or introduces artifacts.

Every Markdown embed uses a relative path from its guide, descriptive alt text
that states the demonstrated action, and a one-sentence caption that explains
why the screenshot matters. Captions must not repeat surrounding prose or rely
on color alone.

## Guide contents and placement

The feature guides remain concise and task-oriented. Each guide includes purpose,
prerequisites or configuration boundaries, workflow steps, the relevant image at
the step it illustrates, and a short troubleshooting or interpretation section.
Content must describe behavior confirmed by current repository code or existing
maintained guides; do not infer setup details from screenshots alone.

The LangSmith guide is limited to external LangSmith Studio graph and trace
inspection. It must not imply that this UI automatically opens LangSmith,
constructs trace links, or configures tracing unless current repository code or a
maintained guide verifies that behavior.

Place LLM Wiki images as follows:

- `llm-wiki-index.png` near workspace tree and file inspection.
- `llm-wiki-document-citation.png` near the query flow and citation behavior.
- `llm-wiki-grounded-query.png` near the explanation of grounded answers and
  original-source evidence.

Historical plans and specifications remain unchanged except for this new design
record. Existing externally hosted screenshots in root `README.md` are outside
scope.

## Failure handling and maintenance

- If sanitization cannot preserve original content, retain the source image and
  stop before removing it from `resources/`.
- If any screenshot cannot be matched to verified product behavior, block task
  completion, keep that source, and report the mismatch rather than omitting the
  image or writing speculative instructions. Run success validation only after
  all nine uses are verified.
- The nine source PNGs are already staged. Capture a pre-change staged/worktree
  snapshot, then adjust index entries for only the nine mapped source paths after
  replacements pass validation. Confirm no old `resources/` screenshot path
  remains in staged diff and compare all unrelated staged/worktree paths with the
  snapshot. If path-limited index adjustment is not authorized, stop and report
  that unsanitized staged originals could leak into a later commit.
- Local image links must remain relative and resolve on GitHub and local Markdown
  renderers.
- Future screenshot replacements should keep stable destination names when they
  demonstrate the same workflow, limiting documentation churn.

## Validation

- Confirm exactly nine PNG files exist under `documents/assets/screenshots/` and
  none of the nine source PNGs remain under `resources/`.
- Confirm all nine images are referenced once from active documentation and no
  Markdown link still targets the old resource filenames.
- Compare every destination with the pre-edit source manifest: dimensions must
  match and source hashes must remain recorded for audit. Visually inspect every
  sanitized image for legibility, expected redactions, and unintended edits while
  originals still exist.
- Inspect each defined redaction region for exposed browser-profile or
  application-shell avatars, browser-address local/LangSmith identifiers, and the
  LangSmith in-application thread UUID. Scan Markdown and other screenshot areas
  for secrets without treating preserved non-sensitive application content as a
  redaction failure.
- Check every local Markdown and image link, format changed Markdown, run
  `git diff --check`, and run `yarn lint`.
- Review final diff to ensure application code, generated files, and unrelated
  worktree/index changes remain untouched. The only permitted staged-state
  changes are path-limited replacement of the nine mapped source screenshots.
