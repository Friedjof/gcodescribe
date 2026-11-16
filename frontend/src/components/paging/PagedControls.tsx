import {
  Children,
  Fragment,
  isValidElement,
  useState,
  type ReactNode,
} from "react";
import PaginationBar from "./PaginationBar";
import { useI18n } from "../../i18n";
function flatten(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flatten(child.props.children)
      : [child],
  );
}
/** Parameter values live in the feature controller; changing pages only changes visibility. */
export default function PagedControls({
  children,
  size = 3,
}: {
  children: ReactNode;
  size?: number;
}) {
  const { t } = useI18n(),
    items = flatten(children),
    [requested, setPage] = useState(0),
    pages = Math.max(1, Math.ceil(items.length / size)),
    page = Math.min(requested, pages - 1);
  return (
    <div className="paged-controls">
      <div className="paged-controls-fields">
        {items.slice(page * size, (page + 1) * size)}
      </div>
      {pages > 1 && (
        <PaginationBar
          label={t("games.settings")}
          page={page}
          pages={pages}
          onChange={setPage}
        />
      )}
    </div>
  );
}
