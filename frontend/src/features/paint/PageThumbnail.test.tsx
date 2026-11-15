// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import PageThumbnail from "./PageThumbnail";

const pageThumbnail = vi.hoisted(() => vi.fn());
vi.mock("../../api", () => ({ api: { pageThumbnail } }));

beforeEach(() => { pageThumbnail.mockReset(); });

it("loads visible slide drawings and refreshes them when the slide changes", async () => {
  pageThumbnail.mockResolvedValueOnce({ thumb: { d: "M 0 0 L 10 10", w: 10, h: 10 } })
    .mockResolvedValueOnce({ thumb: { d: "M 0 0 L 20 10", w: 20, h: 10 } });
  const { container, rerender } = render(<PageThumbnail page={{ id: "slide", modified: 1 }} />);
  await waitFor(() => expect(container.querySelector("path")?.getAttribute("d")).toBe("M 0 0 L 10 10"));
  expect(pageThumbnail).toHaveBeenCalledTimes(1);

  rerender(<PageThumbnail page={{ id: "slide", modified: 2 }} />);
  await waitFor(() => expect(container.querySelector("path")?.getAttribute("d")).toBe("M 0 0 L 20 10"));
  expect(pageThumbnail).toHaveBeenCalledTimes(2);
});
