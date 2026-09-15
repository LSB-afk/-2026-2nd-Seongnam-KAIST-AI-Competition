import { resolve } from "node:path";
import { RunStore } from "./store";
import { RunService } from "./service";
import { runAgent } from "./agent";
import { getLiveConfig } from "./provider";
import { searchSources } from "./sources";
import { renderCards } from "./render";
import { checkArtifacts } from "./artifacts";
import { defaultCardImage, defaultPlaceImage, getStoredImage } from "./images";
import { buildImagePrompt, generateImage, getImageConfig } from "./image-provider";
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
      render: async (run,signal) => {
        if (run.cards.some(card=>!card.image)) {
          for (const card of run.cards) if (!card.image) {
            const photo = await defaultCardImage(run, card.id);
            signal.throwIfAborted();
            if (photo) card.image = photo;
          }
          const revision = run.revisions.find(item=>item.version===run.version);
          if (revision) revision.cards = structuredClone(run.cards);
        }
        return renderCards(run,signal);
      },
      checkArtifacts,
      liveAvailable: () => getLiveConfig().configured,
      image: {configured:()=>getImageConfig().configured,defaultImage:defaultPlaceImage,getAsset:getStoredImage,buildPrompt:buildImagePrompt,generate:generateImage},
    });
  }
  return globals.timestoryService;
}
