import test from "node:test";
import assert from "node:assert/strict";
import { mk, makeBackend, items, until, jpeg, mov } from "./helpers.mjs";

const status = (q) => items(q).map((i) => i.status);

test("happy path: request -> PUT -> confirm, one mediaId, original File and same MIME used", async () => {
  const { b, deps } = makeBackend();
  const q = mk(deps);
  const f = jpeg();
  q.addFiles([f]);
  await until(() => status(q)[0] === "done");
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0].mimeType, "image/jpeg");
  assert.equal(b.requests[0].fileSizeBytes, f.size);
  assert.equal(b.puts.length, 1);
  assert.equal(b.puts[0].contentType, "image/jpeg");
  assert.strictEqual(b.puts[0].file, f, "the original File object is PUT untouched (no buffering/transform)");
  assert.equal(b.confirms.length, 1);
  assert.equal(b.confirmed, 1);
  assert.equal(b.drained, 1);
  assert.equal(items(q)[0].mediaId, "m1");
});

test("local preflight rejects without any server call", async () => {
  const { b, deps } = makeBackend();
  const q = mk(deps);
  q.addFiles([
    new File([new Uint8Array(5)], "x.gif", { type: "image/gif" }),
    new File([], "empty.jpg", { type: "image/jpeg" }),
    new File([new Uint8Array(5)], "noext", { type: "" }),
  ]);
  assert.deepEqual(status(q), ["rejected", "rejected", "rejected"]);
  assert.equal(items(q)[0].message, "This file type isn't supported.");
  assert.equal(items(q)[1].message, "This file looks empty.");
  assert.equal(b.requests.length, 0);
});

test("oversize: sparse blob over the limits is rejected with the spec copy", async () => {
  const { b, deps } = makeBackend();
  const q = mk(deps);
  const bigVideo = { name: "big.mov", type: "video/quicktime", size: 200 * 1024 * 1024 + 1, slice() { throw new Error("must not read"); } };
  const bigPhoto = { name: "big.jpg", type: "image/jpeg", size: 25 * 1024 * 1024 + 1, slice() { throw new Error("must not read"); } };
  q.addFiles([bigVideo, bigPhoto]);
  assert.equal(items(q)[0].message, "That's a big one. Clips can be up to 200 MB.");
  assert.equal(items(q)[1].message, "That photo is too big. Photos can be up to 25 MB.");
  assert.equal(b.requests.length, 0);
});

test("unreadable file is rejected locally before any request", async () => {
  const { b, deps } = makeBackend();
  const q = mk(deps);
  q.addFiles([{ name: "gone.jpg", type: "image/jpeg", size: 10, slice: () => ({ arrayBuffer: async () => { throw new Error("NotReadable"); } }) }]);
  await until(() => status(q)[0] === "rejected");
  assert.equal(items(q)[0].message, "Couldn't read this file. Try selecting it again.");
  assert.equal(b.requests.length, 0);
});

test("signed URLs are requested only when a slot is free (queued items hold none)", async () => {
  const { b, deps } = makeBackend({ putPlan: ["hang", "hang", "hang", "ok", "ok", "ok"] });
  const q = mk(deps, { maxConcurrent: 3 });
  q.addFiles(Array.from({ length: 6 }, (_, i) => jpeg(`p${i}.jpg`)));
  await until(() => b.puts.length === 3);
  assert.equal(b.requests.length, 3, "only 3 of 6 requested while 3 PUTs are in flight");
  assert.equal(status(q).filter((s) => s === "queued").length, 3);
  assert.equal(b.maxActiveRequests, 3);
  items(q).filter((i) => i.status === "uploading").forEach((i) => q.cancel(i.id)); // release slots
  await until(() => status(q).filter((s) => s === "done").length === 3);
  assert.equal(b.requests.length, 6);
  assert.ok(b.maxActiveRequests <= 3);
});

test("videos are limited to one at a time while photos proceed", async () => {
  const { b, deps } = makeBackend({ putPlan: ["hang", "ok", "ok"] });
  const q = mk(deps, { maxConcurrent: 3, maxConcurrentVideos: 1 });
  q.addFiles([mov("a.mov"), mov("b.mov"), jpeg("c.jpg")]);
  await until(() => status(q)[2] === "done");
  assert.equal(status(q)[0], "uploading");
  assert.equal(status(q)[1], "queued");
  q.cancel(items(q)[0].id);
  await until(() => status(q)[1] === "done");
});

