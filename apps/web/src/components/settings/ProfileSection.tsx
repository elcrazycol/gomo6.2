import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { IdCard, Layers, Sparkles } from "lucide-react";
import { SETTING_BLOCK_CHROME, SettingBlock, SettingGroup, SettingRow } from "./SettingRow";
import { profileUrl } from "@/utils/entityUrl";

/**
 * Settings → Профиль. Straight navigation into the profile itself and its two
 * dedicated editors (the full-page Profile Studio and the Placeholders picker).
 * The old "Внешний вид постов" row pointed at the dead `/settings/posts` route
 * — no such page ever existed — so it is gone rather than kept as a broken link.
 */

interface ProfileSectionProps {
  userId: string;
  /** Public number of the viewer, for /profile/<n> links. */
  userPublicId?: number | null;
}

export const ProfileSection = ({ userId, userPublicId }: ProfileSectionProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="space-y-5">
      <SettingGroup divided={false}>
        <SettingBlock
          id="set-profile-main"
          title={t("settings.profileCustomization")}
          description={t("settings.mainCustomizationDescription")}
          icon={Sparkles}
        >
          <SettingRow
            className={SETTING_BLOCK_CHROME}
            icon={IdCard}
            title={t("settings.mainCustomization")}
            description={t("settings.mainCustomizationDescription")}
            onClick={() => navigate(profileUrl({ id: userId, public_id: userPublicId }))}
          />
          <SettingRow
            className={SETTING_BLOCK_CHROME}
            icon={Sparkles}
            title={t("settings.profileStudio")}
            description={t("settings.profileStudioDescription")}
            onClick={() => navigate("/settings/prof-studio")}
          />
        </SettingBlock>
      </SettingGroup>

      <SettingGroup divided={false}>
        <SettingBlock
          id="set-placeholders"
          title={t("settings.placeholders")}
          description={t("settings.profilePlaceholdersDescription")}
          icon={Layers}
        >
          <SettingRow
            className={SETTING_BLOCK_CHROME}
            icon={Layers}
            title={t("settings.profilePlaceholders")}
            description={t("settings.profilePlaceholdersDescription")}
            onClick={() => navigate("/settings/placeholders")}
          />
        </SettingBlock>
      </SettingGroup>
    </div>
  );
};
