import { expect, it } from "vitest";
import { SetupProgressStore } from "./setupProgressStore";
it("shares progress immediately between views and keeps stable snapshots", () => {
  const store = new SetupProgressStore();
  const initial = store.get("project", "profile");
  expect(store.get("project", "profile")).toBe(initial);
  let notifications = 0;
  const off = store.subscribe(() => notifications++);
  store.confirmProject("project", "profile");
  expect(store.get("project", "profile").confirmed).toBe(true);
  expect(store.get("project", "other").confirmed).toBe(false);
  expect(notifications).toBe(1);
  off();
  store.reload();
  expect(notifications).toBe(1);
});
it("keeps newly created project confirmation in memory when storage is blocked", () => {
  const store = new SetupProgressStore({
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  });
  store.confirmProject("new-project", "new-profile");
  expect(store.get("new-project", "new-profile").confirmed).toBe(true);
});
