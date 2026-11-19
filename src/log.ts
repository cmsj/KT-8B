export interface Logger {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}

function describe(error: unknown): string {
  if (error === undefined) return "";
  return `: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
}

export const consoleLogger: Logger = {
  info: (message) => console.log(`[info] ${message}`),
  warn: (message, error) => console.warn(`[warn] ${message}${describe(error)}`),
  error: (message, error) => console.error(`[error] ${message}${describe(error)}`),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
