import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = join(repoRoot, ".ai-office-dev");
const DEFAULT_SERVER_PORT = 43117;
const DEFAULT_WEB_PORT = 43118;
const MAX_FALLBACK_ATTEMPTS = 100;
const PORT_RELEASE_TIMEOUT_MS = 4_000;

const requestedRole = process.argv[2];
if (requestedRole !== undefined && requestedRole !== "server" && requestedRole !== "web") {
  console.error("Usage: node scripts/dev.mjs [server|web]");
  process.exit(2);
}

const roles = requestedRole ? [requestedRole] : ["server", "web"];
const children = new Map();
let shuttingDown = false;

function parsePort(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535; received ${JSON.stringify(value)}`);
  }
  return port;
}

function desiredPort(role) {
  if (role === "server") {
    return parsePort(process.env.AI_OFFICE_SERVER_PORT ?? process.env.PORT, DEFAULT_SERVER_PORT, "AI_OFFICE_SERVER_PORT");
  }
  return parsePort(process.env.AI_OFFICE_WEB_PORT ?? process.env.VITE_PORT, DEFAULT_WEB_PORT, "AI_OFFICE_WEB_PORT");
}

function statePath(role) {
  return join(stateDir, `${role}.json`);
}

function readState(role) {
  try {
    return JSON.parse(readFileSync(statePath(role), "utf8"));
  } catch {
    return undefined;
  }
}

function removeState(role, token) {
  const state = readState(role);
  if (!state || state.token === token) rmSync(statePath(role), { force: true });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readProcFile(pid, name) {
  try {
    return readFileSync(`/proc/${pid}/${name}`);
  } catch {
    return undefined;
  }
}

function isManagedProcess(role, state) {
  if (
    !state ||
    state.role !== role ||
    state.repoRoot !== repoRoot ||
    !Number.isInteger(state.pid) ||
    typeof state.token !== "string" ||
    !processExists(state.pid)
  ) {
    return false;
  }

  // Linux gives us a strong identity check: the random launch token must be
  // present in that exact process's environment, and its cwd must still be
  // this role's app directory. This prevents PID reuse from becoming a kill.
  const environ = readProcFile(state.pid, "environ");
  if (environ) {
    const entries = environ.toString("utf8").split("\0");
    const expectedCwd = join(repoRoot, "apps", role);
    let cwd;
    try {
      cwd = readlinkSync(`/proc/${state.pid}/cwd`);
    } catch {
      return false;
    }
    return entries.includes(`AI_OFFICE_LAUNCH_TOKEN=${state.token}`) && resolve(cwd) === expectedCwd;
  }

  // Best-effort fallback for systems without /proc: `ps eww` includes the
  // environment on common Unix systems, so retain the token check as well as
  // requiring this checkout's role-specific CLI path.
  let command = "";
  try {
    command = execFileSync("ps", ["eww", "-p", String(state.pid), "-o", "command="], {
      encoding: "utf8",
    });
  } catch {
    return false;
  }
  const roleMarker = role === "server" ? "tsx" : "vite";
  return command.includes(repoRoot) && command.includes(roleMarker) && command.includes(`AI_OFFICE_LAUNCH_TOKEN=${state.token}`);
}

function isPortAvailable(port) {
  return new Promise((resolveAvailable) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", () => resolveAvailable(false));
    probe.listen({ port, exclusive: true }, () => {
      probe.close(() => resolveAvailable(true));
    });
  });
}

async function waitForPortRelease(port) {
  const deadline = Date.now() + PORT_RELEASE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isPortAvailable(port)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return false;
}

async function stopManagedProcess(role, state) {
  console.log(`[ai-office:dev] ${role} port ${state.port} is held by this repo's previous process (pid ${state.pid}); stopping it safely.`);
  try {
    process.kill(-state.pid, "SIGTERM");
  } catch {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      return;
    }
  }

  const released = await waitForPortRelease(state.port);
  if (!released && processExists(state.pid)) {
    console.warn(`[ai-office:dev] previous ${role} process did not stop within ${PORT_RELEASE_TIMEOUT_MS}ms; leaving it alone and using a fallback port.`);
  }
}

