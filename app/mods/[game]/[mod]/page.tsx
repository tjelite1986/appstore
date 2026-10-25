import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, Download, ExternalLink } from "lucide-react";
import { Screen } from "@/components/screen";
import { Button, CARD, MUTED, SectionTitle, Thumb } from "@/components/primitives";
import BBCode from "@/components/bbcode";
import ModFiles from "@/components/mod-files";
import {
  findGame,
  findMod,
  gameMods,
  MOD_EXTENSIONS,
  MOD_FILE_SECTIONS,
  type ModFile,
  type ModFileSection,
  type ModRequirement,
} from "@/lib/mods";
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

function day(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "–"
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/Stockholm",
      });
}

function count(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(n);
}

// An archive is what a mod page is expected to hold; the others say so.
const FILE_KIND_LABEL: Record<ModFile["kind"], string> = {
  archive: "",
  app: "APK",
  data: "OBB",
};

const SECTION_TITLE: Record<ModFileSection, string> = {
  main: "Main files",
  optional: "Optional files",
};

// One card per file, all alike: a Nexus page often holds several mods, so
// "newest" says nothing about which one somebody came for.
function FileCard({ file }: { file: ModFile }) {
  const kind = FILE_KIND_LABEL[file.kind];
  return (
    <div className={cn(CARD, "flex items-center gap-3 p-3")}>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-semibold">
          {file.name}
          {kind && (
            <span
              className={cn(
                "ml-2 rounded-full border border-[color:var(--border)] px-1.5 py-px align-middle text-[10px] font-medium",
                MUTED
              )}
            >
              {kind}
            </span>
          )}
        </p>
        <p className={cn("mt-0.5 text-xs", MUTED)}>
          {[file.version && `v${file.version}`, `Uploaded ${day(file.added)}`, file.size]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {/* A plain link, so the browser's own download manager handles it and
          an interrupted transfer can resume — the route serves ranges. */}
      <a href={file.href} className="shrink-0">
        <Button size="sm">
          <Download size={14} /> Download
        </Button>
      </a>
    </div>
  );
}

// The groups Nexus shows a mod's requirements in, in its order.
const REQUIREMENT_GROUPS: { kind: ModRequirement["kind"]; title: string }[] = [
  { kind: "mod", title: "Nexus requirements" },
  { kind: "external", title: "Off-site requirements" },
  { kind: "dlc", title: "DLC requirements" },
];

function RequirementRow({ req }: { req: ModRequirement }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{req.name}</span>
        <span className={cn("block text-xs", MUTED)}>
          {[req.here ? "In this store" : "", req.notes]
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
  const admin = viewer?.role === "admin";
  // What a requirement can be linked to: the game's other mods.
  const linkable = admin
    ? (await gameMods(game.slug, adults))
        .filter((m) => m.slug !== mod.slug)
        .map((m) => ({ slug: m.slug, name: m.name }))
    : [];

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

      {mod.nexus && (
        <div className="px-[var(--pad)]">
          <a href={mod.nexus.url} target="_blank" rel="noreferrer noopener">
            <Button variant="secondary">
              <ExternalLink size={15} /> Nexus
            </Button>
          </a>
        </div>
      )}

      {mod.files.length > 0 ? (
        MOD_FILE_SECTIONS.map((section) => {
          const files = mod.files.filter((f) => f.section === section);
          return (
            files.length > 0 && (
              <section key={section} className="px-[var(--pad)]">
                <SectionTitle title={SECTION_TITLE[section]} />
                <div className="space-y-2">
                  {files.map((f) => (
                    <FileCard key={f.file} file={f} />
                  ))}
                </div>
              </section>
            )
          );
        })
      ) : (
        <section className="px-[var(--pad)]">
          <SectionTitle title="Files" />
          <p className={cn("text-sm", MUTED)}>No download yet.</p>
        </section>
      )}

      {admin && (
        <ModFiles
          game={mod.game}
          mod={mod.slug}
          version={mod.version}
          fromNexus={Boolean(mod.nexus)}
          files={mod.files.map((f) => ({
            file: f.file,
            name: f.name,
            section: f.section,
            size: f.size,
            version: f.version,
          }))}
          accept={MOD_EXTENSIONS}
          requirements={mod.requirements.map((r) => ({
            key: r.key,
            name: r.name,
            linkedTo: r.linked && r.here ? r.here.split("/").pop()! : "",
            found: !r.linked && Boolean(r.here),
          }))}
          linkable={linkable}
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
          <div className="space-y-3">
            {REQUIREMENT_GROUPS.map(({ kind, title }) => {
              const reqs = mod.requirements.filter((r) => r.kind === kind);
              return (
                reqs.length > 0 && (
                  <div key={kind}>
                    <p className={cn("mb-1.5 text-xs font-medium", MUTED)}>{title}</p>
                    <div
                      className={cn(
                        CARD,
                        "divide-y divide-[color:var(--border)] overflow-hidden"
                      )}
                    >
                      {reqs.map((req, i) => (
                        <RequirementRow key={`${req.key}-${i}`} req={req} />
                      ))}
                    </div>
                  </div>
                )
              );
            })}
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
