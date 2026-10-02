# Claude 3 — Phase 6 upload: handoff (no repo checkout, no git, no network, no Next/React toolchain was available)

## Apply
Copy `src/**` over the repo (3 files are NEW outside `media/upload/`; 2 are EDITS: see `validation.diff`, `page.diff`).
Tests/stubs/tsconfigs are scaffolding for the sandbox only; port tests into the repo's chosen runner in Phase 9.

## Files
NEW  src/modules/media/upload/{types,messages,metadata,exif,coalesce,summary,queue}.ts   (pure, framework-free)
NEW  src/modules/media/upload/{browser-put,browser-measure,browser-session,useUploadQueue}.ts, status-action.ts ("use server")
NEW  src/modules/media/components/{AddMemories,UploadTray}.tsx
EDIT src/modules/media/validation.ts  — only `export` added to MAX_PHOTO_BYTES / MAX_VIDEO_BYTES (single source of limits)
EDIT src/app/(app)/trips/[tripId]/page.tsx — header: <AddMemories/> for every member; owner Edit/Delete unchanged

## Contracts
- Consumes (unchanged): requestMediaUploadAction, confirmMediaUploadAction, ALLOWED_MIME_TYPES, validateDeclaredFileSize.
- Adds one read-only action `getUploadStatusAction(mediaId)` (caller's own media row via existing RLS, same scoping as confirm's lookup). No SQL/RLS/grant change.
- Integration point for Claude 2: after confirms, `router.refresh()` (coalesced 1.5s window + one flush on drain). Timeline must be Server-Component data (or otherwise refresh with the route); no second dataset.

## Key behaviours
- Slot (max 3 items, max 1 video — [H]) acquired -> prepare metadata -> request -> immediate XHR PUT of the original File (same Content-Type) -> confirm.
- PUT failure: retry = NEW request/mediaId. Confirm throw/timeout: reconcile via status; auto re-confirm (2x, backoff) with SAME mediaId; manual "Try again" also reconciles first. Server-marked failed/missing -> restart.
- Session end detected with browser `getUser()` (a Server Action can't report it: proxy redirects it).
- captured_at: EXIF DateTimeOriginal (+OffsetTimeOriginal, else browser tz) for JPEG and HEIC/HEIF, else null. Videos: null. PNG/WebP: null. Never lastModified.

## Findings for Claude 1 (not changed by me)
1. r2.ts: AWS SDK v3 >= ~3.729 defaults `requestChecksumCalculation: "WHEN_SUPPORTED"`; presigned PUT URLs may then embed an `x-amz-checksum-*` query param that R2 rejects/mismatches for real bodies. INFERRED from known SDK/R2 behaviour, UNVERIFIED here. Check with one real browser PUT; fix is `requestChecksumCalculation: "WHEN_REQUIRED"` in the S3Client config.
2. R2 bucket CORS must allow: origins (local + deployed), method PUT, header Content-Type. UNVERIFIED.
3. confirmMediaUploadAction collapses all RPC errors into one generic message, so "lost membership" is indistinguishable from transient failure in the UI.
4. A file with empty `file.type` (e.g. .heic on desktop Chrome/Windows) is rejected as unsupported; I do not guess a type from the extension.

## Not done / not verified: see the chat report.
