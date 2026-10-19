import KindBrowse from "@/components/kind-browse";

export const dynamic = "force-dynamic";

/** Apps — the whole non-game catalog. See `KindBrowse` for the layout. */
export default function AppsPage() {
  return <KindBrowse kind="app" />;
}
