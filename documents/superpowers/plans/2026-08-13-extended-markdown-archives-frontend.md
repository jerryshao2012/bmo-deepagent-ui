# Extended Markdown Archives and Office Attachments Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let intro Markdown users paste/drop, render, and download validated `.7z`/TAR archives plus opaque Microsoft Office files through the existing synchronized asset pipeline and type-neutral URLs.

**Architecture:** Put archive and Office format knowledge in one pure attachment helper shared by validation, authoritative response classification, and card labels. Existing proxy, `/__markdown-attachment/<uuid>` references, five-file cap, and 10 MiB limit remain unchanged. One build-time gate disables only new post-ZIP archive/Office selections; rendering and downloading stored formats stays enabled.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, Testing Library, Tailwind, Yarn 4.

**Design specs:** Backend repository `../specs/2026-08-13-markdown-archive-attachments-design.md` and `../specs/2026-08-13-markdown-office-attachments-design.md`.

**Backend prerequisite:** Complete and verify `2026-08-13-extended-markdown-archives-backend.md` before deploying or exercising frontend uploads against a live service.

---

## File map

- Create `../../../src/lib/markdown-attachment-types.ts`: archive table, complete Office extension/family table, response-type detection, labels, and shared upload gate.
- Create `../../../tests/markdown-attachment-types.test.ts`: archive MIME/suffix tests plus every Office extension, MIME independence, gating, and labels.
- Modify `../../../src/lib/markdown-images.ts`: use shared attachment helpers for clipboard/drop acceptance, errors, and authoritative attachment Markdown generation.
- Modify `../../../src/app/components/SyncedMarkdownAttachment.tsx`: render archive/Office descriptions without fetching bytes.
- Modify `../../../tests/markdown-images.test.ts`: mixed-format validation, ordered Markdown, limits, and proxy forwarding.
- Modify `../../../tests/synced-markdown-attachment.test.tsx`: format labels, download behavior, and fallback.
- Modify `../../../tests/markdown-preview-sync.test.mjs`: assert type-neutral URL contract remains unchanged.
- Modify `src/app/api/markdown-images/[markdownId]/[[...assetPath]]/route.ts`: forward backend nosniff header with existing safe response headers.
- Modify `../../../package.json`: include new pure helper test in `test:markdown-images`.
- Modify `../../../Dockerfile`, `../../../build.sh`, `../../../.env.docker.example`, and `../../../README.md`: expose rollback-safe build-time upload gate.
- Modify `../../../tests/build-docker-hub.test.mjs`: assert standard container build forwards the gate.

### Task 1: Add pure archive and Office attachment contract

**Files:**
- Create: `../../../src/lib/markdown-attachment-types.ts`
- Create: `../../../tests/markdown-attachment-types.test.ts`
- Modify: `package.json:17`

- [ ] **Step 1: Write failing format-table tests**

Add table-driven tests covering:

```typescript
const accepted = [
  ["bundle.zip", "application/zip", "ZIP archive"],
  ["bundle.7z", "application/x-7z-compressed", "7Z archive"],
  ["bundle.7z", "application/vnd.7zip", "7Z archive"],
  ["bundle.tar", "application/x-tar", "TAR archive"],
  ["bundle.tar.gz", "application/gzip", "Gzipped TAR archive"],
  ["bundle.tgz", "application/x-gzip", "Gzipped TAR archive"],
] as const;

for (const [name, type, label] of accepted) {
  assert.equal(isSupportedMarkdownArchiveFile({ name, type }, true), true);
  assert.equal(markdownArchiveLabel(name), label);
}
```

Also cover every archive MIME from approved spec, uppercase filenames, `.tar.gz` longest-suffix matching, extension/MIME mismatches, and misleading names such as `bundle.tar.gz.exe`.

Add one case per Office extension from the approved Office spec. Assert extension matching is case-insensitive, MIME is ignored, family labels are exact, and `report.docx.exe` plus generic exports are rejected.

- [ ] **Step 2: Write failing gate/read-compatibility tests**

Assert `extendedEnabled=false` still accepts ZIP but rejects 7z/TAR/gzipped TAR and every Office family. Separately assert stored-response classification recognizes all archive normalized types and Office `application/octet-stream` regardless of gate.

- [ ] **Step 3: Add new test file to focused script**

Change `test:markdown-images` to:

```json
"test:markdown-images": "node --import tsx --test --test-isolation=none tests/markdown-attachment-types.test.ts tests/markdown-images.test.ts tests/synced-markdown-attachment.test.tsx"
```

- [ ] **Step 4: Run tests and confirm failure**

