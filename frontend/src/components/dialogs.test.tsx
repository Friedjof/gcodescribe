// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useConfirm, usePrompt } from "./dialogs";
import Modal from "./Modal";
vi.mock("../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
it("keeps a parent dialog open when Escape cancels its confirmation", async () => {
 const parentClose = vi.fn(), answer = vi.fn();
 function Harness() { const { confirm, ConfirmNode } = useConfirm(); return <Modal title="Parent" onClose={parentClose}><button onClick={async () => answer(await confirm("Discard changes?"))}>Ask</button>{ConfirmNode}</Modal>; }
 render(<Harness/>); const ask = screen.getByRole("button", { name: "Ask" }); ask.focus(); fireEvent.click(ask);
 const dialog = screen.getByRole("alertdialog"); const cancel = within(dialog).getByRole("button", { name: "common.cancel" }); const yes = within(dialog).getByRole("button", { name: "common.yes" });
 expect(document.activeElement).toBe(cancel); yes.focus(); fireEvent.keyDown(yes, { key: "Tab" }); expect(document.activeElement).toBe(cancel);
 fireEvent.keyDown(cancel, { key: "Escape" }); await waitFor(() => expect(answer).toHaveBeenCalledWith(false));
 expect(parentClose).not.toHaveBeenCalled(); expect(document.activeElement).toBe(ask);
});
it("labels text prompts and returns entered text once", async () => {
 const answer = vi.fn(); function Harness() { const { prompt, PromptNode } = usePrompt(); return <><button onClick={async () => answer(await prompt("Page name", "Old name"))}>Rename</button>{PromptNode}</>; }
 render(<Harness/>); fireEvent.click(screen.getByRole("button", { name: "Rename" }));
 const input = screen.getByRole("textbox", { name: "Page name" }); fireEvent.change(input, { target: { value: "New name" } }); fireEvent.keyDown(input, { key: "Enter" });
 await waitFor(() => expect(answer).toHaveBeenCalledWith("New name")); expect(answer).toHaveBeenCalledTimes(1);
});