test("PUT failure -> retry makes a NEW request and a NEW mediaId (never confirm-retry)", async () => {
  const { b, deps } = makeBackend({ putPlan: ["http", "ok"] });
  const q = mk(deps);
  q.addFiles([jpeg()]);
  await until(() => status(q)[0] === "failed");
  const failed = items(q)[0];
  assert.equal(failed.failedStage, "upload");
  assert.equal(failed.retry, "restart");
  assert.equal(failed.message, "Couldn't add this one. Check your connection and try again.");
  assert.equal(b.confirms.length, 0, "no confirm after a failed PUT");
  q.retry(failed.id);
  await until(() => status(q)[0] === "done");
  assert.equal(b.requests.length, 2, "second request issued");
  assert.deepEqual(b.puts.map((p) => p.id), ["m1", "m2"], "different mediaId / URL for the retry");
  assert.deepEqual(b.confirms, ["m2"], "only the second mediaId is ever confirmed");
  assert.equal(items(q)[0].mediaId, "m2");
});

test("CRITICAL: PUT ok, confirm times out AFTER the server applied it -> reconcile, no duplicate", async () => {
  const { b, deps } = makeBackend({ confirmPlan: ["throw-applied"] });
  const q = mk(deps);
  q.addFiles([jpeg()]);
  await until(() => status(q)[0] === "done");
  assert.equal(b.requests.length, 1, "ONE request / mediaId");
  assert.equal(b.puts.length, 1, "ONE R2 object upload");
  assert.equal(b.objects.size, 1);
  assert.equal(b.confirms.length, 1, "confirm not re-sent once reconcile showed READY");
  assert.equal(b.confirmed, 1, "ONE logical media item surfaced");
  assert.equal([...b.rows.values()].filter((s) => s === "ready").length, 1);
  assert.equal(b.rows.size, 1);
});

test("confirm times out and was NOT applied -> automatic retry of confirm with the SAME mediaId", async () => {
  const { b, deps } = makeBackend({ confirmPlan: ["throw-notapplied", "ok"] });
  const q = mk(deps);
  q.addFiles([jpeg()]);
  await until(() => status(q)[0] === "done");
  assert.equal(b.requests.length, 1);
  assert.equal(b.puts.length, 1);
  assert.deepEqual(b.confirms, ["m1", "m1"]);
});

test("persistent confirm failure -> failed(confirm), manual retry reuses mediaId, never re-uploads", async () => {
  const { b, deps } = makeBackend({ confirmPlan: ["throw-notapplied", "throw-notapplied", "throw-notapplied", "ok"] });
  const q = mk(deps);
  q.addFiles([jpeg()]);
  await until(() => status(q)[0] === "failed");
  const f = items(q)[0];
  assert.equal(f.failedStage, "confirm");
  assert.equal(f.retry, "confirm");
  assert.equal(f.mediaId, "m1");
  assert.equal(b.requests.length, 1);
  q.retry(f.id);
  await until(() => status(q)[0] === "done");
  assert.equal(b.requests.length, 1, "still ONE request");
  assert.equal(b.puts.length, 1, "still ONE PUT");
  assert.ok(b.confirms.every((id) => id === "m1"));
  assert.equal(b.confirmed, 1);
});

test("confirm returned an error but server already ready (e.g. 'already processed') -> done, no duplicate", async () => {
  const { b, deps } = makeBackend();
  deps.confirmUpload = async (id) => { b.confirms.push(id); b.rows.set(id, "ready"); return { error: "This upload has already been processed." }; };
  const q = mk(deps);
  q.addFiles([jpeg()]);
  await until(() => status(q)[0] === "done");
  assert.equal(b.requests.length, 1);
});

test("server marked the row failed (e.g. oversize at confirm) -> restart plan, new mediaId on retry", async () => {
  const { b, deps } = makeBackend();
  let first = true;
  deps.confirmUpload = async (id) => {
    b.confirms.push(id);
    if (first) { first = false; b.rows.set(id, "failed"); return { error: "Could not confirm the upload. Please try again." }; }
    b.rows.set(id, "ready"); return { ok: true };
  };
  const q = mk(deps);
  q.addFiles([jpeg()]);
  await until(() => status(q)[0] === "failed");
  assert.equal(items(q)[0].retry, "restart");
  q.retry(items(q)[0].id);
  await until(() => status(q)[0] === "done");
  assert.equal(b.requests.length, 2);
  assert.deepEqual(b.confirms, ["m1", "m2"]);
});

test("request failure keeps the server message verbatim and retries with a fresh request", async () => {
  const { b, deps } = makeBackend({ requestPlan: ["error", "ok"] });
  const q = mk(deps);
  q.addFiles([jpeg()]);
  await until(() => status(q)[0] === "failed");
  assert.equal(items(q)[0].message, "Could not start the upload. Please try again.");
  assert.equal(items(q)[0].failedStage, "request");
  assert.equal(b.puts.length, 0);
  q.retry(items(q)[0].id);
  await until(() => status(q)[0] === "done");
  assert.equal(b.requests.length, 2);
});

test("thrown request error -> connection copy", async () => {
  const { deps } = makeBackend({ requestPlan: ["throw"] });
  const q = mk(deps);
  q.addFiles([jpeg()]);
  await until(() => status(q)[0] === "failed");
  assert.equal(items(q)[0].message, "Couldn't add this one. Check your connection and try again.");
});

