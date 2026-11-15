export interface PageNavigationRequest {
  signal: AbortSignal;
  current: () => boolean;
  finish: () => void;
  cancel: () => void;
}

/** Orders server mutations and gives every view load one replaceable owner. */
export class PageNavigation {
  private scope = "";
  private generation = 0;
  private scopeGeneration = 0;
  private enabled = true;
  private read: { controller: AbortController; kind: "user" | "sync"; expectedScope?: string } | null = null;
  private writes: Promise<unknown> = Promise.resolve();

  setScope(scope: string) {
    if (scope === this.scope) return;
    this.scope = scope;
    this.scopeGeneration++;
    // A project switch can be announced by the shared context before its page
    // read finishes. Preserve that request, while invalidating old-project work.
    if (this.read?.expectedScope === scope) {
      this.read.expectedScope = undefined;
      return;
    }
    this.cancel();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.cancel();
  }

  private cancel() {
    this.generation++;
    this.read?.controller.abort();
    this.read = null;
  }

  get pending() { return this.read !== null; }

  get userPending() { return this.read?.kind === "user"; }

  captureScope = () => {
    const scope = this.scopeGeneration;
    return () => this.enabled && this.scopeGeneration === scope;
  };

  capture = () => {
    const generation = this.generation, inScope = this.captureScope();
    return () => inScope() && this.generation === generation;
  };

  begin(kind: "user" | "sync" = "user", expectedScope?: string): PageNavigationRequest {
    this.cancel();
    const controller = new AbortController();
    this.read = { controller, kind, expectedScope };
    const generation = this.generation;
    const current = () => this.enabled && this.generation === generation;
    let finished = false;
    const finish = () => {
      finished = true;
      if (this.read?.controller === controller) {
        this.read = null;
        // Index reads started during this navigation can describe its previous
        // active page; they must not publish after the navigation commits.
        this.generation++;
      }
    };
    return {
      signal: controller.signal,
      current: () => current() && !finished && !controller.signal.aborted,
      finish,
      cancel: () => { controller.abort(); finish(); },
    };
  }

  enqueue<T>(current: () => boolean, mutation: () => Promise<T>): Promise<T | undefined> {
    const next = this.writes.then(() => current() ? mutation() : undefined);
    // Failed writes must not block the next independent user action.
    this.writes = next.catch(() => {});
    return next;
  }

  settled = async () => { await this.writes; };
}
