// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PagedGrid from "./PagedGrid";
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
it("bounds a collection, exposes subsequent items, and returns to the first page for a new filter", () => {
 const items = Array.from({ length: 70 }, (_, id) => ({ id: String(id) }));
 const props = { items, itemKey: (item: { id: string }) => item.id, renderItem: (item: { id: string }) => <button>item-{item.id}</button>, label: "Library" };
 const rendered = render(<PagedGrid {...props} resetKey="all"/>);
 expect(screen.getByRole("button", { name: "item-0" })).toBeDefined();
 expect(screen.queryByRole("button", { name: "item-69" })).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: "paging.next" }));
 expect(screen.queryByRole("button", { name: "item-0" })).toBeNull();
 rendered.rerender(<PagedGrid {...props} resetKey="filtered"/>);
 expect(screen.getByRole("button", { name: "item-0" })).toBeDefined();
});
