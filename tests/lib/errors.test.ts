import { describe, it, expect } from "vitest";
import { CLIError, ApiError, NetworkError, AuthError } from "../../src/lib/errors.js";

describe("CLIError", () => {
  it("has message and exitCode", () => {
    const err = new CLIError("something broke", 1);
    expect(err.message).toBe("something broke");
    expect(err.exitCode).toBe(1);
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults exitCode to 1", () => {
    const err = new CLIError("fail");
    expect(err.exitCode).toBe(1);
  });
});

describe("ApiError", () => {
  it("captures status and detail", () => {
    const err = new ApiError(404, "Not found");
    expect(err.status).toBe(404);
    expect(err.detail).toBe("Not found");
    expect(err.message).toBe("API error 404: Not found");
    expect(err).toBeInstanceOf(CLIError);
  });

  it("handles 429 rate limit", () => {
    const err = new ApiError(429, "Too many requests");
    expect(err.message).toBe("Rate limited. Wait a moment and try again.");
  });
});

describe("NetworkError", () => {
  it("includes API URL in message", () => {
    const err = new NetworkError("https://api.kingslanding.io");
    expect(err.message).toContain("https://api.kingslanding.io");
    expect(err).toBeInstanceOf(CLIError);
  });
});

describe("AuthError", () => {
  it("suggests kl login", () => {
    const err = new AuthError();
    expect(err.message).toContain("kl login");
    expect(err).toBeInstanceOf(CLIError);
  });
});
