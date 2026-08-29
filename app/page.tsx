import { Screen } from "@/components/screen";
import ChipRow from "@/components/chip-row";
import CoverShelf from "@/components/cover-shelf";
import Carousel from "@/components/carousel";
import AppRows from "@/components/app-rows";
import Changelog from "@/components/changelog";
import QuickLinks from "@/components/quick-links";
import { MUTED } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { changelog, recentlyAdded } from "@/lib/store";
import { currentUserId } from "@/lib/current-user";
import { adultsAllowed, shelfFor } from "@/lib/user-state";

// The catalog is a directory on disk, not a build-time constant: an app
// imported after the last deploy has to show up without one.
export const dynamic = "force-dynamic";

/**
 * Home, block for block from the sketch: chips, Recently Added, the Editor
 * carousel, a Media & Entertainment card, the Communication shelf, the
 * changelog and the category tiles.
 *
 * Each block is skipped when its category is empty — a real library fills up
 * unevenly, and a heading over an empty grid reads as a bug.
 */
export default async function HomePage() {
  const userId = await currentUserId();
  // Read once and passed down: three blocks and the category tiles all have to
  // agree about what this person may see, and asking four times invites three
  // of them to be right.
  const adults = adultsAllowed(userId);
  const [apps, recent, entries] = await Promise.all([
    shelfFor(userId),
    recentlyAdded(6, { adults }),
    changelog(3, { adults }),
  ]);

  const editors = apps.filter((a) => a.category === "Editor");
  const communication = apps.filter((a) => a.category === "Communication");
  const mediaAndEntertainment = apps
    .filter((a) => a.category === "Media" || a.category === "Entertainment")
    .slice(0, 4);

  return (
    <Screen>
      <ChipRow items={["For you", "New", "Kids", "Top"]} />

      {apps.length === 0 && (
        <p className={cn("px-[var(--pad)] py-10 text-center text-sm", MUTED)}>
          The library is empty.
        </p>
      )}

      {recent.length > 0 && (
        <CoverShelf
          title="Recently Added"
          action="View all"
          apps={recent}
          columns={6}
        />
      )}

      {editors.length > 0 && (
        <Carousel title="Editor" action="See all" apps={editors} />
      )}

      {mediaAndEntertainment.length > 0 && (
        <AppRows title="Media & Entertainment" apps={mediaAndEntertainment} />
      )}

      {communication.length > 0 && (
        <CoverShelf
          title="Communication"
          apps={communication}
          columns={4}
          sub="developer"
        />
      )}

      {/* The sketch's changelog block carries no heading of its own — the block
          has no title field. One is added here so the section does not read as
          a stray list between two headed sections. */}
      {entries.length > 0 && <Changelog title="What's new" items={entries} />}

      <QuickLinks title="Categories" adults={adults} />
    </Screen>
  );
}
