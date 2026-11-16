import EditorIcon from "../editor/EditorIcon";
import { useI18n } from "../../i18n";
export default function PaginationBar({
  page,
  pages,
  onChange,
  label,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
  label: string;
}) {
  const { t } = useI18n();
  return (
    <nav className="pagination-bar" aria-label={label}>
      <button
        type="button"
        aria-label={t("paging.previous")}
        title={t("paging.previous")}
        disabled={page <= 0}
        onClick={() => onChange(page - 1)}
      >
        <EditorIcon name="previous" size={15} />
      </button>
      <span>
        {page + 1} / {Math.max(1, pages)}
      </span>
      <button
        type="button"
        aria-label={t("paging.next")}
        title={t("paging.next")}
        disabled={page >= pages - 1}
        onClick={() => onChange(page + 1)}
      >
        <EditorIcon name="next" size={15} />
      </button>
    </nav>
  );
}
