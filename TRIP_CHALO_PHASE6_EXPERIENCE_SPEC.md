# Trip Chalo — Product Experience + Interaction Specification (Final, Phase 6)

**Status:** Final. Incorporates the independent audit of the pre-implementation draft.
**Audience:** the implementation agent. This document is the implementation contract for Phase 6 (web).
**Scope:** experience and interaction only. No code, no dependency changes, no schema changes are made by this document.

---

## 0. How to read this

### 0.1 Tags

| Tag | Meaning | How to treat it |
|---|---|---|
| **[D]** | DECIDED — established product direction | Binding |
| **[R]** | RECOMMENDED — strong proposal, not yet a permanent product decision | Binding unless the owner overrides |
| **[H]** | HYPOTHESIS — validate with real users and devices | A starting value. Implement as a named constant or token so it can change without rework. Never a requirement |
| **[F]** | FUTURE — outside Phase 6 | Do not implement. Do not block |

Priority tiers: **Core** (must ship in Phase 6) and **Tier 2** (ship only after all Core is done, in the listed order). "Tier 2" is a priority label. It is unrelated to design principle P2.

### 0.2 Evidence basis and limits

This specification was written from a snapshot of the repository (migrations 0001–0015; the media, storage, trips, invitations and memberships modules; `project-tree.txt`; the project documents). The repository HEAD was **not** available when this was written. Anything marked "verify" below must be checked against HEAD before it is relied on.

### 0.3 Preflight — do this before writing any code

1. **Inspect HEAD for Phase 5 UI.** Does any route or component invoke `acceptInvitationAction`, `declineInvitationAction`, `revokeInvitationAction`, `inviteMemberAction` or `leaveTripAction`? Does any page render `MemberList`, `PendingInvitationsList` or `InvitedTripPreviewCard`? Record the result. It decides whether C17 exists (OD4). At snapshot time the answer was no: components and actions existed but nothing wired them.
2. **Inspect the current trip page** (`src/app/(app)/trips/[tripId]/page.tsx`) and record what it renders today.
3. **Verify the hosted PostgREST max-rows setting.** Locally `supabase/config.toml` sets `max_rows = 1000`. The hosted value is not in the repository.
4. **Verify R2 bucket CORS** allows a browser PUT (origin, `PUT`, `Content-Type` header) for the local and deployed origins. Run the request → PUT → confirm flow once end to end with a real file. The snapshot contains no evidence that this has been exercised.
5. **Confirm how the repo's Next.js version dispatches concurrent Server Action calls** before choosing the OD3 mechanism. My understanding, not verified here, is that client-invoked Server Actions are dispatched one at a time.
6. **Check on a real iPhone** how the file input's `accept` value affects HEIC handling (converted to JPEG, or delivered as HEIC).
7. **Create at least two test accounts in one trip** (via the existing invite/accept actions or SQL). Attribution and the person filter cannot be tested with one member.

### 0.4 Backend reality (what exists — do not invent beyond it)

| Area | What exists | Design consequence |
|---|---|---|
| Media list | `listTripMedia`: `ready` rows only, ordered by `chronology_at` (= `coalesce(captured_at, uploaded_at)`) then `id`. Metadata only, no URLs. Columns include width, height, duration, mime, size, filename, nullable `uploader_id`. No limit or range is applied. | Grouping, ordering and attribution need no extra queries. The API row cap applies (local config 1000; hosted **unverified**). |
| Image bytes | Originals only (≤ 25 MiB photo, ≤ 200 MiB video). No thumbnails, derivatives or placeholder data. | Sets the ceiling on grid performance (§18, OD2). |
| Download URLs | `getMediaDownloadUrl(id)`: re-runs an RLS-checked lookup on every call and presigns a URL valid 300 s. It is a server-side function and cannot be called from the browser. It does **not** validate the id shape. Presigned GETs carry no cache headers. | A URL from a page render expires after 5 minutes. Tiles and the viewer need URLs obtained close to use (OD3). |
| Access rule for media | `media_select_member` (as amended by 0015) admits the **uploader or a current member**. | A departed uploader can still read and delete their own uploads by id. Intentional (0015), and unreachable from the UI. |
| Upload | Request action → browser PUT to a signed URL (Content-Type is part of the signature) → confirm action (server verifies the R2 object; the only path to `ready`). Pending rows are hidden from the timeline. | The client owns the queue. Confirm does not revalidate the page. |
| Retry / cleanup | A request always creates a **new** row. There is no server-side sweeper for abandoned pending rows. The client holds the `mediaId`, and the existing `deleteMediaAction` can delete the uploader's own pending row (best effort). | Retry semantics depend on which step failed (§13). |
| Untrusted metadata | Width, height, duration and `captured_at` are client-supplied and not validated server-side. Only the filename is length-capped. | The client treats them as untrusted when laying out (§5). |
| Delete | Uploader or owner (RLS). The database is authoritative; R2 cleanup is best effort. `deleteMediaAction` revalidates the trip path. | Show Remove only to uploader or owner (presentation only). |
| Members | `listTripMembers` returns name, role, joined date and `avatar_url` (nothing observed setting it, so initials only). Profiles are visible to co-members only. | An uploader who left cannot be named: "A former member". An invitee cannot see the inviter's name. |
| Not present | Cover photo or colour, trip time zone, capture offset, last-seen, captions, places, favourites, video posters, forced download, member-removal action, batch member or count queries, typed error codes, realtime UI, pending-row sweeper, pagination. | Not in Phase 6. Do not fake them. |

