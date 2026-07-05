import { describe, it, expect } from "vitest";
import {
  resolveVerificationTarget,
  isHeadlessSession,
  resolveLoginDisplay,
  resolveLoginPreferences,
  formatLoginMessage,
} from "../../src/commands/login.js";

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

describe("isHeadlessSession", () => {
  it("is headless over SSH", () => {
    expect(isHeadlessSession({ SSH_CONNECTION: "10.0.0.1 22" }, "darwin")).toBe(true);
    expect(isHeadlessSession({ SSH_TTY: "/dev/pts/0" }, "linux")).toBe(true);
  });

  it("is headless on Linux with no display server", () => {
    expect(isHeadlessSession({}, "linux")).toBe(true);
  });

  it("is not headless on Linux with a display", () => {
    expect(isHeadlessSession({ DISPLAY: ":0" }, "linux")).toBe(false);
    expect(isHeadlessSession({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(false);
  });

  it("is not headless on a local macOS desktop", () => {
    expect(isHeadlessSession({}, "darwin")).toBe(false);
  });
});

describe("resolveLoginDisplay", () => {
  it("opens the browser and hides the QR on a normal desktop", () => {
    expect(resolveLoginDisplay({ noBrowser: false, qr: false, headless: false })).toEqual({
      openBrowser: true,
      showQr: false,
    });
  });

  it("forces the QR on with --qr even when the browser opens", () => {
    expect(resolveLoginDisplay({ noBrowser: false, qr: true, headless: false })).toEqual({
      openBrowser: true,
      showQr: true,
    });
  });

  it("skips the browser and shows the QR with --no-browser", () => {
    expect(resolveLoginDisplay({ noBrowser: true, qr: false, headless: false })).toEqual({
      openBrowser: false,
      showQr: true,
    });
  });

  it("skips the browser and shows the QR when headless", () => {
    expect(resolveLoginDisplay({ noBrowser: false, qr: false, headless: true })).toEqual({
      openBrowser: false,
      showQr: true,
    });
  });
});

describe("resolveLoginPreferences", () => {
  it("defaults to browser on, qr off with no flags or config", () => {
    expect(resolveLoginPreferences({ browserFlag: true, qrFlag: false }, {})).toEqual({
      noBrowser: false,
      qr: false,
    });
  });

  it("honors the --no-browser flag", () => {
    expect(resolveLoginPreferences({ browserFlag: false, qrFlag: false }, {})).toEqual({
      noBrowser: true,
      qr: false,
    });
  });

  it("honors the --qr flag", () => {
    expect(resolveLoginPreferences({ browserFlag: true, qrFlag: true }, {})).toEqual({
      noBrowser: false,
      qr: true,
    });
  });

  it("honors persisted config (browser:false, qr:true)", () => {
    expect(
      resolveLoginPreferences({ browserFlag: true, qrFlag: false }, { browser: false, qr: true }),
    ).toEqual({ noBrowser: true, qr: true });
  });

  it("lets the --qr flag turn the QR on even when config sets qr:false", () => {
    expect(resolveLoginPreferences({ browserFlag: true, qrFlag: true }, { qr: false })).toEqual({
      noBrowser: false,
      qr: true,
    });
  });
});

describe("formatLoginMessage", () => {
  it("uses automatic framing with the code only in the URL when the browser opens", () => {
    const msg = formatLoginMessage({
      userCode: "BKMM-QGCB",
      target: "https://kl.io/device?user_code=BKMM-QGCB",
      openBrowser: true,
      qr: null,
    });
    expect(msg).toContain("Opening your browser");
    expect(msg).toContain("https://kl.io/device?user_code=BKMM-QGCB");
    // The code is visible in the URL — no redundant "pre-filled" line.
    expect(msg).not.toContain("pre-filled");
    expect(msg).not.toContain("Or scan");
  });

  it("uses manual framing with a labeled QR when the browser does not open", () => {
    const msg = formatLoginMessage({
      userCode: "BKMM-QGCB",
      target: "https://kl.io/device?user_code=BKMM-QGCB",
      openBrowser: false,
      qr: "QRDATA",
    });
    expect(msg).toContain("To authorize this device");
    expect(msg).toContain("Or scan with your phone");
    expect(msg).toContain("QRDATA");
    expect(msg).toContain("Verification code: BKMM-QGCB");
  });

  it("shows the QR alongside the browser message when forced with --qr", () => {
    const msg = formatLoginMessage({
      userCode: "BKMM-QGCB",
      target: "https://kl.io/device?user_code=BKMM-QGCB",
      openBrowser: true,
      qr: "QRDATA",
    });
    expect(msg).toContain("Opening your browser");
    expect(msg).toContain("Or scan with your phone");
    expect(msg).toContain("QRDATA");
  });
});
