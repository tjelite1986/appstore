/**
 * Working out which source an address belongs to.
 *
 * One input beats three, but only if the store can tell a repository from a
 * package id without being told. Most addresses say plainly where they came
 * from — a github.com URL, an f-droid.org page — and the ones that do not are
 * left ambiguous rather than guessed at: a bare `org.something.app` is a
 * legitimate id on F-Droid and on Play both, and picking one for the person
 * would silently create the wrong kind of entry.
 *
 * Pure on purpose: the Manage panel decides which button to show from the same
 * function the routes are addressed by, so it cannot touch the filesystem.
 */
export type Detected = {
  /** The source this address certainly belongs to. */
  kind: "github" | "fdroid" | "play";
  /** What to send to that source's route. */
  ref: string;
  /** The other source this could equally be, when the address does not say. */
  alternative?: "fdroid";
};

const GITHUB_URL = /github\.com\/([\w.-]+)\/([\w.-]+)/i;
const FDROID_PAGE = /f-droid\.org\/[^\s]*packages\/([a-zA-Z0-9._]+)/i;
const PLAY_URL = /play\.google\.com\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/i;
const PACKAGE_ID = /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/;
const OWNER_REPO = /^([\w.-]+)\/([\w.-]+)$/;

export function detectSource(input: string): Detected {
  const s = input.trim();

  const fdroid = s.match(FDROID_PAGE);
  if (fdroid) return { kind: "fdroid", ref: fdroid[1] };

  const github = s.match(GITHUB_URL);
  if (github) {
    return { kind: "github", ref: `${github[1]}/${github[2].replace(/\.git$/i, "")}` };
  }

  const play = s.match(PLAY_URL);
  if (play) return { kind: "play", ref: play[1] };

  // "owner/repo" only counts when it is not a path out of some other URL.
  const ownerRepo = s.match(OWNER_REPO);
  if (ownerRepo && !s.includes("://")) {
    return { kind: "github", ref: s };
  }

  // A package id could be either store. Play is the default because searching
  // it is what this panel has always done, and a search changes nothing.
  if (PACKAGE_ID.test(s)) return { kind: "play", ref: s, alternative: "fdroid" };

  return { kind: "play", ref: s };
}