async function selectPort(role, preferredPort, excludedPorts = new Set()) {
  const preferredIsReserved = excludedPorts.has(preferredPort);
  if (!preferredIsReserved && (await isPortAvailable(preferredPort))) return preferredPort;

  const state = readState(role);
  if (!preferredIsReserved && state?.port === preferredPort && isManagedProcess(role, state)) {
    await stopManagedProcess(role, state);
    if (await isPortAvailable(preferredPort)) {
      console.log(`[ai-office:dev] ${role} reclaimed port ${preferredPort} from its own stale process.`);
      return preferredPort;
    }
  }

  for (let offset = 1; offset <= MAX_FALLBACK_ATTEMPTS; offset += 1) {
    const candidate = preferredPort + offset;
    if (candidate > 65535) break;
    if (excludedPorts.has(candidate)) continue;
    if (await isPortAvailable(candidate)) {
      if (preferredIsReserved) {
        console.warn(
          `[ai-office:dev] expected ${role} port ${preferredPort} is reserved by the other AI Office service; using port ${candidate}.`
        );
      } else {
        console.warn(
          `[ai-office:dev] expected ${role} port ${preferredPort} is occupied and is not a verified stale AI Office process; ` +
            `leaving its owner untouched and using port ${candidate}.`
        );
      }
      return candidate;
    }
  }

  throw new Error(`No free ${role} port found in ${preferredPort + 1}-${Math.min(65535, preferredPort + MAX_FALLBACK_ATTEMPTS)}.`);
}

function processSpec(role, serverPort, webPort) {
  if (role === "server") {
    return {
      cwd: join(repoRoot, "apps", "server"),
      // --env-file-if-exists loads apps/server/.env.local (git-ignored) so the
      // backend-profile env vars documented in docs/backend-profiles-v0.13.md
      // actually reach process.env — found missing during the v0.14 readiness
      // check (the profiles' "available" flag always read false since nothing
      // ever loaded that file into this process).
      args: [
        "--env-file-if-exists=.env.local",
        join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        "watch",
        "src/index.ts",
      ],
      env: { AI_OFFICE_SERVER_PORT: String(serverPort) },
    };
  }
  return {
    cwd: join(repoRoot, "apps", "web"),
    // Keep the launcher's selected-port explanation visible above Vite's
    // own banner instead of letting Vite clear the terminal immediately.
    args: [join(repoRoot, "node_modules", "vite", "bin", "vite.js"), "--clearScreen=false"],
    env: {
      AI_OFFICE_SERVER_PORT: String(serverPort),
      AI_OFFICE_WEB_PORT: String(webPort),
      VITE_SERVER_PORT: String(serverPort),
    },
  };
}

function launch(role, serverPort, webPort) {
  const token = randomUUID();
  const port = role === "server" ? serverPort : webPort;
  const spec = processSpec(role, serverPort, webPort);
  const child = spawn(process.execPath, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env, AI_OFFICE_LAUNCH_TOKEN: token },
    stdio: "inherit",
    detached: process.platform !== "win32",
  });

  writeFileSync(
    statePath(role),
    `${JSON.stringify({ version: 1, role, pid: child.pid, port, repoRoot, token }, null, 2)}\n`,
    { mode: 0o600 }
  );
  children.set(role, { child, token });
  console.log(`[ai-office:dev] ${role} starting on port ${port} (pid ${child.pid}).`);

  child.on("exit", (code, signal) => {
    removeState(role, token);
    children.delete(role);
    if (!shuttingDown) {
      console.error(`[ai-office:dev] ${role} exited (${signal ? `signal ${signal}` : `code ${code}`}).`);
      shutdown(code ?? 1);
    }
  });
}

function signalChild(child, signal) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // It may already have exited between the check and signal.
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children.values()) signalChild(child, "SIGTERM");
  const timer = setTimeout(() => {
    for (const { child } of children.values()) signalChild(child, "SIGKILL");
    process.exit(exitCode);
  }, 2_000);
  timer.unref();
  if (children.size === 0) process.exit(exitCode);
  Promise.all([...children.values()].map(({ child }) => new Promise((resolveExit) => child.once("exit", resolveExit)))).then(() => {
    clearTimeout(timer);
    process.exit(exitCode);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

try {
  mkdirSync(stateDir, { recursive: true });
  const serverPreferred = desiredPort("server");
  const serverState = readState("server");
  const discoveredServerPort =
    requestedRole === "web" && serverState && isManagedProcess("server", serverState)
      ? serverState.port
      : serverPreferred;
  const serverPort = roles.includes("server") ? await selectPort("server", serverPreferred) : discoveredServerPort;
  const webPort = roles.includes("web")
    ? await selectPort("web", desiredPort("web"), new Set([serverPort]))
    : desiredPort("web");

  console.log(`[ai-office:dev] selected ports — server: ${serverPort}; web: ${webPort}.`);
  if (roles.includes("server")) launch("server", serverPort, webPort);
  if (roles.includes("web")) launch("web", serverPort, webPort);
} catch (error) {
  console.error(`[ai-office:dev] ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
}
