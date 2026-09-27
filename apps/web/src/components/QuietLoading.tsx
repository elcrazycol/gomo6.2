/**
 * The content area's loading placeholder — deliberately empty.
 *
 * The header's loading bar is the progress cue, so views fade in when they are
 * ready instead of flashing a skeleton over the area. `min-h` keeps the footer
 * from jumping while the first page is in flight.
 */
export const QuietLoading = ({ className = "min-h-[45vh]" }: { className?: string }) => (
  <div className={className} aria-busy="true" />
);
