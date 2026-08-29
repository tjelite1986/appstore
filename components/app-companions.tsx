/**
 * The apps that are installed together, and which of the pair is the point.
 *
 * Some apps do nothing on their own: microG is not a thing to open, it is what
 * a YouTube mod signs into Google through, and an Xposed module is a file the
 * host loads. They are still real apps — own package id, own signer, own
 * releases — so this store gives each one a listing rather than smuggling it
 * in as a second file under the host's version (see `requires` in
 * `lib/store.ts`). What it does not do is put them on the shelf, because
 * nobody browses for one. This section is where they are met instead.
 *
 * It renders on both sides of the same relation: the host's page lists its
 * companions, and a companion's page lists the hosts it is for — which is the
 * answer to "what have I just found in search", and it is worth an answer.
 *
 * No client state: every row is a link, and the button is the same plain
 * download link the page above uses.
 */
import Link from "next/link";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, CARD, MUTED, SectionTitle, Thumb } from "@/components/primitives";

export type Companion = {
  slug: string;
  name: string;
  version: string;
  /** One line about the app, where the listing has one. */
  tagline?: string;
  icon?: string;
  iconBackground?: string;
  iconFit?: "cover" | "contain";
  seed: number;
  /** The newest build's download link, or nothing when there is no file. */
  href?: string;
};

export default function AppCompanions({
  items,
  title,
  note,
}: {
  items: Companion[];
  title: string;
  /** Why the section is here — the fact the rows themselves cannot carry. */
  note: string;
}) {
  if (items.length === 0) return null;

  return (
    <section className="px-[var(--pad)]">
      <SectionTitle title={title} />
      <p className={cn("-mt-2 mb-3 text-xs", MUTED)}>{note}</p>
      <div className={cn(CARD, "overflow-hidden")}>
        {items.map((m, i) => (
          <div
            key={m.slug}
            className={cn(
              "flex items-center gap-3 px-3.5 py-3",
              i > 0 && "border-t border-[color:var(--border)]"
            )}
          >
            <Link href={`/app/${m.slug}`} className="shrink-0">
              <Thumb
                seed={m.seed}
                src={m.icon}
                background={m.iconBackground}
                fit={m.iconFit}
                alt={m.name}
                className="h-10 w-10 rounded-[calc(var(--radius)/1.6)] border border-[color:var(--border)]"
              />
            </Link>
            <Link href={`/app/${m.slug}`} className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{m.name}</span>
              <span className={cn("block truncate text-xs", MUTED)}>
                {/* The tagline where there is one — a companion's name says
                    nothing about what it does — and the version where there is
                    not, so the line is never empty. */}
                {m.tagline || m.version}
              </span>
            </Link>
            {m.href ? (
              <a href={m.href} className="shrink-0">
                <Button size="sm" variant="secondary">
                  <Download size={13} /> Install
                </Button>
              </a>
            ) : (
              <Button size="sm" variant="ghost" className="shrink-0">
                No file
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
