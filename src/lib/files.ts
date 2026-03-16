import * as fs from "node:fs";
import * as path from "node:path";
import { globSync } from "glob";
import mime from "mime-types";
import { loadIgnorePatterns } from "./ignore.js";
import { CLIError } from "./errors.js";

export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_FILE_COUNT = 1000;

export interface FileEntry {
  path: string;
  size: number;
  content_type: string;
  absolutePath: string;
}

export function buildFileManifest(
  dir: string,
  projectRoot?: string,
  ignorePatterns?: string[],
): FileEntry[] {
  const rawPatterns =
    ignorePatterns ?? loadIgnorePatterns(projectRoot ?? dir);

  // Expand each pattern so directory names also match their contents.
  // "node_modules" alone won't exclude "node_modules/pkg.js" in glob,
  // but "node_modules/**" will.
  const expandedPatterns = rawPatterns.flatMap((p) => [p, p + "/**"]);

  const files = globSync("**/*", {
    cwd: dir,
    nodir: true,
    dot: true,
    ignore: expandedPatterns,
  });

  if (files.length === 0) {
    throw new CLIError("No files found in deploy directory.");
  }

  if (files.length > MAX_FILE_COUNT) {
    throw new CLIError(
      "File count (" +
        files.length +
        ") exceeds maximum of " +
        MAX_FILE_COUNT +
        " per deploy.",
    );
  }

  const manifest: FileEntry[] = [];
  for (const relativePath of files) {
    const absolutePath = path.join(dir, relativePath);
    const stats = fs.statSync(absolutePath);

    if (stats.size > MAX_FILE_SIZE) {
      throw new CLIError(
        'File "' +
          relativePath +
          '" (' +
          formatBytes(stats.size) +
          ") exceeds maximum of " +
          formatBytes(MAX_FILE_SIZE) +
          ".",
      );
    }

    manifest.push({
      path: relativePath.split(path.sep).join("/"),
      size: stats.size,
      content_type: mime.lookup(relativePath) || "application/octet-stream",
      absolutePath,
    });
  }

  return manifest;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
