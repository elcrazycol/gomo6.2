import { cn } from "@/lib/utils";

// Discord-like settings primitives: compact rows with dividers, switches on
// the right, uppercase micro headers. Theme-aware (uses surface/muted
// tokens, so light and dark themes both work).

/** Card shell for a settings block. */
export const settingsCard = "rounded-2xl border border-border/60 bg-surface overflow-hidden";

/** Muted block for creation forms. */
export const settingsFormCard = "rounded-2xl border border-border/60 bg-muted/25 p-4 space-y-3";

/** Uppercase micro header, e.g. "ПРАВА — МОДЕРАЦИЯ". */
export const settingsSectionTitle = "text-[11px] font-bold uppercase tracking-widest text-muted-foreground";

/** Divider row list container. */
export const settingsRows = "divide-y divide-border/40";

/** One settings row: label left, control right. */
export const settingsRow = "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40";

/** Input that reads as a Discord field (filled, borderless until focus). */
export const settingsInput = "rounded-lg bg-muted/60 border-transparent focus:border-primary/40";

/** Primary compact button. */
export const settingsButtonPrimary = "rounded-lg h-8 text-xs";

/** Merged input class for shadcn Input. */
export const inputCls = (...extra: (string | false | undefined)[]) => cn(settingsInput, ...extra);