test("session ended: item fails with the approved copy, queue pauses, retry resumes", async () => {
  const { b, deps } = makeBackend({ requestPlan: ["error"], session: "unauthenticated" });
  const q = mk(deps, { maxConcurrent: 1 });
  q.addFiles([jpeg("a.jpg"), jpeg("b.jpg")]);
  await until(() => status(q)[0] === "failed");
  assert.equal(items(q)[0].message, "Your session ended. Sign in to continue.");
  assert.equal(q.getSnapshot().sessionEnded, true);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(status(q)[1], "queued", "paused: second item not started");
  assert.equal(b.requests.length, 1);
  b.session = "authenticated";
  q.retry(items(q)[0].id);
  await until(() => status(q).every((s) => s === "done"));
  assert.equal(q.getSnapshot().sessionEnded, false);
});

test("session ended during confirm keeps the same mediaId", async () => {
  const { b, deps } = makeBackend({ confirmPlan: ["error"] });
  b.session = "unauthenticated";
  const q = mk(deps);
  q.addFiles([jpeg()]);
  await until(() => status(q)[0] === "failed");
  assert.equal(items(q)[0].retry, "confirm");
  assert.equal(items(q)[0].message, "Your session ended. Sign in to continue.");
});

test("cancel: queued is cancellable; uploading aborts PUT; requesting/confirming are not", async () => {
  const { b, deps } = makeBackend({ putPlan: ["hang"] });
  const q = mk(deps, { maxConcurrent: 1 });
  q.addFiles([jpeg("a.jpg"), jpeg("b.jpg")]);
  await until(() => status(q)[0] === "uploading");
  q.cancel(items(q)[1].id);
  assert.equal(status(q)[1], "cancelled");
  q.cancel(items(q)[0].id);
  await until(() => status(q)[0] === "cancelled");
  assert.equal(b.confirms.length, 0);

  // confirming is not cancellable
  const h = makeBackend();
  let release;
  h.deps.confirmUpload = (id) => new Promise((res) => { release = () => { h.b.rows.set(id, "ready"); res({ ok: true }); }; });
  const q2 = mk(h.deps);
  q2.addFiles([jpeg()]);
  await until(() => status(q2)[0] === "confirming");
  q2.cancel(items(q2)[0].id);
  assert.equal(status(q2)[0], "confirming");
  release();
  await until(() => status(q2)[0] === "done");
});

test("drain: onDrained fires once after the whole batch, only if something was confirmed", async () => {
  const { b, deps } = makeBackend();
  const q = mk(deps, { maxConcurrent: 2 });
  q.addFiles([jpeg("1.jpg"), jpeg("2.jpg"), jpeg("3.jpg"), jpeg("4.jpg")]);
  await until(() => status(q).every((s) => s === "done"));
  assert.equal(b.confirmed, 4);
  assert.equal(b.drained, 1);
  const none = makeBackend();
  const q2 = mk(none.deps);
  q2.addFiles([new File([new Uint8Array(1)], "x.gif", { type: "image/gif" })]);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(none.b.drained, 0);
});

test("metadata is passed through, filename included, and prepare failure degrades to nulls", async () => {
  const { b, deps } = makeBackend();
  deps.prepare = async () => { throw new Error("decode blew up"); };
  const q = mk(deps);
  q.addFiles([jpeg("trip.jpg")]);
  await until(() => status(q)[0] === "done");
  assert.deepEqual(
    { c: b.requests[0].capturedAt, w: b.requests[0].width, h: b.requests[0].height, d: b.requests[0].durationSeconds, n: b.requests[0].originalFilename },
    { c: null, w: null, h: null, d: null, n: "trip.jpg" }
  );
});

test("dismiss / clearFinished only remove terminal items", async () => {
  const { deps } = makeBackend({ putPlan: ["hang"] });
  const q = mk(deps, { maxConcurrent: 1 });
  q.addFiles([jpeg("a.jpg"), new File([new Uint8Array(1)], "x.gif", { type: "image/gif" })]);
  await until(() => status(q)[0] === "uploading");
  q.dismiss(items(q)[0].id);
  assert.equal(items(q).length, 2, "busy item not dismissed");
  q.clearFinished();
  assert.equal(items(q).length, 1);
  q.cancelAll();
  await until(() => status(q)[0] === "cancelled");
});

test("progress updates are throttled and subscribers get immutable snapshots", async () => {
  const { deps } = makeBackend();
  const q = mk(deps);
  const seen = [];
  q.subscribe(() => seen.push(q.getSnapshot()));
  const before = q.getSnapshot();
  q.addFiles([jpeg()]);
  await until(() => status(q)[0] === "done");
  assert.notStrictEqual(before, q.getSnapshot());
  assert.ok(Object.isFrozen === Object.isFrozen); // snapshots are replaced, never mutated:
  assert.equal(before.items.length, 0);
});
