import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let resolveApiUrl: typeof import("../../src/lib/config.js").resolveApiUrl;
let loadProjectConfig: typeof import("../../src/lib/config.js").loadProjectConfig;
let writeProjectConfig: typeof import("../../src/lib/config.js").writeProjectConfig;
let isLocalMode: typeof import("../../src/lib/config.js").isLocalMode;
let siteUrl: typeof import("../../src/lib/config.js").siteUrl;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import("../../src/lib/config.js");
  resolveApiUrl = mod.resolveApiUrl;
  loadProjectConfig = mod.loadProjectConfig;
  writeProjectConfig = mod.writeProjectConfig;
  isLocalMode = mod.isLocalMode;
  siteUrl = mod.siteUrl;
});

describe("resolveApiUrl", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.KL_API_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns KL_API_URL env var when set", () => {
    process.env.KL_API_URL = "https://api.kl.test";
    expect(resolveApiUrl()).toBe("https://api.kl.test");
  });

  it("falls back to prod default when nothing is set", () => {
    expect(resolveApiUrl()).toBe("https://api.kingslanding.io");
  });

  it("uses kl.json api_url when present", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-config-test-"));
    const klJson = path.join(tmpDir, "kl.json");
    fs.writeFileSync(klJson, JSON.stringify({ project: "test", api_url: "https://custom.api" }));
    expect(resolveApiUrl(tmpDir)).toBe("https://custom.api");
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("env var takes precedence over kl.json", () => {
    process.env.KL_API_URL = "https://env-override";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-config-test-"));
    const klJson = path.join(tmpDir, "kl.json");
    fs.writeFileSync(klJson, JSON.stringify({ project: "test", api_url: "https://custom.api" }));
    expect(resolveApiUrl(tmpDir)).toBe("https://env-override");
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe("loadProjectConfig", () => {
  it("returns config without team field", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-config-test-"));
    const klJson = path.join(tmpDir, "kl.json");
    fs.writeFileSync(klJson, JSON.stringify({ project: "my-site", directory: "dist" }));
    const config = loadProjectConfig(tmpDir);
    expect(config).toEqual({ project: "my-site", directory: "dist" });
    expect(config).not.toHaveProperty("team");
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("logs deprecation warning when team field is present", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-config-test-"));
    const klJson = path.join(tmpDir, "kl.json");
    fs.writeFileSync(klJson, JSON.stringify({ project: "my-site", directory: "dist", team: "frontend" }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadProjectConfig(tmpDir);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("deprecated"));
    warnSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns null when kl.json does not exist", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-config-test-"));
    expect(loadProjectConfig(tmpDir)).toBeNull();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("defaults directory to . when not specified", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-config-test-"));
    fs.writeFileSync(path.join(tmpDir, "kl.json"), JSON.stringify({ project: "test" }));
    const config = loadProjectConfig(tmpDir);
    expect(config?.directory).toBe(".");
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe("writeProjectConfig", () => {
  it("writes kl.json without team field", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-config-write-"));
    writeProjectConfig(tmpDir, { project: "my-site", directory: "dist" });
    const written = JSON.parse(fs.readFileSync(path.join(tmpDir, "kl.json"), "utf-8"));
    expect(written.project).toBe("my-site");
    expect(written.directory).toBe("dist");
    expect(written).not.toHaveProperty("team");
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe("isLocalMode", () => {
  it("returns true for local API URL", () => {
    expect(isLocalMode("https://api.kl.test")).toBe(true);
  });

  it("returns false for prod API URL", () => {
    expect(isLocalMode("https://api.kingslanding.io")).toBe(false);
  });
});

describe("siteUrl", () => {
  it("derives site URL from prod API URL", () => {
    expect(siteUrl("my-site", "https://api.kingslanding.io")).toBe("https://my-site.kingslanding.io");
  });

  it("derives site URL from dev API URL", () => {
    expect(siteUrl("my-site", "https://api.dev.kingslanding.io")).toBe("https://my-site.dev.kingslanding.io");
  });

  it("derives site URL from local API URL", () => {
    expect(siteUrl("my-site", "https://api.kl.test")).toBe("https://my-site.kl.test");
  });

  it("handles custom API URLs", () => {
    expect(siteUrl("proj", "https://api.staging.example.com")).toBe("https://proj.staging.example.com");
  });
});
