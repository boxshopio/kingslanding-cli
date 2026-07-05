import { describe, it, expect } from "vitest";
import { renderQrCode } from "../../src/lib/qr.js";

describe("renderQrCode", () => {
  it("returns a non-empty rendered QR string for a URL", () => {
    const out = renderQrCode("https://kingslanding.io/device?user_code=BFGH-JKLM");
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});
