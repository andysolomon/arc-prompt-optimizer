import { describe, expect, it } from "vitest";
import { clerkEnabled, readClerkKeys, SIGN_IN_PATH } from "../../lib/clerk-config";

describe("readClerkKeys", () => {
  it("reads and trims both keys, dropping blanks", () => {
    expect(readClerkKeys({})).toEqual({ publishableKey: undefined, secretKey: undefined });
    expect(readClerkKeys({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: " pk_test_abc ", CLERK_SECRET_KEY: "" })).toEqual({ publishableKey: "pk_test_abc", secretKey: undefined });
    expect(readClerkKeys({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_abc", CLERK_SECRET_KEY: "sk_test_def" })).toEqual({ publishableKey: "pk_test_abc", secretKey: "sk_test_def" });
  });
});

describe("clerkEnabled", () => {
  it("requires both the publishable and the secret key", () => {
    expect(clerkEnabled({})).toBe(false);
    expect(clerkEnabled({ publishableKey: "pk_test_abc" })).toBe(false);
    expect(clerkEnabled({ secretKey: "sk_test_def" })).toBe(false);
    expect(clerkEnabled({ publishableKey: "pk_test_abc", secretKey: "sk_test_def" })).toBe(true);
  });

  it("uses a fixed sign-in path", () => {
    expect(SIGN_IN_PATH).toBe("/sign-in");
  });
});
