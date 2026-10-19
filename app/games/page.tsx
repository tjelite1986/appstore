import KindBrowse from "@/components/kind-browse";

export const dynamic = "force-dynamic";

/** Games — the same screen as Apps over the game shelves. */
export default function GamesPage() {
  return <KindBrowse kind="game" />;
}
