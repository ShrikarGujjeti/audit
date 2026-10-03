import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUserId } from "@/modules/auth/session";
import { getTripById } from "@/modules/trips/queries";
import { formatTripDateRange } from "@/modules/trips/format";
import { DeleteTripButton } from "@/modules/trips/components/DeleteTripButton";
import { listTripMedia } from "@/modules/media/queries";
import { listTripMembers } from "@/modules/memberships/queries";
import { MemoriesSection } from "@/modules/media/components/MemoriesSection";

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

  const currentUserId = await getCurrentUserId();
  const isOwner = currentUserId === trip.owner_id;

  // Fetched in parallel with the existing header data — media/members
  // reads are gated by the same RLS a non-member would already fail on
  // (media_select_member, trip_members_select_member), so no additional
  // authorization check is needed here.
  const [media, members] = await Promise.all([listTripMedia(trip.id), listTripMembers(trip.id)]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{trip.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {formatTripDateRange(trip.start_date, trip.end_date)}
          </p>
        </div>
        {isOwner ? (
          <div className="flex shrink-0 gap-2">
            <Link
              href={`/trips/${trip.id}/edit`}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Edit
            </Link>
            <DeleteTripButton tripId={trip.id} tripName={trip.name} />
          </div>
        ) : null}
      </div>

      {trip.description ? (
        <p className="mt-6 whitespace-pre-wrap text-gray-700">{trip.description}</p>
      ) : (
        <p className="mt-6 text-sm text-gray-400">No description yet.</p>
      )}

      <MemoriesSection
        media={media}
        members={members}
        currentUserId={currentUserId}
        tripOwnerId={trip.owner_id}
        tripStartDate={trip.start_date}
        tripEndDate={trip.end_date}
      />

      <Link href="/trips" className="mt-8 inline-block text-sm text-gray-500 underline">
        ← Back to your trips
      </Link>
    </div>
  );
}
