import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getVersion } from "../../src/lib/version.js";

describe("getVersion", () => {
  it("returns the version declared in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    expect(getVersion()).toBe(pkg.version);
  });

  it("returns a semver-shaped string", () => {
    expect(getVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
