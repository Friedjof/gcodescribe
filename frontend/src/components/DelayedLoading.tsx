import { useEffect, useState } from "react";
import { useI18n } from "../i18n";

export default function DelayedLoading() {
  const [shown, setShown] = useState(false);
  const { t } = useI18n();
  useEffect(() => { const timer = setTimeout(() => setShown(true), 150); return () => clearTimeout(timer); }, []);
  return <div className="loading-placeholder" role="status" aria-busy="true">{shown ? t("common.loading") : ""}</div>;
}
