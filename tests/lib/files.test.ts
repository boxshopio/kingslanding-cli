import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  buildFileManifest,
  MAX_FILE_SIZE,
  formatBytes,
} from "../../src/lib/files.js";

describe("buildFileManifest", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-files-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("collects files with relative paths, sizes, and content types", () => {
    fs.writeFileSync(path.join(tmpDir, "index.html"), "<h1>Hello</h1>");
    fs.mkdirSync(path.join(tmpDir, "assets"));
    fs.writeFileSync(
      path.join(tmpDir, "assets", "style.css"),
      "body { color: red; }",
    );

    const manifest = buildFileManifest(tmpDir);
    expect(manifest).toHaveLength(2);

    const html = manifest.find((f) => f.path === "index.html");
    expect(html).toBeDefined();
    expect(html!.content_type).toBe("text/html");
    expect(html!.size).toBeGreaterThan(0);

    const css = manifest.find((f) => f.path === "assets/style.css");
    expect(css).toBeDefined();
    expect(css!.content_type).toBe("text/css");
  });

  it("respects ignore patterns", () => {
    fs.writeFileSync(path.join(tmpDir, "index.html"), "<h1>Hello</h1>");
    fs.mkdirSync(path.join(tmpDir, "node_modules"));
    fs.writeFileSync(
      path.join(tmpDir, "node_modules", "pkg.js"),
      "module.exports = 1",
    );
    fs.writeFileSync(path.join(tmpDir, ".env"), "SECRET=123");

    const manifest = buildFileManifest(tmpDir);
    const paths = manifest.map((f) => f.path);
    expect(paths).toContain("index.html");
    expect(paths).not.toContain("node_modules/pkg.js");
    expect(paths).not.toContain(".env");
  });

  it("throws on empty directory", () => {
    expect(() => buildFileManifest(tmpDir)).toThrow("No files found");
  });

  it("throws when file exceeds max size", () => {
    const bigFile = path.join(tmpDir, "big.bin");
    const fd = fs.openSync(bigFile, "w");
    fs.ftruncateSync(fd, MAX_FILE_SIZE + 1);
    fs.closeSync(fd);
    expect(() => buildFileManifest(tmpDir)).toThrow("exceeds maximum");
  });

  it("uses application/octet-stream for unknown extensions", () => {
    fs.writeFileSync(path.join(tmpDir, "data.qzx"), "binary data");
    const manifest = buildFileManifest(tmpDir);
    expect(manifest[0].content_type).toBe("application/octet-stream");
  });

  it("uses forward slashes in paths on all platforms", () => {
    fs.mkdirSync(path.join(tmpDir, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "a", "b", "c.txt"), "x");
    const manifest = buildFileManifest(tmpDir);
    expect(manifest[0].path).toBe("a/b/c.txt");
  });
});

describe("formatBytes", () => {
  it("formats bytes", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(4200)).toBe("4.1 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(2_400_000)).toBe("2.3 MB");
  });
});
