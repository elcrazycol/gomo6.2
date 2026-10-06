import { Fragment, useMemo } from "react";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Props = {
  text: string | null | undefined;
  query: string;
  className?: string;
};

/**
 * Renders `text` with every occurrence of a query term wrapped in <mark>.
 *
 * Matching is client-side and safe by construction: the split produces React
 * text nodes, never HTML, so indexed user content cannot inject markup. (This
 * is why we don't use Meilisearch's `_formatted` field with
 * dangerouslySetInnerHTML.)
 */
export function HighlightText({ text, query, className }: Props) {
  const value = text ?? "";

  const regex = useMemo(() => {
    const terms = Array.from(
      new Set(
        query
          .trim()
          .split(/\s+/)
          .filter((term) => term.length >= 2)
      )
    ).sort((a, b) => b.length - a.length);
    if (terms.length === 0) return null;
    return new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  }, [query]);

  if (!regex || !value) return <>{value}</>;

  const parts = value.split(regex);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark
            key={index}
            className={className ?? "rounded-sm bg-primary/25 px-0.5 text-inherit"}
          >
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        )
      )}
    </>
  );
}
