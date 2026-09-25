// Link card node attributes + helpers (shared by the editor NodeView and the
// read renderer).

export const LINK_CARD_NODE = "linkCard";

export interface LinkCardAttrs {
  url: string;
  title: string;
  description: string;
  image: string | null;
  siteName: string;
}

export const DEFAULT_LINK_CARD_ATTRS: LinkCardAttrs = {
  url: "",
  title: "",
  description: "",
  image: null,
  siteName: "",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const toLinkCardAttrs = (raw: unknown): LinkCardAttrs => {
  const src = isRecord(raw) ? raw : {};
  return {
    url: typeof src.url === "string" ? src.url : "",
    title: typeof src.title === "string" ? src.title : "",
    description: typeof src.description === "string" ? src.description : "",
    image: typeof src.image === "string" && src.image ? src.image : null,
    siteName: typeof src.siteName === "string" ? src.siteName : "",
  };
};

/** Display host for a URL (drops a leading www.), used when the site name is missing. */
export const linkHost = (raw: string): string => {
  try {
    return new URL(raw).host.replace(/^www\./i, "");
  } catch {
    return raw;
  }
};

/** Only http/https links are turned into cards. */
export const isCardableUrl = (raw: string): boolean => /^https?:\/\/\S+$/i.test(raw.trim());
