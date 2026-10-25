"use client";

/**
 * "Add a mod" — a Nexus Mods address, a GitHub repository for a mod that is
 * only there, or a name under a game picked from the list.
 *
 * The Nexus listing is looked up and shown before anything is written, the
 * same as Play and apkmb: whoever adds it sees whose words and picture they
 * are putting on the shelf. Adding it brings the game along — the first
 * Stardew Valley mod creates the Stardew Valley shelf.
 *
 * Closed until asked for, like the other admin panels on a public page.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { adminCall } from "@/lib/admin-call";
import { readAdminToken } from "@/lib/admin-token";
import { buttonClass, CARD, NOTE } from "@/components/primitives";
import { cn } from "@/lib/utils";
import type { NexusMod } from "@/lib/sources/nexus";
import type { GithubMod } from "@/lib/sources/github-mod";

const INPUT_CLS =
  "w-full rounded-full border border-[color:var(--border)] bg-[var(--card-2)] px-4 py-2 text-sm outline-none focus:border-[color:var(--accent)]";

type Preview = NexusMod & { pictureDataUrl: string | null };
type GithubPreview = GithubMod & { pictureDataUrl: string | null };

const NEW_GAME = "__new__";

export default function AddMod({
  games,
  categories = [],
}: {
  games: { slug: string; name: string }[];
  /** The categories mods here are filed under, offered for a GitHub mod. */
  categories?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [game, setGame] = useState(games[0]?.slug ?? NEW_GAME);
  const [gameName, setGameName] = useState("");
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repo, setRepo] = useState<GithubPreview | null>(null);
  const [repoGame, setRepoGame] = useState(games[0]?.slug ?? "");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => setToken(readAdminToken()), []);

  const opts = { hint: "Sign in as an admin, or unlock Manage", accept: [409] };

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const lookUp = () =>
    run(async () => {
      setPreview(null);
      const res = await adminCall(
        `/api/mods/nexus?url=${encodeURIComponent(url.trim())}`,
        undefined,
        token,
        opts
      );
      setPreview(res.mod);
    });

  const addNexus = () =>
    run(async () => {
      const res = await adminCall(
        "/api/mods",
        { method: "POST", body: JSON.stringify({ nexusUrl: url.trim() }) },
        token,
        opts
      );
      // 409: already on the shelf — go there instead of saying no.
      router.push(`/mods/${res.game}/${res.mod}`);
      router.refresh();
    });

  const lookUpRepo = () =>
    run(async () => {
      setRepo(null);
      const res = await adminCall(
        `/api/mods/github?url=${encodeURIComponent(repoUrl.trim())}`,
        undefined,
        token,
        opts
      );
      setRepo(res.mod);
    });

  const addGithub = () =>
    run(async () => {
      const res = await adminCall(
        "/api/mods",
        {
          method: "POST",
          body: JSON.stringify({ githubUrl: repoUrl.trim(), game: repoGame, category }),
        },
        token,
        opts
      );
      router.push(`/mods/${res.game}/${res.mod}`);
      router.refresh();
    });

  const addByHand = () =>
    run(async () => {
      let slug = game;
      if (game === NEW_GAME) {
        const made = await adminCall(
          "/api/mods",
          { method: "POST", body: JSON.stringify({ newGame: gameName }) },
          token,
          opts
        );
        slug = made.game;
      }
      if (!name.trim()) {
        router.push(`/mods/${slug}`);
        router.refresh();
        return;
      }
      const res = await adminCall(
        "/api/mods",
        { method: "POST", body: JSON.stringify({ game: slug, name }) },
        token,
        opts
      );
      router.push(`/mods/${res.game}/${res.mod}`);
      router.refresh();
    });

  if (!open) {
    return (
      <div className="px-[var(--pad)]">
        <button
          onClick={() => setOpen(true)}
          className={cn(buttonClass("secondary", "sm"), "w-full justify-center")}
        >
          <Plus size={14} />
          Add a mod
        </button>
      </div>
    );
  }

  return (
    <div className="px-[var(--pad)]">
      <div className={cn(CARD, "space-y-4 p-3")}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Add a mod</p>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded-full p-1 text-[color:var(--muted)]"
          >
            <X size={15} />
          </button>
        </div>

        <div className="space-y-2">
          <p className={NOTE}>
            From Nexus Mods: paste the mod&apos;s page. Its name, picture, author
            and description are copied over and the game is created if it is
            not here yet. The archive itself is uploaded on the mod&apos;s page
            afterwards.
          </p>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && url.trim() && void lookUp()}
              placeholder="https://www.nexusmods.com/stardewvalley/mods/1915"
              className={INPUT_CLS}
              disabled={busy}
            />
            <button
              onClick={() => void lookUp()}
              disabled={busy || !url.trim()}
              className={cn(buttonClass("secondary", "sm"), "shrink-0 disabled:opacity-50")}
            >
              <Search size={14} /> Look up
            </button>
          </div>

          {preview && (
            <div className="flex gap-3 rounded-[var(--radius)] border border-[color:var(--border)] p-2">
              {preview.pictureDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview.pictureDataUrl}
                  alt=""
                  className="h-20 w-32 shrink-0 rounded-[var(--radius-sm)] object-cover"
                />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm font-semibold">{preview.name}</p>
                <p className={NOTE}>
                  {preview.game.name} · {preview.author || "unknown author"}
                  {preview.version ? ` · v${preview.version}` : ""}
                  {preview.adult ? " · adult content" : ""}
                </p>
                <p className="line-clamp-2 text-xs">{preview.summary}</p>
                <button
                  onClick={() => void addNexus()}
                  disabled={busy}
                  className={cn(buttonClass("primary", "sm"), "disabled:opacity-50")}
                >
                  <Plus size={14} /> Add to {preview.game.name}
                </button>
              </div>
            </div>
          )}
        </div>

        {games.length > 0 && (
          <div className="space-y-2 border-t border-[color:var(--border)] pt-3">
            <p className={NOTE}>
              Only on GitHub: paste the repository. Its README becomes the
              description, the owner the author, and the newest release&apos;s
              archive is fetched as the mod&apos;s file.
            </p>
            <div className="flex gap-2">
              <input
                value={repoUrl}
                onChange={(e) => {
                  setRepoUrl(e.target.value);
                  setRepo(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && repoUrl.trim() && void lookUpRepo()}
                placeholder="https://github.com/<owner>/<repo>"
                className={INPUT_CLS}
                disabled={busy}
              />
              <button
                onClick={() => void lookUpRepo()}
                disabled={busy || !repoUrl.trim()}
                className={cn(buttonClass("secondary", "sm"), "shrink-0 disabled:opacity-50")}
              >
                <Search size={14} /> Look up
              </button>
            </div>

            {repo && (
              <div className="space-y-2 rounded-[var(--radius)] border border-[color:var(--border)] p-2">
                <div className="flex gap-3">
                  {repo.pictureDataUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={repo.pictureDataUrl}
                      alt=""
                      className="h-20 w-32 shrink-0 rounded-[var(--radius-sm)] object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-semibold">{repo.name}</p>
                    <p className={NOTE}>
                      {repo.author}
                      {repo.version ? ` · v${repo.version}` : ""}
                    </p>
                    <p className="line-clamp-2 text-xs">{repo.summary}</p>
                    <p className={NOTE}>
                      {repo.release
                        ? `Files: ${repo.release.assets.map((a) => a.name).join(", ")}`
                        : "No release with an archive — upload the file afterwards."}
                    </p>
                  </div>
                </div>
                <select
                  value={repoGame}
                  onChange={(e) => setRepoGame(e.target.value)}
                  disabled={busy}
                  aria-label="Game"
                  className={INPUT_CLS}
                >
                  {games.map((g) => (
                    <option key={g.slug} value={g.slug}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  list="mod-categories"
                  placeholder="Category, as on Nexus (optional)"
                  className={INPUT_CLS}
                  disabled={busy}
                />
                <datalist id="mod-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <button
                  onClick={() => void addGithub()}
                  disabled={busy || !repoGame}
                  className={cn(buttonClass("primary", "sm"), "disabled:opacity-50")}
                >
                  <Plus size={14} /> Add to {games.find((g) => g.slug === repoGame)?.name}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2 border-t border-[color:var(--border)] pt-3">
          <p className={NOTE}>
            By hand: pick the game, or name a new one. Leave the mod name empty
            to add only the game.
          </p>
          <select
            value={game}
            onChange={(e) => setGame(e.target.value)}
            disabled={busy}
            className={INPUT_CLS}
          >
            {games.map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.name}
              </option>
            ))}
            <option value={NEW_GAME}>New game…</option>
          </select>
          {game === NEW_GAME && (
            <input
              value={gameName}
              onChange={(e) => setGameName(e.target.value)}
              placeholder="Game name"
              className={INPUT_CLS}
              disabled={busy}
            />
          )}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mod name"
            className={INPUT_CLS}
            disabled={busy}
          />
          <button
            onClick={() => void addByHand()}
            disabled={busy || (game === NEW_GAME ? !gameName.trim() : !name.trim())}
            className={cn(buttonClass("secondary", "sm"), "w-full justify-center disabled:opacity-50")}
          >
            <Plus size={14} /> {name.trim() ? "Add mod" : "Add game"}
          </button>
        </div>

        {error && <p className="text-xs text-[color:var(--danger)]">{error}</p>}
      </div>
    </div>
  );
}
