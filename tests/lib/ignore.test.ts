import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadIgnorePatterns,
  DEFAULT_IGNORE_PATTERNS,
} from "../../src/lib/ignore.js";

describe("loadIgnorePatterns", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-ignore-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns default patterns when no .klignore exists", () => {
    const patterns = loadIgnorePatterns(tmpDir);
    expect(patterns).toEqual(DEFAULT_IGNORE_PATTERNS);
  });

  it("returns custom patterns from .klignore, replacing defaults", () => {
    fs.writeFileSync(path.join(tmpDir, ".klignore"), "build\n*.log\n");
    const patterns = loadIgnorePatterns(tmpDir);
    expect(patterns).toEqual(["build", "*.log"]);
    expect(patterns).not.toContain("node_modules");
  });

  it("ignores blank lines and comments", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".klignore"),
      "# comment\n\nbuild\n  \n*.log\n",
    );
    const patterns = loadIgnorePatterns(tmpDir);
    expect(patterns).toEqual(["build", "*.log"]);
  });
});

describe("DEFAULT_IGNORE_PATTERNS", () => {
  it("includes node_modules, .git, .env*, .DS_Store, .kl", () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain("node_modules");
    expect(DEFAULT_IGNORE_PATTERNS).toContain(".git");
    expect(DEFAULT_IGNORE_PATTERNS).toContain(".env*");
    expect(DEFAULT_IGNORE_PATTERNS).toContain(".DS_Store");
    expect(DEFAULT_IGNORE_PATTERNS).toContain(".kl");
  });
});
