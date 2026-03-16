export class CLIError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1,
  ) {
    super(message);
    this.name = "CLIError";
  }
}

export class ApiError extends CLIError {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    const message =
      status === 429
        ? "Rate limited. Wait a moment and try again."
        : `API error ${status}: ${detail}`;
    super(message, 1);
    this.name = "ApiError";
  }
}

export class NetworkError extends CLIError {
  constructor(apiUrl: string) {
    super(`Could not reach the API at ${apiUrl}. Check your connection.`, 1);
    this.name = "NetworkError";
  }
}

export class AuthError extends CLIError {
  constructor(message?: string) {
    super(message ?? "Session expired. Run `kl login` to re-authenticate.", 1);
    this.name = "AuthError";
  }
}
