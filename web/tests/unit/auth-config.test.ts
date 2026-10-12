import { describe, expect, it } from "vitest";
import { accountId, authEnabled, configuredAuthProviders, isAuthProviderId, safeCallbackPath, signInErrorMessage } from "../../lib/auth-config";
import { readServerEnv } from "../../lib/env";

const BASE = { NODE_ENV: "test", AUTH_SECRET: "test-secret" } as const;
const env = (values: Record<string, string>) => readServerEnv({ NODE_ENV: "test", ...values });

describe("configuredAuthProviders", () => {
  it("lists only providers with both a client id and a secret, Google first", () => {
    expect(configuredAuthProviders(env({ ...BASE }))).toEqual([]);
    expect(configuredAuthProviders(env({ ...BASE, AUTH_GOOGLE_ID: "g" }))).toEqual([]);
    expect(configuredAuthProviders(env({ ...BASE, AUTH_TWITTER_ID: "x", AUTH_TWITTER_SECRET: "xs" })).map((p) => p.id)).toEqual(["twitter"]);
    const both = configuredAuthProviders(env({ ...BASE, AUTH_TWITTER_ID: "x", AUTH_TWITTER_SECRET: "xs", AUTH_GOOGLE_ID: "g", AUTH_GOOGLE_SECRET: "gs" }));
    expect(both.map((p) => [p.id, p.name])).toEqual([["google", "Google"], ["twitter", "X"]]);
    expect(both[0]).toMatchObject({ clientId: "g", clientSecret: "gs" });
  });

  it("ignores blank credentials", () => {
    expect(configuredAuthProviders(env({ ...BASE, AUTH_GOOGLE_ID: "  ", AUTH_GOOGLE_SECRET: "gs" }))).toEqual([]);
  });
});

describe("authEnabled", () => {
  it("requires a secret and at least one provider", () => {
    expect(authEnabled(env({}))).toBe(false);
    expect(authEnabled(env({ AUTH_GOOGLE_ID: "g", AUTH_GOOGLE_SECRET: "gs" }))).toBe(false);
    expect(authEnabled(env({ ...BASE }))).toBe(false);
    expect(authEnabled(env({ ...BASE, AUTH_GOOGLE_ID: "g", AUTH_GOOGLE_SECRET: "gs" }))).toBe(true);
  });
});

describe("accountId / isAuthProviderId", () => {
  it("scopes the provider account id by provider", () => {
    expect(accountId("google", "123")).toBe("google:123");
    expect(isAuthProviderId("google")).toBe(true);
    expect(isAuthProviderId("twitter")).toBe(true);
    expect(isAuthProviderId("github")).toBe(false);
    expect(isAuthProviderId(undefined)).toBe(false);
  });
});

describe("safeCallbackPath", () => {
  it("accepts same-site absolute paths", () => {
    expect(safeCallbackPath("/library")).toBe("/library");
    expect(safeCallbackPath("/?example=few_shot")).toBe("/?example=few_shot");
    expect(safeCallbackPath(["/account", "/other"])).toBe("/account");
  });

  it("falls back for anything that could leave the site", () => {
    for (const bad of [undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "library", "/a b", "/a\nb", `/${"x".repeat(3000)}`]) {
      expect(safeCallbackPath(bad)).toBe("/");
    }
    expect(safeCallbackPath(undefined, "/account")).toBe("/account");
  });
});

describe("signInErrorMessage", () => {
  it("maps Auth.js error codes to user-facing text and ignores a missing code", () => {
    expect(signInErrorMessage(undefined)).toBeNull();
    expect(signInErrorMessage("")).toBeNull();
    expect(signInErrorMessage("AccessDenied")).toMatch(/denied/u);
    expect(signInErrorMessage("Configuration")).toMatch(/misconfigured/u);
    expect(signInErrorMessage(["OAuthCallbackError"])).toMatch(/could not be completed/u);
    expect(signInErrorMessage("SomethingNew")).toBe("Sign-in failed. Try again.");
  });
});
