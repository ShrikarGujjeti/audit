import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const queueMod = require("/tmp/out/src/modules/media/upload/queue.js");
export const exifMod = require("/tmp/out/src/modules/media/upload/exif.js");
export const metaMod = require("/tmp/out/src/modules/media/upload/metadata.js");
export const coalesceMod = require("/tmp/out/src/modules/media/upload/coalesce.js");
export const summaryMod = require("/tmp/out/src/modules/media/upload/summary.js");

export const tick = () => new Promise((r) => setImmediate(r));
export async function until(pred, msg = "condition", tries = 400) {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await tick();
  }
  throw new Error("timed out waiting for " + msg);
}
export const jpeg = (name = "a.jpg", size = 10) => new File([new Uint8Array(size).fill(1)], name, { type: "image/jpeg" });
export const mov = (name = "v.mov", size = 10) => new File([new Uint8Array(size).fill(2)], name, { type: "video/quicktime" });

/** Simulated backend + R2 so the engine's real call sequence can be asserted. */
export function makeBackend(over = {}) {
  const b = {
    rows: new Map(), // mediaId -> status
    objects: new Set(),
    requests: [], puts: [], confirms: [], statusChecks: 0,
    nextId: 1, confirmed: 0, drained: 0,
    maxActiveRequests: 0, inFlight: 0,
    putPlan: [], // per-call: "ok" | "http" | "network" | "hang"
    confirmPlan: [], // per-call: "ok" | "error" | "throw-applied" | "throw-notapplied"
    requestPlan: [], // "ok" | "error" | "throw"
    session: "authenticated",
    statusOverride: null,
    ...over,
  };
  const deps = {
    tripId: "trip-1",
    prepare: async () => ({ capturedAt: null, width: 4, height: 3, durationSeconds: null }),
    async requestUpload(input) {
      b.requests.push(input);
      const plan = b.requestPlan.shift() ?? "ok";
      if (plan === "throw") throw new Error("net");
      if (plan === "error") return { error: "Could not start the upload. Please try again." };
      const mediaId = "m" + b.nextId++;
      b.rows.set(mediaId, "pending");
      return { mediaId, uploadUrl: "https://r2.example/" + mediaId };
    },
    async putFile({ url, file, contentType, signal, onProgress }) {
      const id = url.split("/").pop();
      b.puts.push({ id, contentType, file });
      b.inFlight++; b.maxActiveRequests = Math.max(b.maxActiveRequests, b.inFlight);
      try {
        const plan = b.putPlan.shift() ?? "ok";
        onProgress(0.5);
        if (plan === "hang") {
          await new Promise((res) => signal.addEventListener("abort", res));
          return { ok: false, reason: "aborted" };
        }
        if (plan === "http") return { ok: false, reason: "http", status: 403 };
        if (plan === "network") return { ok: false, reason: "network" };
        b.objects.add(id);
        onProgress(1);
        return { ok: true };
      } finally { b.inFlight--; }
    },
    async confirmUpload(mediaId) {
      b.confirms.push(mediaId);
      const plan = b.confirmPlan.shift() ?? "ok";
      if (plan === "throw-notapplied") throw new Error("timeout");
      if (plan === "error") return { error: "Could not confirm the upload. Please try again." };
      if (b.rows.get(mediaId) === "pending" && b.objects.has(mediaId)) b.rows.set(mediaId, "ready");
      if (plan === "throw-applied") throw new Error("timeout after apply");
      return { ok: true };
    },
    async getServerStatus(mediaId) {
      b.statusChecks++;
      if (b.statusOverride) return b.statusOverride(mediaId);
      return b.rows.get(mediaId) ?? "missing";
    },
    async probeSession() { return b.session; },
    onConfirmed() { b.confirmed++; },
    onDrained() { b.drained++; },
  };
  return { b, deps };
}
export const mk = (deps, opts = {}) => queueMod.createUploadQueue(deps, { sleep: async () => {}, ...opts });
export const items = (q) => q.getSnapshot().items;
