/**
 * The Telegram feed.
 *
 *   GET   what the last run did, and where each channel's cursor stands
 *   POST  start a run, if one is not already going
 *
 * POST returns immediately rather than waiting: a run downloads up to five
 * files of up to 400 MB and then sits out the importer's quiet period, which
 * is minutes, and no proxy in front of this would hold that request open.
 * Progress is read back with GET.
 */
import { requireAdmin } from "@/lib/admin";
import {
  readRun,
  readState,
  startTelegramSync,
  syncRunning,
  telegramConfig,
  telegramConfigured,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";

async function status() {
  const [state, run] = await Promise.all([readState(), readRun()]);
  const cfg = telegramConfig();
  return {
    configured: telegramConfigured(),
    running: syncRunning(),
    channels: cfg.channels.map((name) => ({
      name,
      ...(state.channels[name] ?? { cursor: 0 }),
    })),
    run,
  };
}

export async function GET(req: Request): Promise<Response> {
  const refusal = requireAdmin(req);
  if (refusal) return refusal;
  return Response.json(await status());
}

export async function POST(req: Request): Promise<Response> {
  const refusal = requireAdmin(req);
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
