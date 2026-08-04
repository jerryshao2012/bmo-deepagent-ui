# Documentation Organization Design

## Goal

Make project documentation easy to discover, navigate, and maintain. Keep active
guides separate from historical planning records while preserving repository-level
instructions in their conventional locations.

## Structure

Use topic-based folders for active documents and a dedicated history tree:

```text
README.md
documents/
├── README.md
├── architecture/
├── authentication/
├── deployment/
└── history/
    ├── plans/
    └── specifications/
```

Keep `README.md` at repository root as project entry point. Keep `AGENTS.md` and
`CLAUDE.md` at repository root because development tools discover them there.

Move active guides into the matching topic folder. Move dated implementation
plans and design specifications into `documents/history/`. Preserve dates in
historical filenames so chronology remains visible.

| Current path                                                                            | Final path                                                                                   |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `documents/architecture/clean-architecture.md`                                          | `documents/architecture/clean-architecture.md`                                               |
| `documents/passkey-authentication.md`                                                   | `documents/authentication/passkey-authentication.md`                                         |
| `documents/vercel-deployment.md`                                                        | `documents/deployment/vercel.md`                                                             |
| `documents/superpowers/plans/2026-07-27-oracle-amd-deployment.md`                       | `documents/history/plans/2026-07-27-oracle-amd-deployment.md`                                |
| `documents/superpowers/plans/2026-08-03-passkey-authentication-documentation.md`        | `documents/history/plans/2026-08-03-passkey-authentication-documentation.md`                 |
| `documents/superpowers/specs/2026-07-27-oracle-amd-deployment-design.md`                | `documents/history/specifications/2026-07-27-oracle-amd-deployment-design.md`                |
| `documents/superpowers/specs/2026-08-03-passkey-authentication-documentation-design.md` | `documents/history/specifications/2026-08-03-passkey-authentication-documentation-design.md` |

Old locations will not retain compatibility stubs. Update repository-owned links
to final paths; external deep links to old paths may require downstream updates.

## Content cleanup

- Add `documents/README.md` with purpose, categorized links, and maintenance rules.
- Rework root `README.md` into clear overview, quick start, configuration,
  authentication, usage, deployment, and documentation sections. This broader
  editorial pass is part of requested review and polish, not migration-only work.
- Normalize heading levels, list spacing, link text, terminology, and command
  examples across active guides. Apply spelling and formatting fixes to historical
  plans and specifications without changing their decisions, commands, or
  historically accurate paths.
- Preserve technical meaning in architecture, authentication, deployment, plans,
  and specifications. In historical records, update navigational links but retain
  commands and paths that accurately describe original work; add a note when an
  old path could otherwise be mistaken for current guidance.
- Replace stale repository-document `docs/` paths with final `documents/` paths.
  Do not change runtime document-storage paths such as `docs/threads/...`.

## Compatibility

Update repository-owned references that depend on old document paths, including
root README links and architecture-boundary checks. Do not change application
behavior or generated source.

## Verification

- Confirm every tracked Markdown document has an intentional location.
- Check relative Markdown file links, same-file anchors, and cross-file fragments
  such as `guide.md#section` resolve from their containing files.
- Search for stale repository references matching `docs/architecture/`,
  `docs/passkey-authentication.md`, `docs/vercel-deployment.md`,
  `documents/passkey-authentication.md`, `documents/vercel-deployment.md`, and
  `documents/superpowers/`. Classify intentional matches in this migration table,
  verification instructions, and annotated historical records; exclude runtime
  storage paths such as `docs/threads/`. No unclassified stale reference may
  remain in current guidance, tests, or configuration.
- Run `git diff --check`.
- Run `yarn test:architecture` because its path assertion changes.
- Run AGENTS.md verification commands `yarn lint` and `yarn build`. If environment
  prevents either command, record exact failure and distinguish it from document
  changes.
