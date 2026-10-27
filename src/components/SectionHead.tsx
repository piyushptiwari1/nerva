import type { ReactNode } from "react";

/**
 * Standard header for every panel/sidebar section: a dominant title with
 * the accent rule, an optional count, a one-line purpose, and actions on
 * the right. Keeps sections visually distinct without stealing height.
 */
export function SectionHead({
  title,
  count,
  sub,
  actions,
  as: Tag = "h3",
}: {
  title: ReactNode;
  count?: number | string | null;
  sub?: ReactNode;
  actions?: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <header className="section-head">
      <div className="min-w-0">
        <Tag className="section-title">
          <span className="truncate">{title}</span>
          {count !== undefined && count !== null && count !== 0 && count !== "" && (
            <span className="count">{count}</span>
          )}
        </Tag>
        {sub && <p className="section-sub">{sub}</p>}
      </div>
      {actions && <div className="section-actions">{actions}</div>}
    </header>
  );
}
