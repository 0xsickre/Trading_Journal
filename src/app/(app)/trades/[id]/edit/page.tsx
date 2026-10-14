import { redirect } from "next/navigation";

/** The old edit form; the trade has one page now (phase P). Kept so old links and bookmarks still land. */
export default async function EditTradeRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/trades/${id}`);
}
