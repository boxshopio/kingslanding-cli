import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let resolveApiUrl: typeof import("../../src/lib/config.js").resolveApiUrl;
let resolveNamedEnv: typeof import("../../src/lib/config.js").resolveNamedEnv;
let loadProjectConfig: typeof import("../../src/lib/config.js").loadProjectConfig;
let writeProjectConfig: typeof import("../../src/lib/config.js").writeProjectConfig;
let isLocalMode: typeof import("../../src/lib/config.js").isLocalMode;
let siteUrl: typeof import("../../src/lib/config.js").siteUrl;
let loadGlobalConfig: typeof import("../../src/lib/config.js").loadGlobalConfig;
let resolveKlDir: typeof import("../../src/lib/config.js").resolveKlDir;
let migrateLegacyConfigDir: typeof import("../../src/lib/config.js").migrateLegacyConfigDir;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import("../../src/lib/config.js");
  resolveApiUrl = mod.resolveApiUrl;
  resolveNamedEnv = mod.resolveNamedEnv;
  loadProjectConfig = mod.loadProjectConfig;
  writeProjectConfig = mod.writeProjectConfig;
  isLocalMode = mod.isLocalMode;
  siteUrl = mod.siteUrl;
  loadGlobalConfig = mod.loadGlobalConfig;
  resolveKlDir = mod.resolveKlDir;
  migrateLegacyConfigDir = mod.migrateLegacyConfigDir;
});

describe("loadGlobalConfig", () => {
  it("returns an empty object when no config file exists", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-gc-"));
    expect(loadGlobalConfig(tmpDir)).toEqual({});
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("parses persisted login preferences", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-gc-"));
    fs.writeFileSync(
      path.join(tmpDir, "config.json"),
      JSON.stringify({ login: { qr: true, browser: false } }),
    );
    expect(loadGlobalConfig(tmpDir).login).toEqual({ qr: true, browser: false });
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns an empty object on malformed JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-gc-"));
    fs.writeFileSync(path.join(tmpDir, "config.json"), "{ not valid json");
    expect(loadGlobalConfig(tmpDir)).toEqual({});
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe("resolveKlDir", () => {
  it("defaults to ~/.config/kl when XDG_CONFIG_HOME is unset", () => {
    expect(resolveKlDir({})).toBe(path.join(os.homedir(), ".config", "kl"));
  });

  it("honors an absolute XDG_CONFIG_HOME", () => {
    expect(resolveKlDir({ XDG_CONFIG_HOME: "/custom/cfg" })).toBe(path.join("/custom/cfg", "kl"));
  });

  it("ignores a relative XDG_CONFIG_HOME per the XDG spec", () => {
    expect(resolveKlDir({ XDG_CONFIG_HOME: "relative/path" })).toBe(
      path.join(os.homedir(), ".config", "kl"),
    );
  });
});

describe("migrateLegacyConfigDir", () => {
  it("moves the legacy dir to the new location, preserving file modes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kl-mig-"));
    const legacy = path.join(root, ".kl");
    const next = path.join(root, ".config", "kl");
    fs.mkdirSync(legacy, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(legacy, "credentials.json"), "{}", { mode: 0o600 });
    fs.writeFileSync(path.join(legacy, "config.json"), "{}");

    migrateLegacyConfigDir(legacy, next);

    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(path.join(next, "config.json"), "utf-8")).toBe("{}");
    expect(fs.statSync(path.join(next, "credentials.json")).mode & 0o777).toBe(0o600);
    fs.rmSync(root, { recursive: true });
  });

  it("does not clobber an existing new dir", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kl-mig-"));
    const legacy = path.join(root, ".kl");
    const next = path.join(root, ".config", "kl");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "config.json"), "legacy");
    fs.mkdirSync(next, { recursive: true });
    fs.writeFileSync(path.join(next, "config.json"), "existing");

    migrateLegacyConfigDir(legacy, next);

    expect(fs.readFileSync(path.join(next, "config.json"), "utf-8")).toBe("existing");
    expect(fs.existsSync(legacy)).toBe(true);
    fs.rmSync(root, { recursive: true });
  });

  it("is a no-op when the legacy dir does not exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kl-mig-"));
    const legacy = path.join(root, ".kl");
    const next = path.join(root, ".config", "kl");
    migrateLegacyConfigDir(legacy, next);
    expect(fs.existsSync(next)).toBe(false);
    fs.rmSync(root, { recursive: true });
  });
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

  it("resolves a built-in named env via the envName argument", () => {
    expect(resolveApiUrl(undefined, "local")).toBe("https://api.kl.test");
    expect(resolveApiUrl(undefined, "prod")).toBe("https://api.kingslanding.io");
  });

  it("named env beats KL_API_URL", () => {
    process.env.KL_API_URL = "https://env-override";
    expect(resolveApiUrl(undefined, "local")).toBe("https://api.kl.test");
  });

  it("named env beats kl.json api_url", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-env-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "kl.json"),
      JSON.stringify({ project: "test", api_url: "https://custom.api" }),
    );
    expect(resolveApiUrl(tmpDir, "local")).toBe("https://api.kl.test");
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("throws for an unknown named env", () => {
    expect(() => resolveApiUrl(undefined, "stg")).toThrowError(/Unknown environment 'stg'/);
  });

  it("ignores an undefined envName and uses the normal chain", () => {
    process.env.KL_API_URL = "https://api.kl.test";
    expect(resolveApiUrl(undefined, undefined)).toBe("https://api.kl.test");
  });
});

describe("resolveNamedEnv", () => {
  it("resolves the built-in prod env with no user config", () => {
    expect(resolveNamedEnv("prod")).toBe("https://api.kingslanding.io");
  });

  it("resolves the built-in local env with no user config", () => {
    expect(resolveNamedEnv("local")).toBe("https://api.kl.test");
  });

  it("resolves a user-defined env", () => {
    expect(resolveNamedEnv("dev", { dev: "https://api.dev.kingslanding.io" })).toBe(
      "https://api.dev.kingslanding.io",
    );
  });

  it("lets a user env override a built-in of the same name", () => {
    expect(resolveNamedEnv("prod", { prod: "https://api.internal.test" })).toBe(
      "https://api.internal.test",
    );
  });

  it("throws a CLIError listing known envs for an unknown name", () => {
    expect(() => resolveNamedEnv("stg")).toThrowError(/Unknown environment 'stg'/);
    expect(() => resolveNamedEnv("stg")).toThrowError(/local, prod/);
  });

  it("includes user envs in the known-list of the error", () => {
    expect(() => resolveNamedEnv("stg", { dev: "https://api.dev.kingslanding.io" })).toThrowError(
      /dev, local, prod/,
    );
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
    fs.writeFileSync(
      klJson,
      JSON.stringify({ project: "my-site", directory: "dist", team: "frontend" }),
    );
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
    expect(siteUrl("my-site", "https://api.kingslanding.io")).toBe(
      "https://my-site.kingslanding.io",
    );
  });

  it("derives site URL from dev API URL", () => {
    expect(siteUrl("my-site", "https://api.dev.kingslanding.io")).toBe(
      "https://my-site.dev.kingslanding.io",
    );
  });

  it("derives site URL from local API URL", () => {
    expect(siteUrl("my-site", "https://api.kl.test")).toBe("https://my-site.kl.test");
  });

  it("handles custom API URLs", () => {
    expect(siteUrl("proj", "https://api.staging.example.com")).toBe(
      "https://proj.staging.example.com",
    );
  });
});
