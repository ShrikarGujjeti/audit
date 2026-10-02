import test from "node:test";
import assert from "node:assert/strict";
import { exifMod, metaMod, coalesceMod, summaryMod } from "./helpers.mjs";

// ---------- synthetic fixture builders (author-written, NOT real camera files) ----------
const enc = (s) => [...s].map((c) => c.charCodeAt(0));
const u16 = (n, le) => (le ? [n & 255, n >> 8] : [n >> 8, n & 255]);
const u32 = (n, le) => (le ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255] : [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);

function tiff({ le = true, dt = "2024:03:09 18:42:07", off = "+05:30", omitExifIfd = false } = {}) {
  const e = (n) => u16(n, le), f = (n) => u32(n, le);
  const dtBytes = [...enc(dt), 0];
  const offBytes = off ? [...enc(off), 0] : null;
  // layout: header(8) | IFD0 @8 (1 entry: ExifIFD ptr) | ExifIFD | data
  const ifd0 = [...e(1), ...e(0x8769), ...e(4), ...f(1), ...f(8 + 2 + 12 + 4), ...f(0)];
  const ifd0Len = 2 + 12 + 4;
  const exifIfdOffset = 8 + ifd0Len;
  const nEntries = offBytes ? 2 : 1;
  const exifIfdLen = 2 + nEntries * 12 + 4;
  const dataStart = exifIfdOffset + exifIfdLen;
  const entries = [...e(0x9003), ...e(2), ...f(dtBytes.length), ...f(dataStart)];
  if (offBytes) entries.push(...e(0x9011), ...e(2), ...f(offBytes.length), ...f(dataStart + dtBytes.length));
  const exifIfd = [...e(nEntries), ...entries, ...f(0)];
  const header = [...enc(le ? "II" : "MM"), ...e(42), ...f(8)];
  return new Uint8Array([...header, ...(omitExifIfd ? [...e(0), ...f(0)] : [...ifd0, ...exifIfd, ...dtBytes, ...(offBytes ?? [])])]);
}
function jpegWith(tiffBytes, extra = []) {
  const app1 = [...enc("Exif"), 0, 0, ...tiffBytes];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, ...extra, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2, 0, 0]);
}
const box = (type, ...parts) => { const body = parts.flat(); return [...u32(8 + body.length, false), ...enc(type), ...body]; };
function heicWith(tiffBytes, { tiffOffset = 6 } = {}) {
  const exifPayload = [...u32(tiffOffset, false), ...enc("Exif"), 0, 0, ...tiffBytes];
  const ftyp = box("ftyp", enc("heic"), u32(0, false), enc("mif1"));
  const infe1 = box("infe", [2, 0, 0, 0], u16(1, false), u16(0, false), enc("hvc1"), [0]);
  const infe2 = box("infe", [2, 0, 0, 0], u16(2, false), u16(0, false), enc("Exif"), [0]);
  const iinf = box("iinf", [0, 0, 0, 0], u16(2, false), infe1, infe2);
  // iloc v0: offset_size=4,length_size=4 ; base_offset_size=0,index_size=0
  const ilocFor = (exifOffset) => box("iloc", [0, 0, 0, 0], [0x44, 0x00], u16(2, false),
    u16(1, false), u16(0, false), u16(1, false), u32(0, false), u32(10, false),
    u16(2, false), u16(0, false), u16(1, false), u32(exifOffset, false), u32(exifPayload.length, false));
  const metaOf = (off) => box("meta", [0, 0, 0, 0], iinf, ilocFor(off));
  const metaLen = metaOf(0).length;
  const exifOffset = ftyp.length + metaLen + 8; // inside mdat, after its 8-byte header
  const meta = metaOf(exifOffset);
  const mdat = box("mdat", exifPayload);
  return new Uint8Array([...ftyp, ...meta, ...mdat]);
}
const reader = (bytes) => async (s, e) => bytes.slice(s, e);
const read = (bytes) => exifMod.readExifDateTime(reader(bytes), bytes.length);

test("JPEG EXIF: little-endian DateTimeOriginal + OffsetTimeOriginal", async () => {
  assert.deepEqual(await read(jpegWith(tiff())), { dateTime: "2024:03:09 18:42:07", offset: "+05:30" });
});
test("JPEG EXIF: big-endian, no offset tag", async () => {
  assert.deepEqual(await read(jpegWith(tiff({ le: false, off: null }))), { dateTime: "2024:03:09 18:42:07", offset: null });
});
test("JPEG EXIF: APPn segment before the Exif segment is skipped", async () => {
  const j = jpegWith(tiff(), [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]);
  assert.equal((await read(j)).dateTime, "2024:03:09 18:42:07");
});
test("JPEG without EXIF, no ExifIFD, truncated, garbage, PNG, empty -> null (never throws)", async () => {
  const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0xff, 0xd9]);
  assert.equal(await read(bare), null);
  assert.equal(await read(jpegWith(tiff({ omitExifIfd: true }))), null);
  const good = jpegWith(tiff());
  for (const cut of [5, 12, 30, 44, 60]) assert.equal(await read(good.slice(0, cut)), null);
  assert.equal(await read(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), null);
  assert.equal(await read(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), null);
  assert.equal(await read(new Uint8Array(0)), null);
  // corrupt: random bytes fuzz must never throw
  let seed = 12345;
  for (let i = 0; i < 300; i++) {
    const g = new Uint8Array(good); for (let k = 0; k < 6; k++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; g[seed % g.length] = seed & 255; }
    await read(g);
  }
});
test("HEIC EXIF (synthetic ISOBMFF, Exif item in mdat, tiff offset 6)", async () => {
  assert.deepEqual(await read(heicWith(tiff())), { dateTime: "2024:03:09 18:42:07", offset: "+05:30" });
});
test("HEIC: truncated / corrupt -> null, no throw", async () => {
  const h = heicWith(tiff());
  for (const cut of [8, 20, 60, 100, h.length - 5]) await read(h.slice(0, cut));
  assert.equal(await read(h.slice(0, 20)), null);
  const bad = new Uint8Array(h); bad.fill(0xff, 40, 80); await read(bad);
});

