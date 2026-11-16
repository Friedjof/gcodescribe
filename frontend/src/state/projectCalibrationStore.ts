import type { CalibrationProfile, PageIndex, PaperState } from "../api/types";
import { paperRect } from "../lib/paperGeometry";
import { errorMessage, isAbortError } from "../api/errors";

interface ProjectApi {
  listPages(signal?: AbortSignal): Promise<PageIndex>;
  getProfile(id: string, signal?: AbortSignal): Promise<CalibrationProfile>;
}

export interface ProjectCalibrationSnapshot {
  index: PageIndex | null;
  profile: CalibrationProfile | null;
  paper: PaperState | null;
  loading: boolean;
  error: string | null;
  profileRevision: number;
  agentRevision: number;
}

const contextKey = (index: PageIndex): string => JSON.stringify([
  index.project?.id, index.project?.profileId,
  index.activeProfile?.fingerprint, index.activeProfile?.name,
]);

/** One project snapshot per app session; no component owns a second poll loop. */
export class ProjectCalibrationStore {
  private snapshot: ProjectCalibrationSnapshot = {
    index: null, profile: null, paper: null, loading: false, error: null, profileRevision: 0, agentRevision: 0,
  };
  private listeners = new Set<() => void>();
  private sequence = 0;
  private controller: AbortController | null = null;
  private flight: Promise<PageIndex> | null = null;
  private loadedKey: string | null = null;
  private active = false;

  constructor(private api: ProjectApi) {}
  getSnapshot = (): ProjectCalibrationSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<ProjectCalibrationSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }

  setActive(active: boolean) {
    this.active = active;
    if (!active) this.cancel();
  }

  cancel = () => {
    this.sequence++;
    this.controller?.abort();
    this.controller = null;
    this.flight = null;
  };

  private async accept(index: PageIndex, sequence: number, signal: AbortSignal, force: boolean) {
    this.check(sequence);
    const key = contextKey(index);
    const previous = this.snapshot.profile;
    const sameIndex = JSON.stringify(index) === JSON.stringify(this.snapshot.index);
    if (this.loadedKey === key && this.snapshot.profile && this.snapshot.paper && !force) {
      if (!sameIndex || this.snapshot.error || this.snapshot.loading)
        this.publish({ index, error: null, loading: false });
      return;
    }
    // Invalidate the previous profile before loading a different project. Never
    // pair a new project ID with the previous project's machine dimensions.
    this.loadedKey = null;
    const retain = this.snapshot.index && contextKey(this.snapshot.index) === key;
    this.publish({ index, ...(!retain ? { profile: null, paper: null } : {}), loading: true, error: null });
    if (!index.project) throw new Error("Kein aktives Projekt vorhanden.");
    const profile = await this.api.getProfile(index.project.profileId, signal);
    this.check(sequence);
    if (profile.id !== index.project.profileId) throw new Error("Das Projektprofil hat sich geändert. Bitte erneut laden.");
    if (index.activeProfile?.fingerprint && profile.fingerprint
        && index.activeProfile.fingerprint !== profile.fingerprint)
      throw new Error("Das Projektprofil wurde während des Ladens geändert. Bitte erneut laden.");
    // A single profile response owns both settings and preview geometry. Older
    // /paper responses can materialize automatic positions as explicit overrides.
    // Mixing those representations falsely reports a concurrent calibration edit.
    const paper: PaperState = { calibration: profile.calibration, rect: paperRect(profile.calibration) };
    this.loadedKey = key;
    const changed = previous && (previous.id !== profile.id || previous.fingerprint !== profile.fingerprint || previous.name !== profile.name);
    this.publish({ profile, paper, loading: false, error: null,
      profileRevision: this.snapshot.profileRevision + (changed ? 1 : 0) });
  }

  private check(sequence: number) {
    if (sequence !== this.sequence) throw new DOMException("Superseded project request", "AbortError");
  }

  private load(read: (signal: AbortSignal) => Promise<PageIndex>, force: boolean): Promise<PageIndex> {
    this.cancel();
    const sequence = this.sequence;
    const controller = new AbortController();
    this.controller = controller;
    if (force || !this.snapshot.index) this.publish({ loading: true, error: null });
    const promise = Promise.resolve().then(async () => {
      try {
        const index = await read(controller.signal);
        await this.accept(index, sequence, controller.signal, force);
        this.check(sequence);
        return index;
      } catch (error) {
        if (sequence === this.sequence && !isAbortError(error)) {
          controller.abort();
          this.loadedKey = null;
          this.publish({ profile: null, paper: null, loading: false, error: errorMessage(error) });
        }
        throw error;
      } finally {
        if (sequence === this.sequence) {
          this.controller = null;
          this.flight = null;
        }
      }
    });
    this.flight = promise;
    return promise;
  }

  refresh = (force = false): Promise<PageIndex> => {
    if (this.flight && !force) return this.flight;
    return this.load(signal => this.api.listPages(signal), force);
  };

  /** Index-returning mutations supersede outstanding background reads. */
  setIndex = (index: PageIndex): void => {
    void this.load(async () => index, false).catch(() => {});
  };

  agentChanged = (): void => {
    this.publish({ agentRevision: this.snapshot.agentRevision + 1 });
  };

  /** Mutation owners report the affected profile instead of dispatching DOM events. */
  profileChanged = (profileId?: string): void => {
    const affectsProject = !profileId || profileId === this.snapshot.index?.project?.profileId;
    if (affectsProject) {
      this.loadedKey = null;
      this.cancel();
    }
    this.publish({ profileRevision: this.snapshot.profileRevision + 1,
      ...(affectsProject ? { loading: true } : {}) });
    if (affectsProject && this.active) void this.refresh(true).catch(() => {});
  };
}
