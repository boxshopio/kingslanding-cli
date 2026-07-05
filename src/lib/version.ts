import { readFileSync } from "node:fs";

/**
 * Returns the CLI version, read from the package manifest at runtime.
 *
 * The manifest sits at the package root, one level above the compiled
 * `dist/lib/` (and the `src/lib/` sources), so the same relative path
 * resolves in both the built CLI and the test suite.
 */
export function getVersion(): string {
  const manifestUrl = new URL("../../package.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as { version: string };
  return manifest.version;
}
