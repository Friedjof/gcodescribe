import { describe, expect, it, vi } from "vitest";
import type { Calibration, CalibrationProfile, PageIndex, PaperState } from "../api/types";
import { ProjectCalibrationStore } from "./projectCalibrationStore";

const calibration: Calibration = {
  bed_width: 210, bed_height: 210, z_max: 205, plot_width: 200, plot_height: 200,
  origin_x: 5, origin_y: 5, pen_up_z: 5, pen_down_z: 1, pen_calibrated: true,
  travel_feed: 100, draw_feed: 50, z_feed: 20, z_max_feedrate: 60,
  fit_to_area: true, flip_y: true, trust_axis_home: false, park_after_plot: true,
  park_x: 105, park_y: 210, park_lift_z: 10, calibration_x: 105, calibration_y: 105,
  paper_corners: {}, paper_margin: 5, obstacles: [], merge_tolerance: 0.5,
};
function fixture(id: string, fingerprint = `rev-${id}`) {
  const profile: CalibrationProfile = { id: `profile-${id}`, name: id, active: false,
    archived: false, created: 1, modified: 1, fingerprint,
    plot_width: 200, plot_height: 200, origin_x: 5, origin_y: 5, paper_margin: 5,
    pen_calibrated: true, calibration: { ...calibration, bed_width: id === "a" ? 210 : 300 } };
  const index: PageIndex = { project: { id, profileId: profile.id, name: id,
    activeId: null, modified: 1, archived: false }, order: [], activeId: null,
    activeProfile: { id: profile.id, name: id, fingerprint, plot_width: 200, plot_height: 200, origin_x: 5, origin_y: 5 } };
  const paper: PaperState = { calibration: profile.calibration, rect: null };
  return { profile, index, paper };
}
const a = fixture("a"), b = fixture("b");
function setup() {
  const api = { listPages: vi.fn().mockResolvedValue(a.index),
    getProfile: vi.fn().mockImplementation(async id => id === a.profile.id ? a.profile : b.profile),
    paper: vi.fn().mockImplementation(async id => id === "a" ? a.paper : b.paper) };
  return { api, store: new ProjectCalibrationStore(api) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("shared project/calibration snapshot", () => {
  it("coalesces concurrent readers and reuses unchanged calibration across polls", async () => {
    const { api, store } = setup();
    const first = store.refresh();
    expect(store.refresh()).toBe(first);
    await first;
    const snapshot = store.getSnapshot();
    await store.refresh();
    expect(store.getSnapshot()).toBe(snapshot);
    expect(api.getProfile).toHaveBeenCalledTimes(1);
    expect(api.paper).not.toHaveBeenCalled();
    expect(snapshot.profile?.id).toBe(a.index.project?.profileId);
    expect(snapshot.paper?.calibration.bed_width).toBe(210);
  });

  it("rejects a stale project list when a mutation has already selected another project", async () => {
    const { api, store } = setup();
    const pending = deferred<PageIndex>();
    api.listPages.mockReturnValueOnce(pending.promise);
    const old = store.refresh();
    const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(api.listPages).toHaveBeenCalledOnce());
    store.setIndex(b.index);
    await vi.waitFor(() => expect(store.getSnapshot().profile?.id).toBe(b.profile.id));
    pending.resolve(a.index);
    await rejected;
    expect(store.getSnapshot().index?.project?.id).toBe("b");
    expect(store.getSnapshot().paper?.calibration.bed_width).toBe(300);
  });

  it("drops old geometry immediately and ignores a late profile response after switching", async () => {
    const { api, store } = setup();
    await store.refresh();
    const pending = deferred<CalibrationProfile>();
    api.getProfile.mockReturnValueOnce(pending.promise);
    const old = store.refresh(true);
    const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(api.getProfile).toHaveBeenCalledTimes(2));
    const pendingB = deferred<CalibrationProfile>();
    api.getProfile.mockReturnValueOnce(pendingB.promise);
    store.setIndex(b.index);
    await vi.waitFor(() => expect(store.getSnapshot().index?.project?.id).toBe("b"));
    expect(store.getSnapshot().profile).toBeNull();
    expect(store.getSnapshot().paper).toBeNull();
    pendingB.resolve(b.profile);
    await vi.waitFor(() => expect(store.getSnapshot().loading).toBe(false));
    pending.resolve(a.profile);
    await rejected;
    expect(store.getSnapshot().profile).toBe(b.profile);
  });

  it("invalidates a pre-save read and keeps plotting blocked until the new profile arrives", async () => {
    const { api, store } = setup();
    store.setActive(true);
    await store.refresh();
    const pending = deferred<PageIndex>();
    api.listPages.mockReturnValueOnce(pending.promise);
    const old = store.refresh();
    const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(api.listPages).toHaveBeenCalledTimes(2));
    const updated = fixture("a", "new-revision");
    api.listPages.mockResolvedValue(updated.index);
    const profileRead = deferred<CalibrationProfile>();
    api.getProfile.mockReturnValueOnce(profileRead.promise);
    store.profileChanged(a.profile.id);
    expect(store.getSnapshot().loading).toBe(true);
    await vi.waitFor(() => expect(api.getProfile).toHaveBeenCalledTimes(2));
    expect(store.getSnapshot().loading).toBe(true);
    profileRead.resolve(updated.profile);
    await vi.waitFor(() => expect(store.getSnapshot().profile?.fingerprint).toBe("new-revision"));
    pending.resolve(a.index);
    await rejected;
    expect(store.getSnapshot().profile?.fingerprint).toBe("new-revision");
    expect(store.getSnapshot().loading).toBe(false);
  });

  it("notifies profile editors about unrelated profiles without resetting the active project", async () => {
    const { api, store } = setup();
    store.setActive(true);
    await store.refresh();
    store.profileChanged("unrelated");
    expect(store.getSnapshot().profile).toBe(a.profile);
    expect(store.getSnapshot().loading).toBe(false);
    expect(store.getSnapshot().profileRevision).toBe(1);
    expect(api.listPages).toHaveBeenCalledTimes(1);
  });

  it("fails closed on read errors and recovers on the next refresh", async () => {
    const { api, store } = setup();
    await store.refresh();
    api.getProfile.mockRejectedValueOnce(new Error("Profile unavailable"));
    await expect(store.refresh(true)).rejects.toThrow("Profile unavailable");
    expect(store.getSnapshot()).toMatchObject({ error: "Profile unavailable", profile: null, paper: null });
    await store.refresh();
    expect(store.getSnapshot()).toMatchObject({ error: null, loading: false, profile: a.profile });
  });

  it("does not publish mixed profile versions when calibration changes during a read", async () => {
    const { api, store } = setup();
    api.getProfile.mockResolvedValueOnce(fixture("a", "different-version").profile);
    await expect(store.refresh()).rejects.toThrow("während des Ladens geändert");
    expect(store.getSnapshot().profile).toBeNull();
    expect(store.getSnapshot().paper).toBeNull();
  });

  it("loads automatic positions without mixing in incompatible legacy paper metadata", async () => {
    const { api, store } = setup();
    const selected = fixture("b");
    selected.profile.calibration = { ...selected.profile.calibration, defined_positions: [],
      paper_corners: { bl: [20, 30], tr: [180, 190] } };
    api.getProfile.mockResolvedValue(selected.profile);
    api.paper.mockResolvedValue({ calibration: { ...selected.profile.calibration,
      defined_positions: ["park", "calibration"] }, rect: [20, 30, 160, 160] });
    store.setIndex(selected.index);
    await vi.waitFor(() => expect(store.getSnapshot().profile).toBe(selected.profile));
    expect(store.getSnapshot().error).toBeNull();
    expect(store.getSnapshot().paper).toEqual({ calibration: selected.profile.calibration, rect: [20, 30, 160, 160] });
    expect(store.getSnapshot().paper?.calibration.defined_positions).toEqual([]);
    expect(api.paper).not.toHaveBeenCalled();
  });

  it("aborts a deactivated session and rejects late results", async () => {
    const { api, store } = setup();
    const pending = deferred<PageIndex>();
    api.listPages.mockReturnValueOnce(pending.promise);
    const read = store.refresh();
    const rejected = expect(read).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(api.listPages).toHaveBeenCalledOnce());
    const signal = api.listPages.mock.calls[0][0];
    store.setActive(false);
    expect(signal.aborted).toBe(true);
    pending.resolve(a.index);
    await rejected;
    expect(store.getSnapshot().profile).toBeNull();
    await store.refresh();
    expect(store.getSnapshot().profile).toBe(a.profile);
  });

  it("unlocks a valid cached context after a forced read was interrupted before its index arrived", async () => {
    const { api, store } = setup();
    await store.refresh();
    const pending = deferred<PageIndex>();
    api.listPages.mockReturnValueOnce(pending.promise);
    const interrupted = store.refresh(true);
    const rejected = expect(interrupted).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(api.listPages).toHaveBeenCalledTimes(2));
    expect(store.getSnapshot().loading).toBe(true);
    store.cancel();
    await store.refresh();
    pending.resolve(a.index);
    await rejected;
    expect(store.getSnapshot().loading).toBe(false);
    expect(store.getSnapshot().profile).toBe(a.profile);
  });
});
