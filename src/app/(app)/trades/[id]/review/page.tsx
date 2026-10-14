import { redirect } from "next/navigation";

/** "Dopuna iz snimka" is part of the trade page now (phase P); `/daily` linked here. */
export default async function ReviewTradeRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/trades/${id}?from=daily`);
}
