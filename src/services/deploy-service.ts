import * as fs from "node:fs";
import type { ApiClient, DeployFinalizeResponse } from "../lib/api.js";
import type { FileEntry } from "../lib/files.js";
import { CLIError } from "../lib/errors.js";

const DEFAULT_CONCURRENCY = 10;
const MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

export interface DeployOptions {
  projectName: string;
  files: FileEntry[];
  readFile: (absolutePath: string) => Buffer;
  onProgress: (completed: number, total: number) => void;
  create?: boolean;
  teamId?: string;
  concurrency?: number;
  retryDelayMs?: number;
}

export class DeployService {
  constructor(private readonly api: ApiClient) {}

  async deploy(options: DeployOptions): Promise<DeployFinalizeResponse> {
    const {
      projectName,
      files,
      readFile,
      onProgress,
      create,
      teamId,
      concurrency = DEFAULT_CONCURRENCY,
      retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    } = options;

    const manifest = files.map((f) => ({
      path: f.path,
      size: f.size,
      content_type: f.content_type,
    }));

    const initResult = await this.api.initiateDeploy(
      projectName,
      { files: manifest, team_id: teamId },
      { create },
    );

    const fileMap = new Map(files.map((f) => [f.path, f]));
    const failedFiles: string[] = [];
    let completed = 0;

    const uploadQueue = [...initResult.uploads];

    const uploadOne = async (
      filePath: string,
      presignedUrl: string,
    ): Promise<void> => {
      const file = fileMap.get(filePath);
      if (!file) return;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const body = readFile(file.absolutePath);
          await this.api.uploadFile(presignedUrl, body, file.content_type);
          completed++;
          onProgress(completed, files.length);
          return;
        } catch {
          if (attempt === MAX_RETRIES) {
            failedFiles.push(filePath);
            return;
          }
          if (retryDelayMs > 0) {
            await new Promise((r) =>
              setTimeout(r, retryDelayMs * 2 ** attempt),
            );
          }
        }
      }
    };

    let index = 0;
    const runNext = async (): Promise<void> => {
      while (index < uploadQueue.length) {
        const item = uploadQueue[index++];
        await uploadOne(item.path, item.presigned_url);
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, uploadQueue.length) },
      () => runNext(),
    );
    await Promise.all(workers);

    if (failedFiles.length > 0) {
      throw new CLIError(
        "Deploy failed: " +
          failedFiles.length +
          " file(s) could not be uploaded:\n" +
          failedFiles.map((f) => "  - " + f).join("\n") +
          "\nRe-run `kl deploy` to retry.",
      );
    }

    return this.api.finalizeDeploy(projectName, initResult.deployment_id, teamId);
  }
}

export function defaultReadFile(absolutePath: string): Buffer {
  return fs.readFileSync(absolutePath);
}
