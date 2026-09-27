/**
 * ЮРИДИЧЕСКИЙ КОНФИГ — единственное место, где живут «переменные» документов.
 *
 * Всё, что может измениться (имя проекта, домен, контакты, регион, версии,
 * даты, статус черновика), задаётся здесь. Тексты документов (documents.ts)
 * подставляют эти значения через токены {{brand}}, {{domain}}, {{contact}} и
 * т.п. — поэтому переименование проекта или смена почты не требует правок в
 * самих документах.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ ЧТО ЗАМЕНИТЬ ПРИ ПЕРЕИМЕНОВАНИИ ПРОЕКТА:                                │
 * │   brand.name / brand.domain / brand.url / brand.docsUrl                 │
 * │   BRAND_TOKENS подхватит их автоматически.                              │
 * │                                                                         │
 * │ ЧТО ЗАМЕНИТЬ ПРИ ПОЯВЛЕНИИ ЮРЛИЦА/ИП:                                   │
 * │   operator.* — сейчас там «администрация проекта» (регистрации нет).     │
 * │                                                                         │
 * │ ЧТО ЗАМЕНИТЬ ПРИ ВЫПУСКЕ НОВОЙ ВЕРСИИ:                                  │
 * │   versions.* и versions.effectiveFrom / updatedAt.                      │
 * │                                                                         │
 * │ ПОКА documents.draft = true — на всех страницах видна плашка «черновик».│
 * │ Юридической силы эти тексты не имеют: они под замену.                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/** Черновик: плашка «не является юридическим документом» на всех страницах. */
export const LEGAL_IS_DRAFT = true;

export const BRAND = {
  /** Отображаемое имя проекта. ← меняется здесь, и только здесь. */
  name: "GOMO6",
  /** Короткое имя без цифр — для логотипов/подписей вида «сеть {{shortName}}». */
  shortName: "GOMO",
  /** Основной домен без схемы. */
  domain: "gomo6.wtf",
  /** Публичный URL с протоколом. */
  url: "https://gomo6.wtf",
  /** Поддомен с документацией/API. */
  docsUrl: "https://docs.gomo6.wtf",
} as const;

export const OPERATOR = {
  /**
   * Кто оператор Сервиса. Регистраций нет и не планируется — поэтому это
   * «администрация проекта», а не юрлицо. При появлении ИП/ООО заполнить
   * юридическое название, номер и адрес.
   */
  designation: "администрация проекта",
  /** Юрисдикция оператора. Сервер всегда размещён в ЕС — см. region. */
  country: "Европейский союз",
  /** Контактный адрес для любых юридических вопросов. */
  contactEmail: "admin@gomo6.wtf",
  /** Жалобы на контент и нарушения. */
  abuseEmail: "admin@gomo6.wtf",
  /** Уведомления о нарушении авторских прав. */
  copyrightEmail: "admin@gomo6.wtf",
  /** Жалобы и вопросы по персональным данным. */
  privacyEmail: "admin@gomo6.wtf",
} as const;

/**
 * Доступность и применимое право.
 *
 * Сервис размещён в ЕС и не предназначен для доступа с территории РФ —
 * это фиксированные вводные, остальное в документах намеренно сформулировано
 * нейтрально, чтобы не переписывать всё после очередного изменения.
 */
export const REGION = {
  /** Где физически находятся серверы и данные. */
  hosting: "Европейский союз",
  /** Регион, для которого Сервис не предназначен. */
  unavailableIn: "Российской Федерации",
  /** Применимое право (черновая, нейтральная формулировка). */
  governingLaw: "право страны, в которой фактически размещён Сервер",
} as const;

/** Версии документов. Бампается при содержательном изменении текста. */
export const LEGAL_VERSIONS = {
  /** Версия, которую принимает пользователь (по ней же определяется, нужно ли
   *  повторное согласие). */
  terms: "0.9-draft",
  privacy: "0.9-draft",
  cookies: "0.9-draft",
  rules: "0.9-draft",
  copyright: "0.9-draft",
  developer: "0.9-draft",
} as const;

export const LEGAL_DATES = {
  /** С какой даты действует текущая (черновая) редакция. */
  effectiveFrom: "2026-09-27",
  /** Когда текст правился в последний раз. */
  updatedAt: "2026-09-27",
} as const;

/**
 * Токены, доступные в текстах документов как {{token}}.
 * Значения подставляются в одном месте (fillLegalText).
 */
export const LEGAL_TOKENS: Record<string, string> = {
  brand: BRAND.name,
  shortName: BRAND.shortName,
  domain: BRAND.domain,
  url: BRAND.url,
  docsUrl: BRAND.docsUrl,
  operator: OPERATOR.designation,
  country: OPERATOR.country,
  contact: OPERATOR.contactEmail,
  abuse: OPERATOR.abuseEmail,
  copyright: OPERATOR.copyrightEmail,
  privacy: OPERATOR.privacyEmail,
  hosting: REGION.hosting,
  unavailableIn: REGION.unavailableIn,
  governingLaw: REGION.governingLaw,
  effectiveFrom: LEGAL_DATES.effectiveFrom,
  updatedAt: LEGAL_DATES.updatedAt,
};

/** Подставляет {{token}}-ы в строку. Неизвестный токен остаётся как есть. */
export const fillLegalText = (text: string): string =>
  text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(LEGAL_TOKENS, key) ? LEGAL_TOKENS[key] : whole,
  );

/** `2026-09-27` → `27 сентября 2026`. */
export const formatLegalDate = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};
