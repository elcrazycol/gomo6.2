/**
 * Safely parses a date string, returning current date if invalid/nil.
 */
export const safeDate = (value: string | null | undefined): Date => {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
};
