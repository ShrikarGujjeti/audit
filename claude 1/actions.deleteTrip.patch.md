# Patch: `src/modules/trips/actions.ts` — `deleteTripAction`

Why: the media lookup was a single unbounded `select` (silently capped by PostgREST `max_rows`, leaving orphaned R2 objects for large trips), and cleanup fired one unbounded-concurrency `DeleteObject` per key.

## 1. Imports

```diff
-import { deleteMediaObjectBestEffort } from "@/modules/storage/r2";
+import { deleteMediaObjectsBestEffort } from "@/modules/storage/r2";
+import { listAllStorageKeysForTrip } from "@/modules/media/queries";
```

## 2. Replace the media lookup block

```diff
-  const { data: mediaRows, error: mediaLookupError } = await supabase
-    .from("media")
-    .select("storage_key")
-    .eq("trip_id", tripId);
-
-  if (mediaLookupError) {
-    logDatabaseError("delete (media lookup)", mediaLookupError);
-    // Not fatal — proceed with the trip delete attempt regardless. ...
-  }
+  // Keyset-paginated: correct under any PostgREST max_rows. A failure here is
+  // not fatal -- losing best-effort R2 cleanup must not block an owner's delete.
+  let storageKeys: string[] = [];
+  try {
+    storageKeys = await listAllStorageKeysForTrip(tripId);
+  } catch (err) {
+    console.error("[trips] delete (media key lookup) failed", err);
+  }
```

## 3. Replace the cleanup block (after the successful trip delete)

```diff
-  if (mediaRows && mediaRows.length > 0) {
-    await Promise.all(
-      mediaRows.map((row) => deleteMediaObjectBestEffort(row.storage_key, { tripId }))
-    );
-  }
+  if (storageKeys.length > 0) {
+    await deleteMediaObjectsBestEffort(storageKeys, { tripId });
+  }
```

Behaviour notes: a non-owner member's lookup still succeeds, but their delete matches 0 rows and returns before cleanup (unchanged). Uploads that start between the lookup and the delete can still orphan an object (accepted for Phase 6; see report).
