import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, Download, ExternalLink } from "lucide-react";
import { Screen } from "@/components/screen";
import { Button, CARD, MUTED, SectionTitle, Thumb } from "@/components/primitives";
import BBCode from "@/components/bbcode";
import ModFiles from "@/components/mod-files";
import { findGame, findMod, MOD_EXTENSIONS, type ModFile, type ModRequirement } from "@/lib/mods";
import { currentUser } from "@/lib/current-user";
import { adultsAllowed } from "@/lib/user-state";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ game: string; mod: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { game, mod: slug } = await params;
  const viewer = await currentUser();
  const mod = await findMod(game, slug, adultsAllowed(viewer?.id ?? null));
  return mod ? { title: mod.name, description: mod.summary } : {};
}

function month(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "–"
    : date.toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" });
}

function count(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(n);
}

const FILE_KIND_LABEL: Record<ModFile["kind"], string> = {
  archive: "Mod",
  app: "APK",
  data: "OBB",
};

const KIND_LABEL: Record<ModRequirement["kind"], string> = {
  mod: "Mod",
  external: "Off Nexus",
  dlc: "DLC",
};

function RequirementRow({ req }: { req: ModRequirement }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{req.name}</span>
        <span className={cn("block text-xs", MUTED)}>
          {[KIND_LABEL[req.kind], req.here ? "in this store" : "", req.notes]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      {req.here ? (
        <ChevronRight size={16} className={MUTED} />
      ) : req.url ? (
        <ExternalLink size={14} className={MUTED} />
      ) : null}
    </>
  );
  const row = "flex items-center gap-3 px-3.5 py-3";
  if (req.here) {
    return (
      <Link href={req.here} className={row}>
        {body}
      </Link>
    );
  }
  if (req.url) {
    return (
      <a href={req.url} target="_blank" rel="noreferrer noopener" className={row}>
        {body}
      </a>
    );
  }
  return <div className={row}>{body}</div>;
}

export default async function ModPage({ params }: Params) {
  const { game: gameSlug, mod: slug } = await params;
  const viewer = await currentUser();
  const adults = adultsAllowed(viewer?.id ?? null);
  const [game, mod] = await Promise.all([
    findGame(gameSlug, adults),
    findMod(gameSlug, slug, adults),
  ]);
  if (!game || !mod) notFound();
  // The newest file of each kind gets a button of its own: a mod used
  // through a launcher needs both the launcher APK and the mod archive.
  const primary: ModFile[] = [];
  for (const f of mod.files) {
    if (!primary.some((p) => p.kind === f.kind)) primary.push(f);
  }
  primary.sort((a, b) => (a.kind === "archive" ? -1 : b.kind === "archive" ? 1 : 0));
  const older = mod.files.filter((f) => !primary.includes(f));
  const labelled = primary.length > 1;

  return (
    <Screen flush>
      <div className="relative">
        <Thumb
          seed={mod.seed}
          src={mod.picture}
          className="h-44 w-full sm:h-64"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#100913] via-transparent to-transparent" />
        <Link
          href={`/mods/${game.slug}`}
          aria-label="Back"
          className="absolute left-3 top-3 rounded-full bg-black/45 p-2 backdrop-blur"
        >
          <ArrowLeft size={16} />
        </Link>
      </div>

      <div className="px-[var(--pad)]">
        <p className={cn("text-xs", MUTED)}>
          <Link href={`/mods/${game.slug}`} className="hover:underline">
            {game.name}
          </Link>
          {mod.category ? ` · ${mod.category}` : ""}
        </p>
        <h1 className="text-lg font-semibold">{mod.name}</h1>
        <p className={cn("text-sm", MUTED)}>
          {[mod.author && `by ${mod.author}`, mod.version && `v${mod.version}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-[var(--pad)]">
        {primary.length > 0 ? (
          // Plain links, so the browser's own download manager handles them and
          // an interrupted transfer can resume — the route serves ranges.
          primary.map((f, i) => (
            <a key={f.file} href={f.href} className="min-w-[12rem] flex-1">
              <Button
                variant={i === 0 ? undefined : "secondary"}
                className="w-full justify-center"
              >
                <Download size={15} /> {labelled ? FILE_KIND_LABEL[f.kind] : "Download"}
                {f.version ? ` ${f.version}` : ""} · {f.size}
              </Button>
            </a>
          ))
        ) : (
          <Button variant="ghost" className="flex-1 justify-center">
            No download yet
          </Button>
        )}
        {mod.nexus && (
          <a href={mod.nexus.url} target="_blank" rel="noreferrer noopener">
            <Button variant="secondary">
              <ExternalLink size={15} /> Nexus
            </Button>
          </a>
        )}
      </div>

      {older.length > 0 && (
        <div className="px-[var(--pad)]">
          <SectionTitle title="Other files" />
          <div className="flex flex-wrap gap-2">
            {older.map((f) => (
              <a key={f.file} href={f.href}>
                <Button size="sm" variant="secondary">
                  <Download size={13} /> {f.version ? `${f.version} · ` : ""}
                  {f.file} · {f.size}
                </Button>
              </a>
            ))}
          </div>
        </div>
      )}

      {viewer?.role === "admin" && (
        <ModFiles
          game={mod.game}
          mod={mod.slug}
          version={mod.version}
          fromNexus={Boolean(mod.nexus)}
          files={mod.files.map((f) => ({ file: f.file, size: f.size, version: f.version }))}
          accept={MOD_EXTENSIONS}
        />
      )}

      {mod.nexus && (
        <div className="grid grid-cols-3 gap-2 px-[var(--pad)]">
          {[
            ["Downloads", count(mod.nexus.downloads)],
            ["Endorsements", count(mod.nexus.endorsements)],
            ["Updated", month(mod.nexus.updatedAt)],
          ].map(([label, value]) => (
            <div key={label} className={cn(CARD, "p-2.5 text-center")}>
              <p className="text-sm font-semibold">{value}</p>
              <p className={cn("text-[11px] uppercase tracking-wide", MUTED)}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {mod.requirements.length > 0 && (
        <section className="px-[var(--pad)]">
          <SectionTitle title="Requirements" />
          <p className={cn("-mt-2 mb-3 text-xs", MUTED)}>
            Install these first — the mod does nothing without them.
          </p>
          <div
            className={cn(
              CARD,
              "divide-y divide-[color:var(--border)] overflow-hidden"
            )}
          >
            {mod.requirements.map((req, i) => (
              <RequirementRow key={`${req.kind}-${req.name}-${i}`} req={req} />
            ))}
          </div>
        </section>
      )}

      {(mod.description || mod.summary) && (
        <div className="px-[var(--pad)]">
          <SectionTitle title="About" />
          {mod.description ? (
            <BBCode
              source={mod.description}
              images={mod.images}
              className="whitespace-pre-line break-words text-sm leading-relaxed"
            />
          ) : (
            <p className="text-sm leading-relaxed">{mod.summary}</p>
          )}
        </div>
      )}
    </Screen>
  );
}
