// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import CommittedNumberField from "./CommittedNumberField";

afterEach(cleanup);

vi.mock("../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

it("keeps unfinished edits local and only commits a valid value on blur", () => {
  const change = vi.fn();
  render(<CommittedNumberField label="Height" value={5} min={0} max={20} onChange={change} />);
  const input = screen.getByRole("spinbutton", { name: "Height" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
  expect(change).not.toHaveBeenCalled();
  expect(input).toHaveAttribute("aria-invalid", "true");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "-1" } });
  fireEvent.blur(input);
  expect(change).not.toHaveBeenCalled();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "12.5" } });
  expect(change).not.toHaveBeenCalled();
  fireEvent.blur(input);
  expect(change).toHaveBeenCalledExactlyOnceWith(12.5);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("commits with Enter and cancels edits with Escape", async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(<CommittedNumberField label="Height" value={5} onChange={change} />);
  const input = screen.getByRole("spinbutton", { name: "Height" });
  await user.clear(input);
  await user.type(input, "8{Escape}");
  expect(input).toHaveValue(5);
  expect(change).not.toHaveBeenCalled();
  await user.clear(input);
  await user.type(input, "7.5{Enter}");
  expect(change).toHaveBeenCalledExactlyOnceWith(7.5);
});
