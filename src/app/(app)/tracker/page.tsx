import { redirect } from "next/navigation";

/**
 * The tracker used to be its own page; the checklist now lives inside the daily
 * report, because both describe the same day and `tj_lock_day` seals them
 * together in one call.
 *
 * Kept as a redirect rather than deleted: the route was linked and bookmarkable,
 * and the date carries over so a link to a specific day still lands on that day.
 */
export default async function TrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  redirect(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `/daily?date=${date}` : "/daily");
}
