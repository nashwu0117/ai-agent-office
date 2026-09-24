import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Express, NextFunction, Request, Response } from "express";
import type { IncomingMessage } from "node:http";
import { loginLimiter } from "./rate-limits.js";

/**
 * v0.18: this project had zero access control from v0.1 through v0.16 —
 * it only ever assumed a single operator on localhost. Now that it's
 * reachable through a Cloudflare Tunnel (see QUICKSTART.md), anything
 * reachable from outside must prove it knows a password before touching
 * any /api route or the WebSocket feed.
 *
 * Deliberately not a real user/session system (see the build prompt's "明確
 * 不做" section): one shared password, one cookie, no accounts, no roles.
 *
 * Design choice — what happens with no AI_OFFICE_ACCESS_PASSWORD set:
 * plain local dev stays unauthenticated only when both the Host is local and
 * the TCP peer is loopback. Every other request is auth-gated, and when no
 * password is configured it is refused (503) rather than silently left open.
 */

const SESSION_COOKIE = "ai_office_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — single-operator convenience, not a security boundary by itself.

const ACCESS_PASSWORD = process.env.AI_OFFICE_ACCESS_PASSWORD?.trim() || undefined;
const REQUIRE_AUTH_ALWAYS = process.env.AI_OFFICE_REQUIRE_AUTH?.trim().toLowerCase() === "true";
// Ephemeral if AI_OFFICE_SESSION_SECRET isn't set: every restart invalidates
// existing sessions (re-login required), which is an acceptable cost for a
// single-operator tool and means nobody has to generate or store a signing
// secret by hand just to turn auth on.
const SESSION_SECRET = process.env.AI_OFFICE_SESSION_SECRET?.trim() || randomBytes(32).toString("hex");

function sign(value: string): string {
  return createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Local bypass requires both a local Host and a loopback socket peer. A Host
 * header is caller-controlled and cannot prove that a request is local.
 */
function isLocalHostHeader(hostHeader: string | undefined): boolean {
  const host = (hostHeader ?? "").split(":")[0].toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return normalized === "127.0.0.1" || normalized === "::1";
}

/** A local Host header alone is not proof the connection came from this machine. */
export function isLocalRequest(hostHeader: string | undefined, remoteAddress: string | undefined): boolean {
  return isLocalHostHeader(hostHeader) && isLoopbackAddress(remoteAddress);
}

function requestNeedsAuth(hostHeader: string | undefined, remoteAddress: string | undefined): boolean {
  return REQUIRE_AUTH_ALWAYS || !isLocalRequest(hostHeader, remoteAddress);
}

function makeSessionToken(): string {
  const payload = Buffer.from(JSON.stringify({ iat: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function isValidSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!timingSafeStringEqual(sig, sign(payload))) return false;
  try {
    const { iat } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { iat?: unknown };
    return typeof iat === "number" && Date.now() - iat < SESSION_TTL_MS;
  } catch {
    return false;
  }
}

function checkPassword(candidate: string): boolean {
  if (!ACCESS_PASSWORD) return false;
  // Compare signed forms, not the raw strings, purely so both sides of
  // timingSafeEqual are fixed-length regardless of the candidate's length.
  return timingSafeStringEqual(sign(candidate), sign(ACCESS_PASSWORD));
}

function sessionCookieFrom(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  try {
    return parseCookieHeader(cookieHeader)[SESSION_COOKIE];
  } catch {
    return undefined;
  }
}

function isRequestAuthenticated(
  hostHeader: string | undefined,
  cookieHeader: string | undefined,
  remoteAddress: string | undefined
): boolean {
  if (!requestNeedsAuth(hostHeader, remoteAddress)) return true;
  return isValidSessionToken(sessionCookieFrom(cookieHeader));
}

/** Applied to every /api route registered after it, except the /api/auth/* routes registered earlier — see index.ts's middleware order. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isRequestAuthenticated(req.headers.host, req.headers.cookie, req.socket.remoteAddress)) {
    next();
    return;
  }
  if (!ACCESS_PASSWORD) {
    res.status(503).json({
      error: "Remote access is disabled: set AI_OFFICE_ACCESS_PASSWORD in apps/server/.env.local, then restart the server.",
    });
    return;
  }
  res.status(401).json({ error: "Authentication required." });
}

/** Same check for the raw WebSocket upgrade request — there's no Express `req`/cookie-jar at that point, just the IncomingMessage. */
export function isUpgradeRequestAuthenticated(req: IncomingMessage): boolean {
  return isRequestAuthenticated(req.headers.host, req.headers.cookie, req.socket.remoteAddress);
}

function cookieIsSecure(req: Request): boolean {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

/** Registers /api/auth/{status,login,logout} directly on `app`, *before* the blanket `app.use("/api", requireAuth)` in index.ts so these three stay reachable without a session. */
export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/status", (req, res) => {
    res.json({
      authRequired: requestNeedsAuth(req.headers.host, req.socket.remoteAddress),
      authenticated: isRequestAuthenticated(req.headers.host, req.headers.cookie, req.socket.remoteAddress),
      // Lets the login screen tell "wrong password" apart from "operator hasn't set one up yet" without guessing.
      passwordConfigured: Boolean(ACCESS_PASSWORD),
    });
  });

  app.post("/api/auth/login", loginLimiter, (req, res) => {
    const { password } = req.body ?? {};
    if (typeof password !== "string" || !password) {
      res.status(400).json({ error: "password is required" });
      return;
    }
    if (!ACCESS_PASSWORD) {
      res.status(503).json({ error: "No AI_OFFICE_ACCESS_PASSWORD is configured on this server." });
      return;
    }
    if (!checkPassword(password)) {
      res.status(401).json({ error: "Incorrect password." });
      return;
    }
    res.cookie(SESSION_COOKIE, makeSessionToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieIsSecure(req),
      maxAge: SESSION_TTL_MS,
      path: "/",
    });
    res.status(204).end();
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  });
}

/** Surfaced once at startup, next to the credential-source logging in index.ts — same "tell the operator now, not only when a real request fails" reasoning. */
export function logAuthStartupState(): void {
  if (REQUIRE_AUTH_ALWAYS) {
    console.log("[ai-office] access auth: AI_OFFICE_REQUIRE_AUTH=true — every request, including localhost, needs a session.");
  } else {
    console.log("[ai-office] access auth: only loopback requests with a localhost Host are unauthenticated; all others need a session.");
  }
  if (!ACCESS_PASSWORD) {
    console.warn(
      "[ai-office] WARNING: AI_OFFICE_ACCESS_PASSWORD is not set — every non-loopback or non-localhost request (e.g. through the Cloudflare Tunnel) will be refused with 503 until you set it in apps/server/.env.local and restart. There is no default password."
    );
  } else {
    console.log("[ai-office] access auth: AI_OFFICE_ACCESS_PASSWORD is set — non-local requests need to log in first.");
  }
}
