export interface Logger {
  /** Only shown when KT_LOG_LEVEL=debug. Says what KT received and why it did or didn't act on it. */
  debug(message: string): void;
  info(message: string): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}

function describe(error: unknown): string {
  if (error === undefined) return "";
  return `: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
}

export function createConsoleLogger(debug: boolean): Logger {
  return {
    debug: debug ? (message) => console.log(`[debug] ${message}`) : () => {},
    info: (message) => console.log(`[info] ${message}`),
    warn: (message, error) => console.warn(`[warn] ${message}${describe(error)}`),
    error: (message, error) => console.error(`[error] ${message}${describe(error)}`),
  };
}

export const consoleLogger: Logger = createConsoleLogger(process.env.KT_LOG_LEVEL?.toLowerCase() === "debug");

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
