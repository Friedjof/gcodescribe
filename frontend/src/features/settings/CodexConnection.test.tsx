// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CodexConnection from "./CodexConnection";
const mocks = vi.hoisted(() => ({ codexStatus: vi.fn(), codexLogin: vi.fn(), codexCancelLogin: vi.fn(), codexLogout: vi.fn() }));
vi.mock("../../api", () => ({ api: mocks }));
vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.codexStatus.mockResolvedValue({ available: true, authenticated: false, imageGeneration: false });
  mocks.codexLogin.mockResolvedValue({ loginId: "login", verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-1234" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("offers the installation link when the server has no Codex CLI", async () => {
  mocks.codexStatus.mockResolvedValue({ available: false, authenticated: false, imageGeneration: false });
  render(<CodexConnection onChanged={vi.fn()} />);
  expect(await screen.findByRole("link", { name: "codex.installLink" })).toHaveAttribute("href", "https://developers.openai.com/codex/cli");
  expect(screen.queryByRole("button", { name: "codex.login" })).toBeNull();
});
it("shows the one-time code and recognizes a completed login automatically", async () => {
  const changed = vi.fn();
  render(<CodexConnection onChanged={changed} />);
  const button = await screen.findByRole("button", { name: "codex.login" });
  vi.useFakeTimers();
  await act(async () => fireEvent.click(button));
  expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "codex.openLogin" })).toHaveAttribute("href", "https://auth.openai.com/codex/device");
  mocks.codexStatus.mockResolvedValue({ available: true, authenticated: true, imageGeneration: true, email: "user@example.test", plan: "plus" });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByRole("button", { name: "codex.logout" })).toBeInTheDocument();
  expect(screen.queryByText("ABCD-1234")).toBeNull();
  expect(changed).toHaveBeenCalledOnce();
});
