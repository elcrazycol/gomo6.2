// The link card visual, shared by the editor NodeView and the read renderer.
// In the read view the whole card is a link; in the editor it is inert (the
// toolbar carries the explicit "open" action) so it can be selected/edited.

import type { LinkCardAttrs } from "./linkCardSchema";

const cardClass =
  "link-card group/card flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border/70 bg-card text-left shadow-sm transition-colors";

export const LinkCardView = ({ attrs, editable = false }: { attrs: LinkCardAttrs; editable?: boolean }) => {
  const body = (
    <>
      {attrs.image && (
        <div className="aspect-[1.91/1] w-full overflow-hidden bg-muted">
          <img
            src={attrs.image}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover/card:scale-[1.02]"
          />
        </div>
      )}
      <span className="flex flex-col gap-1 p-3">
        <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {attrs.siteName}
        </span>
        <span className="line-clamp-2 text-sm font-semibold text-foreground">{attrs.title || attrs.url}</span>
        {attrs.description && (
          <span className="line-clamp-2 text-xs leading-5 text-muted-foreground">{attrs.description}</span>
        )}
      </span>
    </>
  );

  if (editable) {
    return <div className={cardClass}>{body}</div>;
  }

  return (
    <a
      href={attrs.url}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      data-wall-no-open="true"
      title={attrs.url}
      className={`${cardClass} hover:border-primary/40`}
    >
      {body}
    </a>
  );
};
