import rateLimit from "express-rate-limit";

/**
 * v0.18: this server sits behind cloudflared -> the Vite dev proxy, both on
 * the same box, so every request Express sees arrives from 127.0.0.1
 * regardless of the real external client (see QUICKSTART.md's Cloudflare
 * Tunnel section) — express-rate-limit's default per-IP bucketing therefore
 * behaves as one shared bucket across all traffic here. That's an accepted
 * tradeoff for a single-operator tool: it still stops a runaway loop or an
 * abused tunnel link from burning real third-party API quota, it just also
 * throttles the operator's own concurrent use if that happens.
 */

/** Auth attempts — the one endpoint an outsider can hit with no cookie at all, so this is the actual brute-force brake. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

/** Task/goal dispatch — every accepted request spawns a real worker CLI process against a real backend. */
export const dispatchLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many tasks/goals submitted. Try again in a few minutes." },
});

/** Backend-profile model listing — calls the provider's real API with that profile's real credential. */
export const modelsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many model-listing requests. Try again in a few minutes." },
});

/** Everything else under /api — a generous ceiling, just to blunt a runaway client or scripted abuse. */
export const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests." },
});