Run:

```bash
yarn test:markdown-images
```

Expected: FAIL because helper module is absent.

- [ ] **Step 5: Implement one ordered format table**

Use a pure record/array containing suffix, accepted MIME set, normalized backend content type, and card label. Check `.tar.gz` before `.tgz`, `.zip`, `.7z`, and `.tar`.

```typescript
export const MARKDOWN_ARCHIVE_CONTENT_TYPES = new Set([
  "application/zip",
  "application/x-7z-compressed",
  "application/x-tar",
  "application/gzip",
]);

export function isMarkdownArchiveContentType(contentType: string): boolean {
  return MARKDOWN_ARCHIVE_CONTENT_TYPES.has(contentType.toLowerCase());
}

export function isMarkdownAttachmentAsset(asset: {
  filename: string;
  contentType: string;
}): boolean {
  return (
    isMarkdownArchiveContentType(asset.contentType) ||
    (asset.contentType.toLowerCase() === "application/octet-stream" &&
      officeFamilyForFilename(asset.filename) !== null)
  );
}
```

Allowed selection MIME values must exactly match approved design, including empty and `application/octet-stream` for every archive.

Define the complete Office extension table once and derive `officeFamilyForFilename()` and labels from it. Never use Office MIME or payload content.

- [ ] **Step 6: Implement upload gate without affecting reads**

Export:

```typescript
export const EXTENDED_MARKDOWN_ATTACHMENT_UPLOADS_ENABLED =
  process.env.NEXT_PUBLIC_MARKDOWN_EXTENDED_ATTACHMENTS_ENABLED !== "false";
```

Archive selection checks MIME and suffix; Office selection checks suffix only and ignores MIME. The gate applies to 7z/TAR/TAR.GZ/TGZ and Office, never ZIP. Stored response classification and card-label helpers never check the gate.

- [ ] **Step 7: Run helper tests**

Run:

```bash
yarn test:markdown-images
```

Expected: format helper tests pass; existing tests remain green.

- [ ] **Step 8: Commit format contract**

```bash
git add src/lib/markdown-attachment-types.ts tests/markdown-attachment-types.test.ts package.json
git commit -m "feat: define markdown attachment formats"
```

### Task 2: Generalize paste/drop validation and Markdown generation

**Files:**
- Modify: `src/lib/markdown-images.ts:11-63,140-153,258-294`
- Modify: `tests/markdown-images.test.ts:64-112,162-207,280-320`

- [ ] **Step 1: Write failing selection tests for all formats**

Extend `validateMarkdownAssetFiles()` tests with all archive suffix/MIME variants and every Office family using empty, incorrect, and generic MIME. Cover uppercase names, misleading suffixes, a 10 MiB + 1 byte attachment, and six-item mixed image/archive/Office gestures. Expected: at most five accepted in original order, same size cap as images.

- [ ] **Step 2: Write failing authoritative-response Markdown tests**

Create backend response assets using all normalized archive content types and Office `application/octet-stream` plus an allowed filename. Assert every non-image emits:

```markdown
[filename.ext](/__markdown-attachment/<uuid> "size=<bytes>")
```

Assert images remain `![](/__markdown-image/<uuid>)`; output order is unchanged; output contains no archive/Office family, extension, MIME, or type marker in URL paths. Assert `application/octet-stream` with a non-Office filename does not silently become an attachment.

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```bash
yarn test:markdown-images
```

Expected: new formats are rejected or rendered as images.

- [ ] **Step 4: Replace ZIP-only checks with shared helpers**

In `isSupportedMarkdownAssetFile()`, call the shared archive/Office selector before image matching. In `buildSyncedAssetMarkdown()`, call `isMarkdownAttachmentAsset({ filename, contentType: asset.content_type })`; Office requires both authoritative backend octet-stream type and cataloged safe filename, while archive types remain authoritative. Never classify an image from filename.

- [ ] **Step 5: Generalize validation errors**

When gate is enabled, use a concise `Only supported images, archives, and Microsoft Office files can be uploaded` message; unit tests own the exact catalog. When disabled, advertise current image and ZIP set. Keep error codes, shared count, shared byte limit, and ordered results unchanged.

- [ ] **Step 6: Extend proxy batch test without changing route code**

Use multiple five-file proxy cases to cover `.7z`, `.tar`, `.tar.gz`, `.tgz`, and representative Office files with intentionally incorrect MIME. Assert names/types and ordering reach backend URL `/markdown-threads/123456/images`; assert no format keyword appears in request path.

- [ ] **Step 7: Run focused suite**

Run:

