import type { Artifact, Run } from "./types";

/** API form of a run: artifact files are downloaded by name, so server filesystem paths never leave the server. */
export function publicRun(run: Run): Omit<Run, "artifacts"> & { artifacts: Omit<Artifact, "path">[] } {
  return { ...run, artifacts: run.artifacts.map(({ name, sha256, version, reviewVersion, kind }) => ({ name, sha256, version, reviewVersion, kind })) };
}
