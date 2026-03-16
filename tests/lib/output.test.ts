import { describe, it, expect } from "vitest";
import { formatTable } from "../../src/lib/output.js";

describe("formatTable", () => {
  it("formats rows with headers", () => {
    const headers = ["NAME", "SIZE"];
    const rows = [
      ["my-site", "2.3 MB"],
      ["blog", "500 KB"],
    ];
    const output = formatTable(headers, rows);
    expect(output).toContain("NAME");
    expect(output).toContain("my-site");
    expect(output).toContain("blog");
  });

  it("returns message for empty rows", () => {
    const output = formatTable(["NAME"], [], "No items found.");
    expect(output).toBe("No items found.");
  });
});
