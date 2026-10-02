import type { ExifDateTime } from "./metadata";

/** Reads bytes [start, end) of the file. Must tolerate end > size. */
export type RangeReader = (start: number, end: number) => Promise<Uint8Array>;

const JPEG_SCAN_BYTES = 131_072; // EXIF APP1 sits in the first segments and is <= 64 KiB
const META_BOX_CAP = 4 * 1024 * 1024;
const EXIF_ITEM_CAP = 1024 * 1024;

const ascii = (b: Uint8Array, s: number, n: number): string => {
  let out = "";
  for (let i = s; i < s + n && i < b.length; i++) out += String.fromCharCode(b[i]);
  return out;
};

// ---------------------------------------------------------------- TIFF ----

type Endian = { u16: (o: number) => number; u32: (o: number) => number };

function endianReader(b: Uint8Array, little: boolean): Endian {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { u16: (o) => v.getUint16(o, little), u32: (o) => v.getUint32(o, little) };
}

/** `tiff` must start at the TIFF header ("II"/"MM"). Bounds-checked; never throws. */
export function parseTiffDateTimeOriginal(tiff: Uint8Array): ExifDateTime | null {
  try {
    if (tiff.length < 8) return null;
    const mark = ascii(tiff, 0, 2);
    if (mark !== "II" && mark !== "MM") return null;
    const e = endianReader(tiff, mark === "II");
    if (e.u16(2) !== 42) return null;

    const findTag = (ifdOffset: number, tag: number): { type: number; count: number; valueOffset: number } | null => {
      if (ifdOffset < 8 || ifdOffset + 2 > tiff.length) return null;
      const n = e.u16(ifdOffset);
      if (n > 1000) return null;
      for (let i = 0; i < n; i++) {
        const p = ifdOffset + 2 + i * 12;
        if (p + 12 > tiff.length) return null;
        if (e.u16(p) === tag) {
          return { type: e.u16(p + 2), count: e.u32(p + 4), valueOffset: p + 8 };
        }
      }
      return null;
    };

    const readAscii = (entry: { type: number; count: number; valueOffset: number } | null): string | null => {
      if (!entry || entry.type !== 2 || entry.count < 1 || entry.count > 64) return null;
      const at = entry.count <= 4 ? entry.valueOffset : e.u32(entry.valueOffset);
      if (at < 0 || at + entry.count > tiff.length) return null;
      return ascii(tiff, at, entry.count).replace(/\0.*$/s, "").trim();
    };

    const exifPtr = findTag(e.u32(4), 0x8769);
    if (!exifPtr || exifPtr.type !== 4) return null;
    const exifIfd = e.u32(exifPtr.valueOffset);

    const dateTime = readAscii(findTag(exifIfd, 0x9003)); // DateTimeOriginal
    if (!dateTime) return null;
    const offset = readAscii(findTag(exifIfd, 0x9011)); // OffsetTimeOriginal
    return { dateTime, offset: offset || null };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- JPEG ----

export function parseJpegExif(buf: Uint8Array): ExifDateTime | null {
  try {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let p = 2;
    for (let guard = 0; guard < 64 && p + 4 <= buf.length; guard++) {
      if (buf[p] !== 0xff) return null;
      while (p < buf.length && buf[p] === 0xff) p++; // fill bytes
      const marker = buf[p++];
      if (marker === 0xd9 || marker === 0xda) return null; // EOI / start of scan
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length
      if (p + 2 > buf.length) return null;
      const len = (buf[p] << 8) | buf[p + 1];
      if (len < 2) return null;
      if (marker === 0xe1 && ascii(buf, p + 2, 6) === "Exif\0\0") {
        const end = Math.min(buf.length, p + len);
        return parseTiffDateTimeOriginal(buf.subarray(p + 8, end));
      }
      p += len;
    }
    return null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------- HEIC / HEIF (ISOBMFF)

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const uN = (b: Uint8Array, o: number, n: number): number => {
  if (n === 0) return 0;
  if (n > 8 || o + n > b.length) throw new Error("bad int");
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[o + i];
  return v;
};

type Box = { type: string; start: number; bodyStart: number; end: number };

function* childBoxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  let p = from;
  for (let guard = 0; guard < 4096 && p + 8 <= to; guard++) {
    let size = u32(b, p);
    const type = ascii(b, p + 4, 4);
    let hdr = 8;
    if (size === 1) {
      size = uN(b, p + 8, 8);
      hdr = 16;
    } else if (size === 0) {
      size = to - p;
    }
    if (size < hdr || p + size > to) return;
    yield { type, start: p, bodyStart: p + hdr, end: p + size };
    p += size;
  }
}

/** meta box *body* (starts with FullBox version/flags) -> location of the Exif item. */
export function locateHeicExifItem(meta: Uint8Array): { offset: number; length: number } | null {
  try {
    let exifItemId: number | null = null;
    let iloc: Box | null = null;
    for (const box of childBoxes(meta, 4, meta.length)) {
      if (box.type === "iinf") {
        const ver = meta[box.bodyStart];
        let p = box.bodyStart + 4;
        const count = ver === 0 ? uN(meta, p, 2) : uN(meta, p, 4);
        p += ver === 0 ? 2 : 4;
        let seen = 0;
        for (const infe of childBoxes(meta, p, box.end)) {
          if (++seen > count + 1) break;
          if (infe.type !== "infe") continue;
          const iv = meta[infe.bodyStart];
          if (iv < 2) continue;
          let q = infe.bodyStart + 4;
          const id = iv === 2 ? uN(meta, q, 2) : uN(meta, q, 4);
          q += iv === 2 ? 2 : 4;
          q += 2; // protection index
          if (ascii(meta, q, 4) === "Exif") exifItemId = id;
        }
      } else if (box.type === "iloc") {
        iloc = box;
      }
    }
    if (exifItemId === null || !iloc) return null;

    const ver = meta[iloc.bodyStart];
    let p = iloc.bodyStart + 4;
    const offsetSize = meta[p] >> 4;
    const lengthSize = meta[p] & 0x0f;
    const baseSize = meta[p + 1] >> 4;
    const indexSize = ver === 1 || ver === 2 ? meta[p + 1] & 0x0f : 0;
    p += 2;
    const itemCount = ver < 2 ? uN(meta, p, 2) : uN(meta, p, 4);
    p += ver < 2 ? 2 : 4;
    for (let i = 0; i < itemCount && i < 4096; i++) {
      const id = ver < 2 ? uN(meta, p, 2) : uN(meta, p, 4);
      p += ver < 2 ? 2 : 4;
      let method = 0;
      if (ver === 1 || ver === 2) {
        method = uN(meta, p, 2) & 0x0f;
        p += 2;
      }
      p += 2; // data_reference_index
      const base = uN(meta, p, baseSize);
      p += baseSize;
      const extents = uN(meta, p, 2);
      p += 2;
      let first: { offset: number; length: number } | null = null;
      for (let x = 0; x < extents && x < 64; x++) {
        p += indexSize;
        const off = uN(meta, p, offsetSize);
        p += offsetSize;
        const len = uN(meta, p, lengthSize);
        p += lengthSize;
        if (!first) first = { offset: base + off, length: len };
      }
      if (id === exifItemId) {
        return method === 0 && first && first.length > 8 && first.length <= EXIF_ITEM_CAP ? first : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function readHeicExif(read: RangeReader, size: number): Promise<ExifDateTime | null> {
  let pos = 0;
  for (let guard = 0; guard < 64 && pos + 8 <= size; guard++) {
    const hdr = await read(pos, pos + 16);
    if (hdr.length < 8) return null;
    let boxSize = u32(hdr, 0);
    const type = ascii(hdr, 4, 4);
    let hlen = 8;
    if (boxSize === 1) {
      if (hdr.length < 16) return null;
      boxSize = uN(hdr, 8, 8);
      hlen = 16;
    } else if (boxSize === 0) {
      boxSize = size - pos;
    }
    if (boxSize < hlen) return null;
    if (type === "meta") {
      if (boxSize - hlen > META_BOX_CAP) return null;
      const meta = await read(pos + hlen, pos + boxSize);
      const loc = locateHeicExifItem(meta);
      if (!loc) return null;
      const item = await read(loc.offset, loc.offset + loc.length);
      if (item.length < 12) return null;
      const tiffStart = 4 + u32(item, 0); // exif_tiff_header_offset counts from after itself
      if (tiffStart >= item.length) return null;
      return parseTiffDateTimeOriginal(item.subarray(tiffStart));
    }
    pos += boxSize;
  }
  return null;
}

// --------------------------------------------------------------- entry ----

/**
 * Raw EXIF DateTimeOriginal/OffsetTimeOriginal from a JPEG or HEIC/HEIF file,
 * reading only small byte ranges (never the whole file). PNG/WebP -> null.
 * Never throws.
 */
export async function readExifDateTime(read: RangeReader, size: number): Promise<ExifDateTime | null> {
  try {
    const head = await read(0, Math.min(size, JPEG_SCAN_BYTES));
    if (head.length >= 2 && head[0] === 0xff && head[1] === 0xd8) return parseJpegExif(head);
    if (head.length >= 12 && ascii(head, 4, 4) === "ftyp") return await readHeicExif(read, size);
    return null;
  } catch {
    return null;
  }
}

export function fileRangeReader(file: Blob): RangeReader {
  return async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer());
}
