import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { Screen } from "@/components/screen";
import { CARD, MUTED, SectionTitle, Thumb } from "@/components/primitives";
import AddMod from "@/components/add-mod";
import { findGame, gameMods, type StoreMod } from "@/lib/mods";
import { currentUser } from "@/lib/current-user";
import { adultsAllowed } from "@/lib/user-state";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const UNCATEGORISED = "Other";

/** Nexus's categories A–Z, the mods without one last. */
function groupByCategory(mods: StoreMod[]): [string, StoreMod[]][] {
  const groups = new Map<string, StoreMod[]>();
  for (const m of mods) {
    const category = m.category || UNCATEGORISED;
    groups.set(category, [...(groups.get(category) ?? []), m]);
  }
  return [...groups].sort(([a], [b]) =>
    a === UNCATEGORISED ? 1 : b === UNCATEGORISED ? -1 : a.localeCompare(b)
  );
}

/** One game's mods, by Nexus category and then by name. */
export default async function GameModsPage({
  params,
  searchParams,
}: {
  params: Promise<{ game: string }>;
  searchParams: Promise<{ c?: string | string[] }>;
}) {
  const { game: slug } = await params;
  const { c } = await searchParams;
  const viewer = await currentUser();
  const adults = adultsAllowed(viewer?.id ?? null);
  const game = await findGame(slug, adults);
  if (!game) notFound();
  const mods = await gameMods(slug, adults);
  const groups = groupByCategory(mods);
  // A category the game no longer has shows everything rather than nothing.
  const picked = groups.some(([category]) => category === c) ? (c as string) : null;
  const chips = [
    { label: "All", n: mods.length, value: null as string | null },
    ...groups.map(([category, list]) => ({ label: category, n: list.length, value: category })),
  ];

  return (
    <Screen>
      <div className="flex items-center gap-3 px-[var(--pad)]">
        <Link href="/mods" aria-label="Back" className={cn("rounded-full p-1.5", MUTED)}>
          <ArrowLeft size={18} />
        </Link>
        <Thumb
          seed={game.seed}
          src={game.cover}
          alt=""
          className="h-12 w-16 shrink-0 rounded-[var(--radius-sm)]"
        />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{game.name}</h1>
          <p className={cn("text-sm", MUTED)}>
            {mods.length} {mods.length === 1 ? "mod" : "mods"}
          </p>
        </div>
      </div>

      {groups.length > 1 && (
        <nav
          aria-label="Categories"
          className="flex gap-2 overflow-x-auto px-[var(--pad)] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {chips.map(({ label, n, value }) => (
            <Link
              key={label}
              href={value ? `/mods/${slug}?c=${encodeURIComponent(value)}` : `/mods/${slug}`}
              aria-current={picked === value ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border py-1.5 pl-3 pr-2 text-xs font-medium transition",
                picked === value
                  ? "border-[color:var(--accent)] bg-[var(--accent-soft)] text-[color:var(--fg)]"
                  : "border-[color:var(--border)] bg-[var(--card)] text-[color:var(--muted-2)] hover:border-[color:var(--accent)] hover:text-[color:var(--fg)]"
              )}
            >
              <span className="whitespace-nowrap">{label}</span>
              <span className="rounded-full bg-[var(--card-2)] px-1.5 text-[10px] tabular-nums leading-4">
                {n}
              </span>
            </Link>
          ))}
        </nav>
      )}

      {mods.length === 0 ? (
        <p className={cn("px-[var(--pad)] text-sm", MUTED)}>No mods for this game yet.</p>
      ) : (
        groups
          .filter(([category]) => !picked || category === picked)
          .map(([category, list]) => (
          <section key={category} className="px-[var(--pad)]">
            <SectionTitle title={`${category} (${list.length})`} />
            <ul className="space-y-2">
              {list.map((m) => (
                <li key={m.slug}>
                  <Link
                    href={`/mods/${m.game}/${m.slug}`}
                    className={cn(CARD, "flex gap-3 p-2.5")}
                  >
                    <Thumb
                      seed={m.seed}
                      src={m.picture}
                      alt=""
                      className="h-16 w-24 shrink-0 rounded-[var(--radius-sm)]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{m.name}</p>
                      <p className={cn("truncate text-xs", MUTED)}>
                        {[m.author, m.version && `v${m.version}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs">{m.summary}</p>
                    </div>
                    {m.files.length > 0 && (
                      <Download size={15} className={cn("mt-1 shrink-0", MUTED)} />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {viewer?.role === "admin" && (
        <AddMod
          games={[{ slug: game.slug, name: game.name }]}
          categories={groups.map(([category]) => category).filter((c) => c !== UNCATEGORISED)}
        />
      )}
    </Screen>
  );
}
