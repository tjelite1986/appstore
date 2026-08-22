import { Screen } from "@/components/screen";
import ChipRow from "@/components/chip-row";
import CoverShelf from "@/components/cover-shelf";
import Carousel from "@/components/carousel";
import AppRows from "@/components/app-rows";
import Changelog from "@/components/changelog";
import QuickLinks from "@/components/quick-links";
import { APPS, CHANGELOG, RECENTLY_ADDED, byCategory } from "@/lib/catalog";

/**
 * Home, block for block from the sketch: chips, Recently Added, the Editor
 * carousel, a Media & Entertainment card, the Communication shelf, the
 * changelog and the category tiles.
 */
export default function HomePage() {
  const editors = byCategory("Editor");
  const mediaAndEntertainment = APPS.filter(
    (a) => a.category === "Media" || a.category === "Entertainment"
  ).slice(0, 4);

  return (
    <Screen>
      <ChipRow items={["For you", "New", "Kids", "Top"]} />

      <CoverShelf
        title="Recently Added"
        action="View all"
        apps={RECENTLY_ADDED}
        columns={6}
      />

      <Carousel title="Editor" action="See all" apps={editors} />

      <AppRows title="Media & Entertainment" apps={mediaAndEntertainment} />

      <CoverShelf
        title="Communication"
        apps={byCategory("Communication")}
        columns={4}
        sub="developer"
      />

      {/* The sketch's changelog block carries no heading of its own — the block
          has no title field. One is added here so the section does not read as
          a stray list between two headed sections. */}
      <Changelog title="What's new" items={CHANGELOG} />

      <QuickLinks title="Categories" />
    </Screen>
  );
}