test("reader only requests small ranges (never the whole large file)", async () => {
  const calls = [];
  const big = jpegWith(tiff());
  await exifMod.readExifDateTime(async (s, e) => { calls.push([s, e]); return big.slice(s, e); }, 25 * 1024 * 1024);
  assert.ok(calls.every(([s, e]) => e - s <= 131072));
});

// --------------------------------- capture-time resolution ---------------------------------
const NOW = new Date("2026-10-02T12:00:00Z");
test("with offset: exact UTC instant", () => {
  assert.equal(metaMod.resolveCapturedAt({ dateTime: "2024:03:09 18:42:07", offset: "+05:30" }, NOW), "2024-03-09T13:12:07.000Z");
  assert.equal(metaMod.resolveCapturedAt({ dateTime: "2024:03:09 18:42:07", offset: "-08:00" }, NOW), "2024-03-10T02:42:07.000Z");
});
test("without offset: interpreted in the runtime (uploader browser) zone", () => {
  const expected = new Date(2024, 2, 9, 18, 42, 7).toISOString();
  assert.equal(metaMod.resolveCapturedAt({ dateTime: "2024:03:09 18:42:07", offset: null }, NOW), expected);
  if (process.env.TZ === "Asia/Kolkata") assert.equal(expected, "2024-03-09T13:12:07.000Z");
});
test("invalid / out-of-range capture times -> null", () => {
  const r = (dt, off = "+00:00") => metaMod.resolveCapturedAt({ dateTime: dt, offset: off }, NOW);
  assert.equal(r("0000:00:00 00:00:00"), null);
  assert.equal(r("2024:02:30 10:00:00"), null, "calendar-invalid date does not roll over");
  assert.equal(r("2024:13:01 10:00:00"), null);
  assert.equal(r("2024:03:09 25:00:00"), null);
  assert.equal(r("1989:12:31 23:59:59"), null, "before 1990");
  assert.equal(r("2026:10:02 12:00:01"), null, "future");
  assert.equal(r("2027:01:01 00:00:00"), null, "future");
  assert.equal(r("garbage"), null);
  assert.equal(r("2024:03:09 10:00:00", "+99:00"), null);
  assert.equal(metaMod.resolveCapturedAt(null, NOW), null);
  assert.equal(r("1990:01:01 00:00:00"), "1990-01-01T00:00:00.000Z");
});
test("sanitizeMetadata: dims non-finite/<=0 -> null; half-known size dropped; time bounds", () => {
  const s = (raw) => metaMod.sanitizeMetadata(raw, NOW);
  assert.deepEqual(s({ width: 4000, height: 3000 }), { capturedAt: null, width: 4000, height: 3000, durationSeconds: null });
  assert.equal(s({ width: NaN, height: 3 }).width, null);
  assert.equal(s({ width: Infinity, height: 3 }).height, null);
  assert.equal(s({ width: 0, height: 3 }).height, null);
  assert.equal(s({ width: -5, height: 3 }).width, null);
  assert.equal(s({ width: 4000, height: null }).width, null);
  assert.equal(s({ width: 1e9, height: 5 }).width, null);
  assert.equal(s({ durationSeconds: 0 }).durationSeconds, null);
  assert.equal(s({ durationSeconds: NaN }).durationSeconds, null);
  assert.equal(s({ durationSeconds: 12.3456 }).durationSeconds, 12.346);
  assert.equal(s({ capturedAt: "1985-01-01T00:00:00Z" }).capturedAt, null);
  assert.equal(s({ capturedAt: "2030-01-01T00:00:00Z" }).capturedAt, null);
  assert.equal(s({ capturedAt: "nope" }).capturedAt, null);
  assert.equal(s({ capturedAt: "2024-03-09T13:12:07Z" }).capturedAt, "2024-03-09T13:12:07.000Z");
});

// --------------------------------- coalescer + summary ---------------------------------
test("coalescer: burst -> one refresh; flush runs once only if dirty; later trigger re-arms", () => {
  let runs = 0; const timers = [];
  const c = coalesceMod.createRefreshCoalescer(() => runs++, { delayMs: 1500, setTimer: (fn) => (timers.push(fn), timers.length), clearTimer: (h) => { timers[h - 1] = null; } });
  c.trigger(); c.trigger(); c.trigger();
  assert.equal(timers.length, 1);
  timers[0](); assert.equal(runs, 1);
  c.flush(); assert.equal(runs, 1, "nothing pending -> no extra refresh");
  c.trigger(); assert.equal(timers.length, 2);
  c.flush(); assert.equal(runs, 2);
  assert.equal(timers[1], null, "pending timer cleared by flush");
  c.trigger(); c.cancel(); c.flush(); assert.equal(runs, 2);
});
test("summary headline", () => {
  const it = (status) => ({ status });
  assert.equal(summaryMod.summarizeQueue([it("done"), it("uploading"), it("queued")]).headline, "Adding 2 of 3");
  assert.equal(summaryMod.summarizeQueue([it("done"), it("failed")]).headline, "1 couldn't be added");
  assert.equal(summaryMod.summarizeQueue([it("done"), it("done")]).headline, "Added 2");
  assert.equal(summaryMod.summarizeQueue([it("rejected")]).headline, "Nothing was added");
});
