import { resolve } from "node:path";
import { RunStore } from "./store";
import { RunService } from "./service";
import { runAgent } from "./agent";
import { getLiveConfig } from "./provider";
import { searchSources } from "./sources";
import { renderCards } from "./render";
import { checkArtifacts } from "./artifacts";
const globals = globalThis as typeof globalThis & {
  timestoryService?: RunService;
};
export function getService(): RunService {
  if (!globals.timestoryService) {
    const store = new RunStore(
      resolve(process.env.TIMESTORY_DB_PATH ?? "data/timestory.sqlite"),
    );
    store.recoverInterrupted();
    globals.timestoryService = new RunService(store, {
      runner: runAgent,
      search: searchSources,
      render: renderCards,
      checkArtifacts,
      liveAvailable: () => getLiveConfig().configured,
    });
  }
  return globals.timestoryService;
}
