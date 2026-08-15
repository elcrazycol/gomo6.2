-- Default profile-background display variant set by the OWNER in the profile
-- studio ("Шапка и фон" tab): banner / card / page / page_dim.
-- Viewers who did NOT pick their own variant (Settings → Внешний вид →
-- «Отображение фонов» is unset for them) see the owner's choice; viewers who
-- did pick keep their own preference.
ALTER TABLE profile_customization
  ADD COLUMN IF NOT EXISTS background_variant TEXT NOT NULL DEFAULT 'banner';
