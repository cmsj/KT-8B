import type { Config } from "../config.ts";
import type { Updates } from "../discord/updates.ts";
import type { Logger } from "../log.ts";
import type { Store } from "../store.ts";

export interface Context {
  config: Config;
  store: Store;
  updates: Updates;
  log: Logger;
}