### 0.5 Open decisions (owner approval needed)

| # | Decision | Recommendation |
|---|---|---|
| **OD1** | Time zone for time-of-day labels and day grouping: viewer-local, or UTC (the current convention, labelled). | **Viewer-local.** UTC would show a Mumbai 6:40 pm photo as 1:10 pm. Cost: grouping happens in the browser behind a height-stable skeleton, and viewers in different zones may see different day splits. A trip time zone [F] later replaces this. |
| **OD2** | The Phase 6 grid must load originals because no derivatives exist. | Proceed with originals, with strict windowing and capped concurrency (§18). Approve derivatives as the first post-Phase-6 item before any real-group or mobile use. |
| **OD3** | Two thin server-side additions. **(a)** An **authenticated server entry point** for obtaining signed URLs (browser → app server → the existing RLS-checked lookup → short-lived signed URL). It accepts multiple media ids per call (bounded by window size), validates each with `isMediaId`, returns `{id, url, ttlSeconds}` or a uniform "unavailable", and never exposes storage keys or R2 credentials. A Route Handler is preferred [R] (batching, future native reuse); a Server Action is acceptable for the single-item viewer. **(b)** A client-triggered, coalesced list refresh after confirms (preferred over `revalidatePath` inside every confirm). | Approve both. Neither adds a new capability. |
| **OD4** | Phase 5 people, invite and inbox UI. | Verify per §0.3. It is "absent" if no route or component invokes the Phase 5 actions and no page renders the Phase 5 list/preview components. If absent, building it is a **separate, approved addition with a single owner** (C17). It is not part of Phase 6 Core. |
| **OD5** | Source of `captured_at` when uploading. | **EXIF `DateTimeOriginal` when readable** (using `OffsetTimeOriginal` if present, otherwise interpreted in the uploader's browser zone, a known approximation), **else null.** `File.lastModified` is **not** used unless the owner explicitly accepts that wrong values are permanent and unlabelled (no source column exists and media rows cannot be updated). Without an EXIF reader, most photos, and all videos, appear under Undated, so the owner must decide whether a small EXIF reader dependency is approved for Phase 6. |
| **OD6** | Dark-mode phasing. | Define tokens for both modes now. Ship Phase 6 light-only app-wide (this fixes the inferred dark-mode breakage in Phase 3–5 screens, which use fixed `text-gray-*` classes over a background that switches dark), with an always-dark viewer. Enable dark mode app-wide when the Phase 8 retheme has tokenised every screen. |

---

## 1. Overall product experience

- **[D]** The concept is **"the trip, told by everyone."** Photos, people and time are the experience. Everything else is support. Privacy is felt as intimacy, not security UI.
- **[R]** Opening a trip should feel like re-entering a room the group left the lights on in: quiet, immediate and complete. One continuous chronological flow merges every phone. Attribution is always one gesture away and never loud. Photographs are the only saturated thing on screen.
- **[R]** "Trip as a book" survives in three small ways: a considered arrival (the title block), days as headings, and a finished trip that can end [F]. No page turns, spines, paper texture or shelf.
- **[D]** The web app is the current product. A genuine native app comes later. Interaction quality is a first-class requirement on both.
- **Scope note:** this document describes the target experience. Appendix C defines what Phase 6 ships: the media core (timeline, viewer, upload, delete) inside the existing trip page. Home restyle, the full visual system, dark mode and header polish belong to Phase 8.

## 2. Design principles

| ID | Principle | Tag |
|---|---|---|
| P1 | The trip, told by everyone. Chronology merges all contributors. Attribution is always one gesture away. | D |
| P2 | Photos are the only saturated thing. The interface has no brand colour. | R |
| P3 | Time as people remember it. Whitespace expresses gaps in time. The exact rules are tunable. | R (principle), H (rules) |
| P4 | Privacy is warmth. No padlocks, shields, "secure" or "encrypted" language. | D |
| P5 | Nothing performs. Motion communicates what changed and never decorates. | D |
| P6 | Stability. Space is reserved before content arrives. Layouts never jump. | D |
| P7 | Never hide or crop a photo to tidy a layout. | R |
| P8 | Immediate response. Feedback lands within a frame. Optimism only where failure is recoverable. | D |
| P9 | Honest about limits: undated photos, unavailable previews, uploads that need the tab open. | R |
| P10 | Every state is designed: loading, empty, error, permission. | D |
| P11 | Share rules, tokens and semantics across web and native. Never lock in shared components. | D |

## 3. Visual language

- **[R] The room.** Two designed neutral modes. Photos sit on the most neutral surfaces. Tints are allowed only on typographic surfaces away from photos. No gradients, glass, glow or decorative shadow. Separation is by luminance step or a 1px hairline. Shadows only on floating elements.
- **[R] Surfaces.** Three levels: page, raised (sheets, menus, tray), overlay (viewer). Cards only for real objects (an invitation, the upload tray, a member), never for content.
- **[H] The lamp.** One warm accent, used only as a dot or hairline for "active" (upload in progress, "you are here" in the day index). It never carries meaning alone and is never used for buttons or links. If it reads as decoration, drop it and use plain ink.
- **[R] Trip colour.** A muted ink per trip, derived deterministically from the trip id, for typographic covers (Phase 8). A cover-photo-derived colour is [F] (no cover reference exists).
- **[R] Radii, icons, imagery.** Photo tiles 2–4px. Floating sheets and menus 14–16px, concentric with their content. One outline icon family at a single stroke weight, few icons, with text labels wherever meaning matters (library unchosen [H]). Only user photographs as imagery: no illustration, mascots or emoji stickers.
- **[R] Buttons and focus.** Primary button is ink on paper in light mode and paper on ink in dark. Danger is one muted brick tone, used sparingly. Success is words plus a check, with no colour. Focus ring: 2px in the ink colour with a 2px offset, in both modes.

**Token roles** (intent, shareable with native as data). The values are **[H] starting points** with a hand-computed AA spot-check for secondary text, danger and the light lamp. Re-verify with tooling using the real palette. Text ≥ 4.5:1, non-text ≥ 3:1.

| Role | Light | Dark |
|---|---|---|
| `surface.page` | #F8F7F5 | #0E0E0F |
| `surface.raised` | #FFFFFF | #1A1A1B |
| `media.placeholder` | #E6E5E2 | #232324 |
| `ink.primary` | #171716 | #EDEDEB |
| `ink.secondary` (also timestamps, which must pass AA) | #5C5B56 | #A6A5A0 |
| `hairline` | #E2E1DD | #2C2C2D |
| `lamp` | #B7791F | #E0B45A |
| `danger` | #A63D2F | #E88C80 |
| `viewer.backdrop` | #000 (always) | #000 |

## 4. Typography

- **[R] Sans.** The project loads Geist, but `globals.css` sets `body` to Arial, so Geist is not applied. Applying it globally changes every existing screen, so it is a deliberate, approved change, not a side effect.
- **[R] Two-voice rule.** Text a person wrote or named (trip title, description, future captions and notes) is serif. Everything the app says (day headings, timestamps, buttons, counts) is sans.
- **[H] Serif family.** Undecided. Choose by testing candidates with real Latin and Devanagari titles. Phase 6 introduces no serif and only defines a `font.voice` token that falls back to the sans.
- **[R] Devanagari.** Users will plausibly write names and titles in Hindi. Every font stack needs an explicit Devanagari fallback and about 10% extra line height for mixed-script text. Test mixed-script baselines with real names.
- **[R] Numerals and inputs.** Tabular numerals for times, dates and counts. Inputs are at least 16px, which avoids iOS focus-zoom.
- **[R] Truncation.** Titles wrap and never truncate. Names truncate with an ellipsis only in dense UI.

**Scale roles** (mobile / desktop, **[H]** starting values):

| Role | Mobile | Desktop |
|---|---|---|
| Trip title | 32/38 | 44/48 |
| Day heading | 22/28 | 28/34 |
| Body | 16/24 | 16/24 |
| UI label | 14/20 | 14/20 |
| Meta (timestamps, counts) | 13/18 | 13/18 |

## 5. Spacing and layout

- **[R]** 4px base unit. Scale 4, 8, 12, 16, 24, 32, 48, 64, 96. Prose measure about 60–66 characters.
- **[R] Photos.** Justified rows at true aspect ratios, never cropped, with a 2px gap.
  - **[H]** Target row height about 160–200px on phones and 220–280px on desktop. The last row is not stretched beyond about 1.3×.
  - **[R] Untrusted dimensions.** Width and height are client-supplied. A non-finite or ≤ 0 value is treated as null. The layout clamps the aspect ratio to a tunable range (**[H]** about 1:4 to 8:1). The viewer always shows the true image. A tile with null dimensions reserves a 4:3 box and shows the image contained, so it never reflows on load.
  - **[R] Measuring.** When the client measures dimensions, it does so via browser decode (orientation-applied), not raw EXIF dimensions, which can be pre-rotation. If the browser cannot decode the file (for example HEIC outside Safari), dimensions are null.
- **[R] Whitespace is chronology.** Within a day, clusters are separated by more space than photos within a cluster, and days by much more than clusters. **[H]** Starting values: 24–32px between clusters, 64–96px between days.
- **[R] Phones.** Media edge to edge, text at 16px inset, safe-area insets respected. The existing shell adds about 40px of horizontal padding (`main p-6` plus `px-4`), so full-bleed is a layout decision on the trip page, never a global change and never a cause of horizontal scroll.
- **[D]** Space is reserved before load. No layout shift in the media area.

## 6. Light and dark mode

- **[R]** Both modes are designed, not inverted. Text is never pure black or white. The viewer is always dark, in both modes, and the light grid fades into it without a white flash.
- **[R]** Follow the system setting once dark is enabled (OD6). Phasing per OD6.
- **[H]** Contrast values in §3 must be verified with real photos in both modes.

## 7. Motion and interaction principles

- **[D] Motion communicates change.** No decorative motion, parallax, bounce or scroll-jacking. Stillness is the default.
- **[D] Spatial coherence.** Opening a photo must feel continuous with its tile, and closing must return to it. The technique is open **[H]**; the same applies to any library choice. The fallback is a crossfade. Reduced-motion users get instant or crossfade only.
- **[D] Immediate feedback.** Pressed state within one frame. No hover-only affordances: every hover action has a touch and keyboard equivalent. Touch targets are at least 44×44px **[R]**.
- **[R] Interruptible.** Open, close and sheet transitions can be cancelled or reversed mid-way.
- **[R] Motion tokens as intent, not implementation.** Named roles: press (≤ 100ms), quick (about 150–200ms), standard (about 250–320ms), and a release spring for drag. One easing family. All values **[H]**. Native will realise the same intent with platform physics.
- **[R] Optimism only where failure is recoverable.** Upload placeholders are optimistic. Delete is not (there is no undo), so it shows a pending state.
- **[R] History.** The viewer participates in browser history, so back and swipe-back close it.
- **[R]** Scroll position is never lost. Closing the viewer, finishing an upload or a refresh must not reset scroll.

## 8. Home (`/trips`) — Phase 8 target, no Phase 6 change

- **[R]** Pending invitations lead, because most people in a group arrive by invitation. Each shows the trip name and dates only (the preview RPC's shape). The copy cannot name the inviter, because the invitee cannot read the inviter's profile. Copy **[H]**: "You've been invited to Hampi · 14–19 Feb", with Accept and Decline.
- **[R]** Below that, the person's trips as large typographic covers in a single column (trip colour field, serif title, dates). Order is the existing newest-first. "Trip in progress rises to the top" **[H]** is derivable from dates.
- **[F]** Face stacks, "N new" and memory counts on home need batch queries and last-seen data that do not exist.
- **[R]** Empty state: a single primary action. Copy **[H]**: "No trips yet. Start one when you're ready."

## 9. Trip overview (`/trips/[tripId]`)

**Phase 6 Core touches the trip header only to add the "Add memories" action.** The existing header (title, dates, description, owner Edit/Delete) is otherwise unchanged. The Memories section is new.

Target composition (Phase 8 unless listed as Tier 2):
1. Title block: title, dates and length ("14–19 Feb · 6 days", computed from the date-only columns; existing "No dates set" fallback), description (clamp long ones with a "more" control).
2. People line: overlapping initials avatars (max 4–5 plus "+N") and a privacy line built from the member count: "Just the five of you." At one member: "Just you, for now." Wording **[H]**. No lock iconography.
3. Actions: **Add memories** (primary). Owner Edit and Delete secondary (moving them into an overflow menu is Phase 8).
4. Memories section: count, person filter, day index, days.

**Tier 2:** people line and privacy line, trip-length text, description clamp, and the sticky bar. **Sticky bar [R]:** when the title block scrolls away, a slim top bar shows the trip title and the Add action. It is top-placed for stability on mobile browsers whose toolbars resize. Bottom or thumb-zone placement is a native concern **[F]**.

**[R] Cover.** Phase 6 has no cover image (no cover reference exists), so the title block is a typographic cover. A hero photo, cover-derived colour and a finished-trip colophon are **[F]**. "In progress" and "ended" postures are **[H]/[F]**.

## 10. Chronological timeline and day experience

- **T1 [D]** The flow is ordered by **capture time**. Items without a capture time are **never placed by upload time inside a day**. They appear only in Undated (T5), ordered by upload time. The list is partitioned by `captured_at IS NULL`, **not** by `chronology_at`. `id` is the deterministic tie-break.
- **T2 [R]** Grouping is by calendar day in the display time zone (OD1). The boundary is one named constant, initially midnight. A late-night offset such as 04:00 is **[H]**, unvalidated, and must stay a constant, never hard-coded logic.
- **T3 [R]** Days without media do not render. Phase 6 shows no "quiet day" markers.
- **T4 [R]** Day heading: "Day 3" (only if the trip has a start date and the day falls within it), the date, and a memory count. App-generated, so sans.
- **T5 [R] Undated.** Items with a null capture time go into a final "Undated" section, ordered by upload time. It is honest about not knowing their place.
- **T6 [R] Time markers.** A quiet time label appears at the start of each cluster separated by a gap. The gap threshold is a tunable constant, initially 30 minutes **[H]**. Time is shown precisely ("6:42 pm"). Human buckets such as "Tuesday evening" are **[H]** (Phase 8, validate).
- **T7 [H] Contributors (Tier 2).** The marker also shows overlapping avatars and a count when two or more people contributed to the cluster ("3 of you"), derived from `uploader_id`. Full display names appear in accessible labels and the viewer.
- **T8 [R] Person filter (Tier 2).** "Sana's photos · 84", with one control to return to everyone. Client-side over the loaded list. It also scopes viewer navigation.
- **T9 [R] Day index (Tier 2).** A compact list of days that jumps to a day, with the lamp on the current day. A photo still per day is **[F]** (needs derivatives).

**[H]** Not Phase 6: "scale follows silence" (larger tiles after quiet stretches), morning/afternoon/evening/night segments, and the 4 am boundary as behaviour.
**[F]** A "since your last visit" divider (needs per-user last-seen), day notes, and chat lines in the timeline.

## 11. Photo/video viewer

**Structure.** A full-viewport dark overlay with dialog semantics. It contains the media (contained, never cropped), a top bar (close, "12 / 84", details toggle), previous/next controls, and a details panel.

- **Open/close [D principle, technique H].** Continuous with the tapped tile. Close returns to the last-viewed tile, and the grid scrolls to keep it visible (nearest edge).
- **Close [R].** Close button, Esc, browser back or swipe-back, and pull-down on touch (Tier 2; feasibility and quality on mobile browsers are **[H]**). The backdrop follows the finger during pull-down. If the gesture proves poor, the other paths must still work.
- **Navigate [R].** Arrow keys, swipe, and buttons. No wrap-around. Order equals timeline order, scoped by the active person filter. Prefetch at most the adjacent next and previous items, and only after the current one has settled **[H]**.
- **Zoom [R], Tier 2.** Double-tap or click zooms with pan. Pinch is an enhancement. Never disable the browser's own zoom.
- **Chrome [R].** It fades after idle (about 2–3s **[H]**) and returns on tap. It never auto-hides while keyboard or assistive focus is inside it.
- **Video [R].** Native controls, plays inline, sound on because the user tapped, no autoplay. Pause on navigation or close. Never preload neighbouring videos. No poster in Phase 6: the grid tile is a neutral placeholder with a play glyph and duration. A first-frame poster is best-effort where the browser supports it.
- **Details panel [R].** "Added by {name}" (or "A former member"), the time (precise, in the display zone), and a secondary reveal with filename, dimensions and size. If the capture time is null: "No capture time, shown by upload time." Actions: **Open original** and **Remove** (uploader or owner only).
- **Open original [R].** Opens a **fresh** signed URL in a new tab (with `noopener`). Whether the browser downloads or displays it is the browser's choice, since no forced download exists **[F]**. It is also the fallback for previews the browser cannot render.
- **Remove [R].** Inline confirmation, same pattern as the existing trip-delete panel: "Remove this photo for everyone in {trip}? This can't be undone." A pending state, then the viewer advances to the next item (or closes if none).
- **URL state [R].** Reflect the open item (for example `?media=<id>`) so back closes the viewer. The technique is open. A deep link to an item the viewer cannot access shows "This memory was removed."

**URL rules for images and video.**
- **[D]** Every URL issuance re-checks authorization server-side. URLs are short-lived (300 s) and are never persisted, and never memoised server-side.
- **[R]** The client may **reuse an issued URL for the same media within its lifetime minus a safety margin** (about 60 s **[H]**). That includes the viewer's full image and video range requests, and showing the tile's already-loaded image as the viewer's placeholder. It requests a new URL when the held one is near expiry, after a load error, and **always for Open original**.
- **[R]** Issued URLs are held in memory only, with their issue time. Never in browser storage, and never in the URL bar of the app (the `?media=` value is the media id, never a signed URL).

## 12. People and member experience

Implement only per Appendix C (C17 is conditional, OD4).

- **[R] People sheet** from the face stack: members (name, joined date, "Owner" as role), and for the owner or an inviter, pending invitations with revoke.
- **[R] Invite form** (email). Because RLS lets any new member see the whole trip history, the copy must say so: "They'll see everything in this trip, including what's already here."
- **[R] Leave.** Non-owners can leave, with a confirmation: "Your photos and videos stay in the trip." This is accurate: leaving removes only the membership row. Owners cannot leave (existing message).
- **[R]** Tapping a person offers "See the trip through {name}'s photos" (T8). No profile page, contribution counts or leaderboards.
- **[F]** Member removal (the policy exists but no action does), avatar upload, batch member queries.

## 13. Add-memory / upload experience

**Entry [R].** One **Add memories** action opens the native file picker directly (multiple; accept list from the existing allowlist). No intermediate modal. On phones the system picker offers library or camera. (Verify how `accept` affects iOS HEIC handling — §0.3.)

**Pipeline per file [D]** (the existing contract): pre-check → request action → browser PUT of the file with the same content type → confirm action → visible in the timeline.
- Pre-checks use the existing validators for type and size. A file that fails is rejected locally and never sent.
- The client measures width, height and (for video) duration itself. Capture time follows OD5. Values that fail sanity checks are dropped to null: non-finite or ≤ 0 dimensions, and `captured_at` in the future or before 1990 **[H]**.

**Queue states [R]:** `queued → requesting → uploading (progress) → confirming → done`; `failed (retryable)`; `rejected (local)`. The queue is in-memory only and is lost on reload **[F]** persistence. **Request a URL only when an upload slot is free** (the URL lives 300 s). Never request URLs for the whole batch up front.

**Retry depends on the step that failed [R].**
- Failure in `requesting` or `uploading`: retry makes a new request and a new PUT.
- Failure in `confirming`: refresh the list. If the item is present, mark it done. Otherwise call confirm again with the **same `mediaId`**. Never re-upload bytes for a confirm failure.
- Server-returned messages are shown as-is. Do not string-match them to invent distinct states.

**Cancel [R].** A queued item can be cancelled (Core). An item in `uploading` can be cancelled by aborting the PUT (Tier 2). Items in `requesting` or `confirming` are not cancellable. An aborted single PUT leaves no object in R2.

**Abandoned pending rows.** They are invisible and harmless. A server-side sweeper is **[F]**. **[R, optional]** The client may delete a known pending row it created (cancel or failed PUT) by calling the existing `deleteMediaAction` with its `mediaId`, as a best-effort cleanup.

**Tray [R].** A single quiet pill ("Adding 3 of 14") that expands into a tray. Each row shows a local preview, name, progress and, when needed, Retry. The lamp marks active progress. Byte-level progress if the technique allows, otherwise indeterminate. Concurrency is capped low (2–3 **[H]**). Files stream to the request and are never loaded fully into memory.

**Completion [R].** The timeline refreshes with a trailing debounce (about 1–2 s **[H]**) and once when the queue drains, preserving scroll (OD3b). Final line: "Added. Everyone in {trip} can see these." No confetti.

**Honesty [R].** While uploads are active: "Keep Trip Chalo open until this finishes." A leave-page warning is shown. The design does not pretend the web can upload in the background.

**[H]** Ghost tiles at the item's chronological position, dimmed and clearing when done, are the target, not Core (Tier 2). Core is the tray plus refresh.

**[R] Tier 2:** Desktop drag-and-drop with a "Drop to add to {trip}" veil. The button remains the primary and accessible path.

**Copy [R], wording [H]:** "Couldn't add this one. Check your connection and try again." "That's a big one. Clips can be up to 200 MB." "This file type isn't supported."

## 14. Loading, empty, error and permission states

| Surface | State | Behaviour |
|---|---|---|
| Trip page | Loading | The header renders first. The Memories area reserves height with a quiet skeleton, so nothing jumps when grouping resolves (OD1). |
| Trip page | Media load failure | Inline, in the Memories section only: "Couldn't load memories." with Retry. The header stays visible. Do not send it to the full-page `trips` error boundary. |
| Timeline | **Truncated list** | The list query uses an explicit limit at or below the verified row cap and detects truncation by exact count or limit+1, **never by comparing with a hardcoded number.** If truncated, show "Showing the earliest {N} memories; newer ones aren't shown yet.", with N the returned count. Filters and viewer navigation operate on the loaded set only. Pagination is [F]. |
| Timeline | Empty trip | Two actions: "Add the first memory" and, if the C17 UI exists, "Invite the others." |
| Timeline | Filter empty | "No photos from {name} yet." plus a return-to-everyone control. |
| Tile | Loading | Reserved aspect box, neutral fill, fade-in on load. |
| Tile | Image fails (expired URL, network) | One silent retry with a fresh URL, then a neutral tile with a retry affordance. |
| Tile/viewer | Preview unavailable (HEIC/HEIF, some MOV, unsupported in the browser) | "Can't preview this here." with **Open original**. Never a broken image. |
| Viewer | Loading | The tile's loaded image shows instantly, then the full image swaps in with no flash. |
| Viewer | Item no longer available | "This memory was removed." with Next. |
| Upload | Rejected locally / failed / cannot confirm | Per §13. |
| Upload | Session ended | "Your session ended. Sign in to continue." Return to the trip after login. The queue does not survive navigation. |
| Delete | Not permitted / not found | The existing single message (the two cases are indistinguishable by design). |
| Trip | Not a member | Existing not-found, unchanged **[D]**. |

**Tone rules [R]:** plain, warm, sentence case, no exclamation marks, no technical terms, no blame. Errors offer a next action and never use an alarm box.

## 15. Responsive web behaviour

Breakpoints follow Tailwind defaults (640, 1024) **[H]**.

| | Phone | Tablet | Desktop |
|---|---|---|---|
| Media width | Edge to edge | Contained | Contained, wider than prose (**[H]** about 1100–1200px); prose about 640–720px |
| Viewer | Full-bleed, swipe, pull-down | Same, with visible arrows | Arrows on hover/focus, keyboard (arrows, Esc, `i` for details) |
| Details | Bottom sheet | Bottom sheet | Side panel within the viewer **[H]** |
| Sheets | Bottom | Bottom | Bottom or centred (**[H]**) |
| Add | Header button, native picker | Same | Same, plus drag-and-drop (Tier 2) |

- **[R]** Same content model everywhere: one stream, wider on desktop. No permanent inspector, three-pane or dashboard layout.
- **[R]** Use `dvh` units and respect safe-area insets. Never place essential controls where mobile browser toolbars overlap.

## 16. Future native mobile (experience intent, all [F])

Native should feel like a genuine iPhone- or Android-grade product, not this web UI in a shell.
- **Native for controls, ours for content [R].** System sheets, pickers, context menus, share sheet, haptics and platform navigation (back-stack, large titles) are native. The cover, grid, viewer, typography and face stack are ours.
- **Photos.** System photo picker, background uploads that survive backgrounding, "Save to Photos", and share extension intake.
- **Viewer.** Native gestures and shared-element transitions, validated on real devices before commitment **[H]**.
- **Time.** Device capture time with offset, feeding the trip time zone.
- **Navigation.** A bottom tab bar arrives only if chat creates a second top-level destination. The trip-scoped flow uses back-stack navigation.
- **Also:** push notifications, offline reading, Dynamic Type and VoiceOver as first-class.
- **Preconditions.** Derivatives and placeholder data, a native-callable upload contract, and a token-authenticated signed-URL entry point must exist before native ships.

## 17. Accessibility

- **[D]** The experience must be usable by keyboard, screen reader and touch, at 200% text size.
- **[R] Structure.** Each day is a heading. Media is an ordered list in chronological DOM order (the visual justified layout is presentation only). Tiles are buttons with names like "Photo, 6:42 pm, added by {name}" and "Video, 0:42, …".
- **[R] Viewer.** Dialog role with a labelled title, focus trap, focus returns to the originating tile, Esc closes, arrows navigate, and a polite live region announces "Photo 12 of 84". Chrome is reachable without a pointer.
- **[R] Upload.** Announce by summary through a polite status region, not per-percent. Errors use an alert region.
- **[R] Contrast and colour.** Timestamps and meta text meet AA. Nothing depends on colour alone (the lamp always has a shape or text).
- **[R] Reduced motion** is respected everywhere. **Zoom:** never disable browser zoom.
- **[R] Alt text.** No captions exist, so use the descriptive accessible name above. Future captions replace it **[F]**.

## 18. Performance expectations

**Phase 6 (originals only), design constraints [R]:** 25 MiB originals can exhaust mobile browser memory.
- Only a bounded window of items near the viewport may have loaded image sources. Off-window tiles stay as reserved placeholders and release their image.
- Cap concurrent image loads (starting about 6 **[H]**) and cancel loads for tiles scrolled far out of the window.
- No layout shift in the media area. Input feedback within a frame.
- Obtain URLs per window in batches via the OD3 entry point, never for the whole trip at once. Reuse held URLs within their lifetime (§11) so re-entering the window does not need a new issuance.
- Uploads: stream, never buffer files in memory, keep the small concurrency cap, and coalesce refreshes (§13).
- Presigned GETs carry no cache headers, so HTTP-cache hits are not guaranteed. Do not design around them. Cacheable image URLs are [F] with derivatives.

**Targets once derivatives exist [F]:** small tiles for the grid, a mid-size image for the viewer, originals only for "Open original", placeholder data for instant colour, browser-cacheable image URLs, and pagination for trips above the row cap.

**[H] Budgets to validate on real devices**, including a mid-range and a low-end Android phone given the user base: smooth scroll under normal load, no visible jank while an upload runs, and stable memory across a long scroll of a large trip.

---

## Appendix A — Final design principles

P1–P11 as tagged in §2. Binding: P1, P4, P5, P6, P8, P10, P11 [D]; P2, P3, P7, P9 [R]. All exact values (spacing, colours, timings, thresholds) are [H].

## Appendix B — Final interaction principles

1. Feedback within a frame; targets ≥ 44px. **[D/R]**
2. Motion communicates change and is interruptible; reduced-motion respected. **[D/R]**
3. The viewer is spatially continuous with its tile and is part of browser history. **[D principle, R history]**
4. Never crop, hide or reflow photos. **[R/D]**
5. Optimistic only where failure is recoverable. **[R]**
6. No hover-only actions; every action has touch and keyboard equivalents. **[R]**
7. Never lose scroll position. **[R]**
8. Be honest about limits (upload needs the tab open, previews can be unavailable, undated photos, truncated lists). **[R]**
9. Technique and library choices are open. **[H]**

## Appendix C — Exact Phase 6 web screens and components

**Core (must ship):**

| ID | Component |
|---|---|
| C1 | Memories section on `/trips/[tripId]`, plus the **Add memories** action in the header (header otherwise unchanged) |
| C2 | Day section (heading and items) |
| C3 | Media grid (justified rows) |
| C4 | Media tile (photo, video, unavailable-preview, loading, failed) |
| C5 | Time marker (time label only) |
| C6 | Undated section |
| C9–C11 | Viewer: dialog shell, media, details panel with Open original and Remove |
| C12 | Remove confirmation |
| C13 | Add-memories action + picker |
| C14 | Upload tray |
| C15 | Upload queue logic — pure, framework-independent (states and retry rules in §13) |
| C16 | Attribution using the existing member avatar component and a member-name lookup, including "A former member" |
| C19 | Token layer (both modes defined; Phase 6 surfaces built on it) |
| C20 | Authenticated server entry point for signed URLs (OD3a) and coalesced refresh (OD3b), once approved |

**Tier 2 (only after all Core is done, in this order):** person filter (C8); contributor avatars on markers; day index (C7); viewer zoom; pull-down dismiss; drag-and-drop veil; in-timeline ghost tiles; sticky trip bar (C18); people line, privacy line, trip-length text and description clamp; best-effort client cleanup of pending rows.

**C17 People / invite / inbox (conditional):** compose the existing Phase 5 components and actions **only if** the OD4 test shows the Phase 5 UI is absent **and** the owner separately approves it. C17 has a single owner. Phase 6 itself only reads members for attribution.

## Appendix D — Required states and interactions

| Component | Required states | Required interactions |
|---|---|---|
| C1 Memories | Loading skeleton, empty, inline error with retry, truncated-list note | Refresh after upload and after delete, preserving scroll |
| C2/C6 Days | Populated; Undated appears only when items exist | Sticky day heading (R) |
| C3/C4 Grid/tile | Loading, loaded, failed with retry, preview-unavailable, video (duration + play glyph) | Press feedback, open viewer, keyboard focus and Enter/Space |
| C5 Markers | Time only | None |
| C9–C11 Viewer | Loading, loaded, failed, unavailable preview, item removed | Close (button, Esc, back), prev/next (arrows, buttons), details, Open original (fresh URL), Remove |
| C12 Remove | Idle, confirming, pending, error | Confirm/cancel inline; owner and uploader only |
| C13/C14 Upload | Queue states per §13, tray collapsed and expanded, session ended | Pick multiple, retry by failed step, cancel queued, leave-page warning |
| C16 Attribution | Resolved name, "A former member" | None |
| C20 URL entry point | Issued, expired-near, unavailable | Batch request for a window; per-item request for the viewer; fresh URL for Open original |

## Appendix E — Existing backend capabilities each screen uses

| Screen/component | Uses (existing) | Needs approval |
|---|---|---|
| Memories / timeline | `listTripMedia` (with an explicit limit and truncation detection), `listTripMembers`, `getCurrentUserId`, trip `owner_id` from `getTripById` | Explicit limit and truncation detection (§14) |
| Tiles and viewer images | `getMediaDownloadUrl` (server-side only) | OD3(a): authenticated server entry point |
| Viewer details / Open original | Media metadata, the member lookup, the same signed-URL lookup | OD3(a) |
| Remove | `deleteMediaAction` (RLS enforced; revalidates the trip path) | None |
| Upload | Existing validators, `requestMediaUploadAction`, browser PUT to the signed URL, `confirmMediaUploadAction` | OD3(b) coalesced refresh; OD5 for capture time |
| Pending-row cleanup (optional) | `deleteMediaAction` on a known pending `mediaId` | None |
| People (C17, if approved) | `listTripMembers`, `leaveTripAction`, `listInvitationsForTrip`, `inviteMemberAction`, `revokeInvitationAction`, existing components | OD4 |
| Home (Phase 8) | `listMyTrips`, `listMyPendingInvitations`, `getInvitedTripPreview`, accept/decline actions | None |

## Appendix F — Explicitly NOT in Phase 6

Derivatives, placeholder or blurhash data, cover photo or cover-derived colour, trip time zone or capture offset, last-seen or "new" dividers, captions or day notes, chat or realtime, favourites or reactions, batch or forced download, share links, member removal, ownership transfer, resumable or persistent upload queues, background upload, a server-side pending-row sweeper, HEIC conversion, generated video posters, GPS or places, pagination, PWA or share target, "Play the trip", notifications, avatar upload, search, maps, AI features, a tab bar, a three-pane desktop layout, a shared web/native component library, typed error codes, a full retheme of Phase 3–5 screens or enabling app-wide dark mode (OD6), header polish (people/privacy line, trip-length text, description clamp — Tier 2 / Phase 8), and any invented API or database capability beyond the two OD3 additions.

## Appendix G — Future mobile requirements Phase 6 must not block

1. **Pure product rules.** Grouping, time-marker and cluster rules, permission rules (who can delete), the upload state machine and retry rules, and user-facing state copy live in framework-independent modules with no DOM or Next imports.
2. **Tokens as data.** Colour roles, type scale, spacing and motion intent are defined as data first and projected to CSS variables on web.
3. **Business rules stay in the database or pure modules.** Not in React components, and not only in Next-specific code paths.
4. **Upload contract is protocol-shaped** (request → PUT → confirm). Do not couple media identity to browser-only objects such as object URLs. Server Actions are web-coupled, so a native-callable confirm endpoint and a token-authenticated signed-URL endpoint will be needed later. Flag them; do not build them. Prefer a Route Handler for OD3(a) so the same contract can be reused.
5. **The viewer's data contract is DOM-independent:** an ordered list of media ids, a current index, a URL provider and metadata.
6. **Deep-linkable ids** for trip and media (the `?media=` choice in §11 must map to universal links).
7. **No web-only affordances as the only path** (hover, right-click, drag-and-drop).
8. **Semantic structure** (day headings, ordered items) maps directly onto native accessibility containers.
9. **Native preconditions to keep visible:** derivatives and placeholder data, a trip time zone plus capture offset, and last-seen.
10. **Record the decision.** Master §5 currently lists a native mobile app as out of MVP scope. Log the future-mobile constraint in the Decision Log without changing the phase plan.

## Appendix H — Phase 6 acceptance checks

1. Two accounts in one trip: each sees the other's uploads, correctly attributed; a departed uploader shows as "A former member".
2. A photo with EXIF time lands in the right day; a photo without lands under Undated and is never mixed into a day (T1/T5).
3. A trip with more items than the row cap shows the truncation note, with the count taken from the returned data, not a constant.
4. Upload: a failed PUT retries with a new request; a failed confirm retries confirm on the same `mediaId` and does not re-upload or duplicate; a slot-limited queue never holds a stale URL.
5. Viewer: opens continuously from its tile, closes to the same tile, works with keyboard, and closing preserves scroll.
6. Reusing a held URL within its lifetime works (image and video); an expired or failed URL is replaced; "Open original" always uses a fresh URL.
7. Remove is offered only to the uploader or owner, and is confirmed before running.
8. HEIC, oversized and unsupported files show their designed states, never a broken image.
9. Both modes' tokens exist; Phase 6 ships light-only app-wide with an always-dark viewer (OD6).
10. Real-device pass on a mid-range and a low-end Android phone with a large trip of originals.

---

## Revision notes (changes from the pre-audit draft)

- **OD3** rewritten as an authenticated server entry point with batching, id validation and a uniform "unavailable"; coalesced refresh replaces per-confirm refresh.
- **§11 URL rule** split into a [D] server-side rule (per-issuance authorization, 300 s TTL, no persistence) and an [R] client rule (reuse within lifetime minus margin; fresh URL for Open original).
- **§14 / §0.4 truncation:** explicit limit and detection by count; no hardcoded 1,000; newest items are dropped when the ascending list is truncated.
- **OD5:** the default is EXIF-or-null; `lastModified` is excluded unless the owner accepts permanent unlabelled approximations; the EXIF zone assumption is stated.
- **§13:** retry depends on the failed step; URLs requested just in time; cancel scoped to `queued` and `uploading`; best-effort pending-row cleanup via the existing `deleteMediaAction` (the previous "no cleanup exists" was over-broad).
- **T1** aligned with T5.
- **§9 / Appendix C:** Phase 6 header scope narrowed to the Add action; header polish moved to Tier 2 / Phase 8; C17 given a concrete "absent" test and a single owner.
- **Priority label** renamed "Tier 2" (the previous "P2" collided with principle P2).
- Added: untrusted-metadata rules (§5), preflight checklist (§0.3), access-rule accuracy for the uploader disjunct (§0.4), acceptance checks (Appendix H).
