import assert from "node:assert/strict";
import test from "node:test";
import { resolveBackendEnv } from "../../src/credentials/backend-resolver.js";
import { BackendProfileError, type BackendProfileRegistry } from "../../src/credentials/backend-profile.js";

const BASE_URL_ENV = "AI_OFFICE_TEST_BACKEND_BASE_URL";
const AUTH_TOKEN_ENV = "AI_OFFICE_TEST_BACKEND_AUTH_TOKEN";

function registry(enabled?: boolean): BackendProfileRegistry {
  return {
    "test-backend": {
      id: "test-backend",
      label: "Test backend",
      ...(enabled === undefined ? {} : { enabled }),
      apiFormat: "anthropic",
      baseUrlEnvVar: BASE_URL_ENV,
      authTokenEnvVar: AUTH_TOKEN_ENV,
    },
  };
}

test("legacy profiles without an enabled field remain usable", () => {
  const previousBaseUrl = process.env[BASE_URL_ENV];
  const previousAuthToken = process.env[AUTH_TOKEN_ENV];
  process.env[BASE_URL_ENV] = "https://example.test";
  process.env[AUTH_TOKEN_ENV] = "secret";

  try {
    assert.deepEqual(resolveBackendEnv("test-backend", registry()), {
      ANTHROPIC_BASE_URL: "https://example.test",
      ANTHROPIC_AUTH_TOKEN: "secret",
    });
  } finally {
    if (previousBaseUrl === undefined) delete process.env[BASE_URL_ENV];
    else process.env[BASE_URL_ENV] = previousBaseUrl;
    if (previousAuthToken === undefined) delete process.env[AUTH_TOKEN_ENV];
    else process.env[AUTH_TOKEN_ENV] = previousAuthToken;
  }
});

test("stopped profiles fail before credentials are resolved", () => {
  assert.throws(
    () => resolveBackendEnv("test-backend", registry(false)),
    (error: unknown) =>
      error instanceof BackendProfileError &&
      error.profileId === "test-backend" &&
      error.message.includes("is stopped")
  );
});
