import * as fs from "node:fs";
import * as path from "node:path";

export const DEFAULT_IGNORE_PATTERNS: string[] = [
  "node_modules",
  ".git",
  ".env*",
  ".DS_Store",
  ".kl",
];

export function loadIgnorePatterns(cwd: string): string[] {
  const ignorePath = path.join(cwd, ".klignore");
  if (!fs.existsSync(ignorePath)) return [...DEFAULT_IGNORE_PATTERNS];

  const content = fs.readFileSync(ignorePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
