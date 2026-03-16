import ora, { type Ora } from "ora";

export { formatBytes } from "./files.js";

export function createSpinner(text: string): Ora {
  return ora({ text, stream: process.stderr });
}

export function formatTable(
  headers: string[],
  rows: string[][],
  emptyMessage?: string,
): string {
  if (rows.length === 0) return emptyMessage ?? "";

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join("  ");
  const separator = colWidths.map((w) => "-".repeat(w)).join("  ");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join("  "),
  );

  return [headerLine, separator, ...dataLines].join("\n");
}