```bash
yarn test:markdown-images
```

Expected: all tests pass.

- [ ] **Step 8: Commit pipeline generalization**

```bash
git add src/lib/markdown-images.ts tests/markdown-images.test.ts
git commit -m "feat: paste extended markdown attachments"
```

### Task 3: Render archive and Office attachment cards

**Files:**
- Modify: `src/app/components/SyncedMarkdownAttachment.tsx:28-32`
- Modify: `../../../tests/synced-markdown-attachment.test.tsx`

- [ ] **Step 1: Write failing card-label tests**

Render one component for each name and assert:

```typescript
assert.ok(screen.getByText("ZIP archive · 1.5 MiB"));
assert.ok(screen.getByText("7Z archive · 1.5 MiB"));
assert.ok(screen.getByText("TAR archive · 1.5 MiB"));
assert.ok(screen.getByText("Gzipped TAR archive · 1.5 MiB"));
```

Add `.tar.gz`, `.tgz`, every Office family label, uppercase variants, unknown filename fallback `Attachment`, and missing-size cases. Keep accessible Download button and disabled-download context tests.

- [ ] **Step 2: Run component tests and confirm failure**

Run:

```bash
node --import tsx --test --test-isolation=none tests/synced-markdown-attachment.test.tsx
```

Expected: non-ZIP labels fail.

- [ ] **Step 3: Use shared filename label helper**

Replace hard-coded ZIP description with:

```typescript
const attachmentLabel = markdownAttachmentLabel(filename);
const description = formattedSize
  ? `${attachmentLabel} · ${formattedSize}`
  : attachmentLabel;
```

Do not add a metadata request or fetch bytes during render. Add an explicit test that Office card rendering performs no `fetch` and does not mount/invoke `DocumentViewerPanel`, `DocxViewer`, `XlsxViewer`, or `PptxViewer`.

- [ ] **Step 4: Verify download path stays type-neutral**

Run component download test for a `.tar.gz` filename and assert existing URL ends only in `/<uuid>/download` under `/api/markdown-images/123456`; filename comes from `Content-Disposition`.

- [ ] **Step 5: Run focused suite**

Run:

```bash
yarn test:markdown-images
```

Expected: all helper/card/proxy tests pass.

- [ ] **Step 6: Commit card labels**

```bash
git add src/app/components/SyncedMarkdownAttachment.tsx tests/synced-markdown-attachment.test.tsx
git commit -m "feat: label markdown attachment cards"
```

### Task 4: Protect canonical rendering and intro integration

**Files:**
- Modify: `tests/markdown-preview-sync.test.mjs:152-174`
- Modify: `src/app/api/markdown-images/[markdownId]/[[...assetPath]]/route.ts:89-98`
- Modify: `../../../tests/markdown-images.test.ts`
- Verify: `src/app/components/MarkdownContent.tsx:795-845`
- Verify: `src/app/intro/page.tsx:639-723`

- [ ] **Step 1: Extend canonical-path contract test**

Assert source continues routing only `/__markdown-attachment/<uuid>` through `SyncedMarkdownAttachment`; explicitly reject `__markdown-zip`, `__markdown-7z`, `__markdown-tar`, and any format-specific logical path.

- [ ] **Step 2: Extend intro pipeline contract test**

Assert intro continues using shared `isSupportedMarkdownAssetFile`, `validateMarkdownAssetFiles`, one `uploadMarkdownAssets` call, and `buildSyncedAssetMarkdown`; no format-specific handler is added.

- [ ] **Step 3: Write proxy security-header regression and minimal fix**

Write a proxy regression for both view and download GET forms. Mock backend responses with `Content-Disposition`, `Content-Type`, `Cache-Control`, and `X-Content-Type-Options: nosniff`; assert frontend responses preserve all values unchanged. Then add `x-content-type-options` to the proxy header allowlist.

- [ ] **Step 4: Run preview-sync and proxy contracts**

Run:

```bash
node --test tests/markdown-preview-sync.test.mjs
yarn test:markdown-images
```

Expected: all pass without production changes in `MarkdownContent` or intro page; proxy differs only by forwarding `x-content-type-options`.

- [ ] **Step 5: Commit proxy and contract tests**

```bash
git add src/app/api/markdown-images/[markdownId]/[[...assetPath]]/route.ts tests/markdown-images.test.ts tests/markdown-preview-sync.test.mjs
git commit -m "fix: preserve attachment security headers"
```

### Task 5: Wire rollback-safe frontend upload gate

