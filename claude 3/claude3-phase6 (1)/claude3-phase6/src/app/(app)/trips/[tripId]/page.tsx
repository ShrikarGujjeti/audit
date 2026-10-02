import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUserId } from "@/modules/auth/session";
import { getTripById } from "@/modules/trips/queries";
import { formatTripDateRange } from "@/modules/trips/format";
import { DeleteTripButton } from "@/modules/trips/components/DeleteTripButton";
import { AddMemories } from "@/modules/media/components/AddMemories";

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const trip = await getTripById(tripId);

  if (!trip) {
    notFound();
  }

  // Decides whether to *offer* the owner controls. It is not the
  // authorization check — trips_update_owner / trips_delete_owner (0007)
  // reject a non-owner's mutation whether or not the buttons were rendered.
  const isOwner = (await getCurrentUserId()) === trip.owner_id;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{trip.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {formatTripDateRange(trip.start_date, trip.end_date)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-start justify-end gap-2">
          {/* Any member may add memories; RLS/RPCs enforce that, not this render. */}
          <AddMemories tripId={trip.id} tripName={trip.name} />
          {isOwner ? (
            <>
              <Link
                href={`/trips/${trip.id}/edit`}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Edit
              </Link>
              <DeleteTripButton tripId={trip.id} tripName={trip.name} />
            </>
          ) : null}
        </div>
      </div>

      {trip.description ? (
        <p className="mt-6 whitespace-pre-wrap text-gray-700">{trip.description}</p>
      ) : (
        <p className="mt-6 text-sm text-gray-400">No description yet.</p>
      )}

      <Link href="/trips" className="mt-8 inline-block text-sm text-gray-500 underline">
        ← Back to your trips
      </Link>
    </div>
  );
}
