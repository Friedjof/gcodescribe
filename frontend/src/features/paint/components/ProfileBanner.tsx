import type { Page } from "../../../api";
import { useI18n } from "../../../i18n";

/** Warning banner shown when the page belongs to another/stale/archived
 * profile and plotting is blocked. Renders nothing for active pages. */
export default function ProfileBanner({
  page,
  onActivateProfile,
  onAdoptProfile,
}: {
  page: Page;
  onActivateProfile: () => void;
  onAdoptProfile: () => void;
}) {
  const { t } = useI18n();
  if (!page.profileStatus || page.profileStatus === "active") return null;
  return (
    <div className="banner warn profile-banner">
      <span>
        {page.profileStatus === "other"
          ? t("paint.pageOtherProfile", { name: page.profileName ?? "?" })
          : page.profileStatus === "stale"
            ? t("paint.pageStale")
            : page.profileStatus === "archived"
              ? t("paint.pageArchivedProfile", { name: page.profileName ?? "?" })
              : page.profileId
                ? t("paint.pageMissingProfile", { name: page.profileName ?? "?" })
                : t("paint.pageNoProfileHint")}
      </span>
      {page.profileStatus === "other" && page.profileId && (
        <button onClick={onActivateProfile}>
          {t("paint.activateProfile", { name: page.profileName ?? "?" })}
        </button>
      )}
      <button onClick={onAdoptProfile}>{t("paint.adoptProfile")}</button>
    </div>
  );
}
