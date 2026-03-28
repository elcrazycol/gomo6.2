-- Add detailed stats privacy controls
alter table public.privacy_settings
  add column if not exists show_profile_stats boolean not null default false,
  add column if not exists show_detailed_stats boolean not null default false,
  add column if not exists stats_visibility jsonb not null default '{}'::jsonb;

comment on column public.privacy_settings.show_profile_stats is 'Toggle to allow showing summary stats on profile to others';
comment on column public.privacy_settings.show_detailed_stats is 'Toggle to allow exposing detailed stats to others';
comment on column public.privacy_settings.stats_visibility is 'Per-metric visibility map for stats page';
