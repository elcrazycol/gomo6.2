/**
 * Creates a Date object from a possibly-null/undefined string value.
 * Returns fallback date (defaults to new Date()) if value is null, undefined, empty, or invalid.
 */
export const safeDate = (value: string | null | undefined, fallback?: Date): Date => {
  if (!value) return fallback ?? new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? (fallback ?? new Date()) : d;
};