**Files:**
- Modify: `Dockerfile:5-8`
- Modify: `build.sh:403-431` and its config allowlist/parser sections
- Modify: `../../../.env.docker.example`
- Modify: `README.md:65-78`
- Modify: `../../../tests/build-docker-hub.test.mjs`

- [ ] **Step 1: Write failing container-build contract test**

Assert `../../../Dockerfile` declares and exports `NEXT_PUBLIC_MARKDOWN_EXTENDED_ATTACHMENTS_ENABLED`, and `../../../build.sh` forwards it as a build arg with default `true`.

- [ ] **Step 2: Run deployment contract test and confirm failure**

Run:

```bash
node --test tests/build-docker-hub.test.mjs
```

Expected: new gate assertions fail.

- [ ] **Step 3: Add Docker build arg**

Add:

```dockerfile
ARG NEXT_PUBLIC_MARKDOWN_EXTENDED_ATTACHMENTS_ENABLED=true
ENV NEXT_PUBLIC_MARKDOWN_EXTENDED_ATTACHMENTS_ENABLED=$NEXT_PUBLIC_MARKDOWN_EXTENDED_ATTACHMENTS_ENABLED
```

- [ ] **Step 4: Forward and document the build value**

In `../../../build.sh`, accept only `true` or `false`, default to `true`, and pass `--build-arg "NEXT_PUBLIC_MARKDOWN_EXTENDED_ATTACHMENTS_ENABLED=$EXTENDED_ATTACHMENTS_ENABLED"`. Add example/documentation explaining: set `false` to stop new 7z/TAR and Office selections while stored cards/downloads remain supported.

- [ ] **Step 5: Run deployment contract test**

Run:

```bash
node --test tests/build-docker-hub.test.mjs
```

Expected: all pass.

- [ ] **Step 6: Commit rollout gate**

```bash
git add Dockerfile build.sh .env.docker.example README.md tests/build-docker-hub.test.mjs
git commit -m "build: gate extended attachment uploads"
```

### Task 6: Frontend verification

**Files:**
- Verify all changed frontend files.

- [ ] **Step 1: Run focused asset tests**

```bash
yarn test:markdown-images
node --test tests/markdown-preview-sync.test.mjs
```

Expected: all pass.

- [ ] **Step 2: Run API contract check**

```bash
yarn contract:check
```

Expected: existing `/api/markdown-images/...` and backend `/markdown-threads/{markdown_id}/images/...` contract remains valid.

- [ ] **Step 3: Run lint**

```bash
yarn lint
```

Expected: exit 0.

- [ ] **Step 4: Run production build**

```bash
yarn build
```

Expected: production build succeeds.

- [ ] **Step 5: Inspect Threadroot score**

```bash
threadroot score latest
```

Expected: focused verification evidence is recorded.

- [ ] **Step 6: Confirm clean branch state**

```bash
git status --short
git log --oneline main..HEAD
```

Expected: no uncommitted changes; only scoped frontend commits.

### Task 7: End-to-end local integration and merge preparation

**Files:**
- Verify both repositories; no new code expected.

- [ ] **Step 1: Start backend with extended uploads enabled**

```bash
MARKDOWN_EXTENDED_ATTACHMENT_UPLOADS_ENABLED=true uv run uvicorn webapp:app --host 127.0.0.1 --port 2024
```

Expected: backend starts and retains existing authenticated routes.

- [ ] **Step 2: Start frontend against local backend**

```bash
NEXT_PUBLIC_MARKDOWN_EXTENDED_ATTACHMENTS_ENABLED=true NEXT_PUBLIC_LANGGRAPH_URL=http://127.0.0.1:2024 yarn dev
```

Expected: intro page loads.

- [ ] **Step 3: Smoke-test one mixed five-file gesture**

Use multiple maximum-five paste/drop gestures covering image, ZIP, 7z, TAR, TGZ, and each Office family. Expected: ordered Markdown insertion, unchanged image previews, correctly labeled archive/Office cards, type-neutral attachment URLs, and authenticated exact-byte downloads with original filenames.

- [ ] **Step 4: Smoke-test cleanup and gate rollback**

Remove intro content and confirm namespace deletion. Rebuild frontend with extended gate false: expected new 7z/TAR and Office formats are ignored/rejected, while previously synchronized extended cards still render and download when their Markdown/storage remains.

- [ ] **Step 5: Request code review before merge**

Use `superpowers:requesting-code-review` across both branch diffs and fix all critical/important findings.

- [ ] **Step 6: Merge only after both repositories are clean and verified**

Use `superpowers:finishing-a-development-branch`; merge backend local `main` first, then frontend local `main`. Do not push or deploy unless separately requested.
