/**
 * The Telegram feed.
 *
 *   GET   what the last run did, where each channel's cursor stands, and the
 *         links it rejected that a source could still describe an app from
 *   POST  start a run, if one is not already going
 *
 * POST returns immediately rather than waiting: a run downloads up to five
 * files of up to 400 MB and then sits out the importer's quiet period, which
 * is minutes, and no proxy in front of this would hold that request open.
 * Progress is read back with GET.
 */
import { requireAdmin } from "@/lib/admin";
import {
  listCandidates,
  readRun,
  readState,
  startTelegramSync,
  syncRunning,
  telegramConfig,
  telegramConfigured,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";

async function status() {
  const [state, run, candidates] = await Promise.all([
    readState(),
    readRun(),
    listCandidates(),
  ]);
  const cfg = telegramConfig();
  return {
    configured: telegramConfigured(),
    running: syncRunning(),
    channels: cfg.channels.map((name) => ({
      name,
      ...(state.channels[name] ?? { cursor: 0 }),
    })),
    run,
    // Addresses the feed could not download but a source can read. The URL is
    // all that travels: what the page says is fetched when someone asks for it,
    // not on every poll of this route.
    candidates,
  };
}

export async function GET(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;
  return Response.json(await status());
}

export async function POST(req: Request): Promise<Response> {
  const refusal = await requireAdmin(req);
  if (refusal) return refusal;

  if (!telegramConfigured()) {
    return Response.json(
      { error: "TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_SESSION are not set" },
      { status: 503 }
    );
  }
  const { started } = startTelegramSync();
  return Response.json({ started, ...(await status()) });
}
