import { useEffect, useState, type ReactNode } from "react";

/**
 * One table for every screen, so a hundred rows read the same everywhere.
 * Pages at 25 rows by default: a table nobody can reach the bottom of is a
 * table nobody reads.
 */
export interface Column {
  label: string;
  width?: number;
  align?: "right";
}

export interface Row {
  id: string;
  cells: ReactNode[];
  selected?: boolean;
  muted?: boolean;
  onSelect?: () => void;
}

export function Table({
  columns,
  rows,
  empty,
  pageSize: initialSize = 20,
}: {
  columns: Column[];
  rows: Row[];
  empty?: string;
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialSize);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));

  // A page that no longer exists — after a filter or a re-run — snaps back.
  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1);
  }, [page, pages]);

  if (rows.length === 0) {
    return <p className="hint">{empty ?? "Nothing here yet."}</p>;
  }

  const from = page * pageSize;
  const shown = rows.slice(from, from + pageSize);

  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={`${column.label}-${index}`}
                className={column.align === "right" ? "right" : undefined}
                style={column.width ? { width: `${column.width}px` } : undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr
              key={row.id}
              className={[row.selected ? "on" : "", row.muted ? "muted" : ""].join(" ").trim()}
              onClick={row.onSelect}
              role={row.onSelect ? "button" : undefined}
              tabIndex={row.onSelect ? 0 : undefined}
              onKeyDown={(event) => {
                if (row.onSelect && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  row.onSelect();
                }
              }}
            >
              {row.cells.map((cell, index) => (
                <td key={index} className={columns[index]?.align === "right" ? "right" : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length > 10 && (
        <div className="pager">
          <span>
            {from + 1}–{Math.min(from + pageSize, rows.length)} of {rows.length}
          </span>
          <label htmlFor="per-page" className="pager-label">
            per page
          </label>
          <select
            id="per-page"
            className="pager-select"
            value={pageSize}
            onChange={(change) => {
              setPageSize(Number(change.target.value));
              setPage(0);
            }}
          >
            {[10, 20, 30, 50, 100].map((size) => (
              <option value={size} key={size}>
                {size}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <button type="button" className="ghost small" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            {page + 1} / {pages}
          </span>
          <button
            type="button"
            className="ghost small"
            disabled={page >= pages - 1}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export function Pill({ kind, children }: { kind: "ok" | "warn" | "bad" | "plain"; children: ReactNode }) {
  const className = {
    ok: "pill pill-valid",
    warn: "pill pill-missing",
    bad: "pill pill-invalid",
    plain: "pill",
  }[kind];
  return <span className={className}>{children}</span>;
}

/** A table on the left, the selected thing on the right. */
export function Split({
  children,
  aside,
  wide = false,
}: {
  children: ReactNode;
  aside: ReactNode | null;
  wide?: boolean;
}) {
  return (
    <div className={aside ? (wide ? "split split-wide" : "split") : undefined}>
      <div className="split-main">{children}</div>
      {aside && <aside className="split-aside">{aside}</aside>}
    </div>
  );
}
