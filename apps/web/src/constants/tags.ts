// Shared tag constants — used by Board, CreateThread, CreateThreadWizard
// Previously duplicated across Board.tsx, CreateThread.tsx, and CreateThreadWizard.tsx

export const CONTENT_TAGS = [
  { value: 'anime', label: 'Аниме' },
  { value: 'games', label: 'Игры' },
  { value: 'music', label: 'Музыка' },
  { value: 'movies', label: 'Фильмы' },
  { value: 'comics', label: 'Комиксы' },
  { value: 'humor', label: 'Юмор' },
  { value: 'literature', label: 'Литература' },
  { value: 'stories', label: 'Истории' }
] as const;

export const FORMAT_TAGS = [
  { value: 'shitpost', label: 'Щитпост' },
  { value: 'discussion', label: 'Обсуждение' },
  { value: 'question', label: 'Вопрос' },
  { value: 'confession', label: 'Признание' },
  { value: 'story', label: 'Рассказ' },
  { value: 'guide', label: 'Гайд' }
] as const;

export const ATMOSPHERE_TAGS = [
  { value: 'serious', label: 'Серьёзно' },
  { value: 'irony', label: 'Ирония' },
  { value: 'vent', label: 'Выплеск' },
  { value: 'doom', label: 'Тьма' }
] as const;

export const FLAG_TAGS = [
  { value: 'normal', label: 'Обычный' },
  { value: 'ephemeral', label: 'Временный' },
  { value: 'night', label: 'Ночной' }
] as const;

// Label lookup helpers for tag values (used in Thread.tsx tag rendering)
const CONTENT_LABELS: Record<string, string> = {};
const FORMAT_LABELS: Record<string, string> = {};
const ATMOSPHERE_LABELS: Record<string, string> = {};

for (const t of CONTENT_TAGS) CONTENT_LABELS[t.value] = t.label;
for (const t of FORMAT_TAGS) FORMAT_LABELS[t.value] = t.label;
for (const t of ATMOSPHERE_TAGS) ATMOSPHERE_LABELS[t.value] = t.label;

export const getContentTagLabel = (value: string) => CONTENT_LABELS[value] || value;
export const getFormatTagLabel = (value: string) => FORMAT_LABELS[value] || value;
export const getAtmosphereTagLabel = (value: string) => ATMOSPHERE_LABELS[value] || value;
