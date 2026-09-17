import { createServer } from "node:net";

const MAX_FALLBACK_ATTEMPTS = 100;

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen({ port, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

/**
 * Same "try the preferred port, then walk upward until something's free"
 * fallback scripts/dev.mjs (v0.7.3) uses for the server/web dev ports — kept
 * as a standalone helper here (rather than importing scripts/dev.mjs, a
 * plain JS launcher script outside this package's TS build) so any
 * in-process listener started from Node code, like the v0.9 format-
 * translation proxy, doesn't clobber an unrelated process already bound to
 * its preferred port. Deliberately does NOT reimplement dev.mjs's stale-
 * own-process reclaim (PID/token file, SIGTERM-then-check): that logic
 * exists because scripts/dev.mjs supervises a separately-restarted OS
 * process across `tsx watch` reloads. A listener started here shares the
 * apps/server process's own lifecycle — it comes up and goes down with that
 * process, so there is no separate stale process of its own to reclaim from.
 */
export async function selectAvailablePort(
  preferredPort: number,
  label: string
): Promise<{ port: number; reservedFallback: boolean }> {
  if (await isPortAvailable(preferredPort)) return { port: preferredPort, reservedFallback: false };

  for (let offset = 1; offset <= MAX_FALLBACK_ATTEMPTS; offset += 1) {
    const candidate = preferredPort + offset;
    if (candidate > 65535) break;
    if (await isPortAvailable(candidate)) {
      console.warn(
        `[ai-office] ${label} port ${preferredPort} is occupied by another process; using port ${candidate} instead.`
      );
      return { port: candidate, reservedFallback: true };
    }
  }

  throw new Error(`No free ${label} port found in ${preferredPort + 1}-${Math.min(65535, preferredPort + MAX_FALLBACK_ATTEMPTS)}.`);
}
