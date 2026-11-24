import Modal from "../../../components/Modal";
import { useI18n } from "../../../i18n";
import { shortcutLabels, type Command } from "../../../interface/shortcuts";

/** Reference popup listing the editor's keyboard shortcuts and canvas
 * mouse/touch gestures. Opened via the ⓘ button in the toolbar. */
export default function PaintInfoModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();

  const shortcuts: { keys: string[]; label: string }[] = [
    { keys: ["Ctrl", "Tab"], label: t("interface.nextWorkspace") },
    { keys: ["Ctrl", "Shift", "Tab"], label: t("interface.previousWorkspace") },
    { keys: ["Ctrl", "PageUp / PageDown"], label: t("shortcuts.workspaceCycle") },
    { keys: ["Alt", "1–9"], label: t("shortcuts.workspaceDirect") },
    ...([
      ["settings", "settings.title"], ["help", "app.help"], ["shortcuts", "paint.info.button"],
      ["newSlide", "app.newPage"], ["newProject", "projects.newProject"], ["open", "app.projects"],
      ["save", "shortcuts.save"], ["export", "shortcuts.export"], ["plot", "paint.plotOptions"], ["preview", "paint.preview"],
      ["search", "shortcuts.search"], ["rename", "profiles.renameAction"], ["selectAll", "shortcuts.selectAll"],
      ["deselect", "shortcuts.deselect"], ["zoomIn", "paint.zoomIn"], ["zoomOut", "paint.zoomOut"],
      ["fit", "interface.fitPage"], ["sidebar", "shortcuts.sidebar"],
    ] as [Command, string][]).map(([command, label]) => ({ keys: command === "zoomIn" ? ["Ctrl", "+"] : shortcutLabels[command].split("+"), label: t(label) })),
    { keys: ["Esc"], label: t("paint.info.escape") },
    { keys: ["↑", "↓", "←", "→"], label: t("paint.info.nudge") },
    { keys: ["Del"], label: t("paint.info.deleteSel") },
    { keys: ["Ctrl", "C"], label: t("paint.info.copy") },
    { keys: ["Ctrl", "X"], label: t("paint.info.cut") },
    { keys: ["Ctrl", "V"], label: t("paint.info.paste") },
    { keys: ["Ctrl", "D"], label: t("paint.info.duplicate") },
    { keys: ["Ctrl", "Z"], label: t("paint.info.undo") },
    { keys: ["Ctrl", "Shift", "Z"], label: t("paint.info.redo") },
    { keys: ["A…Z"], label: t("paint.info.typeText") },
  ];

  const gestures: { keys: string[]; label: string }[] = [
    { keys: [t("paint.info.wheel")], label: t("paint.info.zoom") },
    { keys: [t("paint.info.rightDrag")], label: t("paint.info.pan") },
    { keys: [t("paint.info.drag")], label: t("paint.info.marquee") },
    { keys: ["Ctrl/Shift", t("paint.info.click")], label: t("paint.info.multiSelect") },
    { keys: [t("paint.info.rightClick")], label: t("paint.info.contextMenu") },
    { keys: ["Ctrl", t("paint.info.cornerDrag")], label: t("paint.info.uniformScale") },
    { keys: [t("paint.info.rotateHandle")], label: t("paint.info.rotateSnap") },
  ];

  const renderRows = (rows: { keys: string[]; label: string }[]) => (
    <dl className="paint-info-grid">
      {rows.map((row) => (
        <div className="paint-info-row" key={row.label}>
          <dt>
            {row.keys.map((k, i) => (
              <span key={k + i}>
                {i > 0 && <span className="paint-info-plus">+</span>}
                <kbd>{k}</kbd>
              </span>
            ))}
          </dt>
          <dd>{row.label}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <Modal title={t("paint.info.title")} onClose={onClose} className="paint-info-modal">
      <p>{t("shortcuts.context")}</p>
      <div className="paint-info-columns">
        <section>
          <h4>{t("paint.info.shortcuts")}</h4>
          {renderRows(shortcuts)}
        </section>
        <section>
          <h4>{t("paint.info.gestures")}</h4>
          {renderRows(gestures)}
        </section>
      </div>
    </Modal>
  );
}
