import { redirect } from "next/navigation";

/**
 * The address custom categories had for a day, when they were called
 * collections. Temporary on purpose: a cached permanent redirect could never
 * be taken back.
 */
export default async function CollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/category/${encodeURIComponent(decodeURIComponent(slug))}`);
}
