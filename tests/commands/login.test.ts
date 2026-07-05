import { describe, it, expect } from "vitest";
import { resolveVerificationTarget } from "../../src/commands/login.js";

describe("resolveVerificationTarget", () => {
  it("prefers the complete URL when present", () => {
    expect(
      resolveVerificationTarget("https://kl.io/device", "https://kl.io/device?user_code=BFGH-JKLM"),
    ).toBe("https://kl.io/device?user_code=BFGH-JKLM");
  });

  it("falls back to the plain verification URI when complete is absent", () => {
    expect(resolveVerificationTarget("https://kl.io/device", undefined)).toBe(
      "https://kl.io/device",
    );
  });
});
