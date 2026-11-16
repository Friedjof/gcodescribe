import {
  readSetupProgress,
  writeSetupProgress,
  type SetupProgress,
} from "./setupProgress";

/** One local setup record per project, shared by the setup tasks. */
export class SetupProgressStore {
  private cache = new Map<string, SetupProgress>();
  private listeners = new Set<() => void>();
  constructor(private storage?: Pick<Storage, "getItem" | "setItem">) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get = (projectId: string, profileId: string): SetupProgress => {
    const key = JSON.stringify([projectId, profileId]);
    if (!this.cache.has(key))
      this.cache.set(
        key,
        readSetupProgress(projectId, profileId, this.storage),
      );
    return this.cache.get(key)!;
  };
  update = (
    projectId: string,
    profileId: string,
    change: (value: SetupProgress) => SetupProgress,
  ) => {
    const next = change(this.get(projectId, profileId));
    this.cache.set(JSON.stringify([projectId, profileId]), next);
    writeSetupProgress(projectId, next, this.storage);
    this.listeners.forEach((listener) => listener());
  };
  confirmProject = (projectId: string, profileId: string) =>
    this.update(projectId, profileId, (value) => ({
      ...value,
      confirmed: true,
    }));
  reload = () => {
    this.cache.clear();
    this.listeners.forEach((listener) => listener());
  };
}
