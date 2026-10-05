/**
 * Small stroke icons, drawn inline so the rail still reads when it is
 * narrowed to a strip. A column of identical dots is not navigation.
 */
const PATHS: Record<string, string> = {
  home: "M3 7.5 8 3.5l5 4V13H3z",
  doc: "M4 2h5l3 3v9H4zM9 2v3h3",
  list: "M3 4h10M3 8h10M3 12h7",
  check: "M3 8.5 6 11.5 13 4.5",
  close: "M4 4l8 8M12 4l-8 8",
  rows: "M2.5 4h11v8h-11zM2.5 7.5h11M6 4v8",
  chart: "M3 13V7M8 13V3M13 13v-4",
  risk: "M8 2.5 14 13H2zM8 7v3M8 11.5v.5",
  case: "M3 5h10v8H3zM6 5V3h4v2",
  gherkin: "M3 3h10v10H3zM6 6l2 2-2 2M9.5 10H12",
  shield: "M8 2.5 13 4v4c0 3-2.5 5-5 5.5C5.5 13 3 11 3 8V4z",
  stack: "M8 2.5 14 6l-6 3.5L2 6zM2 10l6 3.5L14 10",
  upload: "M8 11V3M5 6l3-3 3 3M3 13h10",
  explore: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM10 6 9 9l-3 1 1-3z",
  code: "M6 4 2.5 8 6 12M10 4l3.5 4L10 12",
  play: "M5 3.5 12.5 8 5 12.5z",
  device: "M5 2h6v12H5zM7 12.5h2",
  bug: "M5.5 6a2.5 2.5 0 0 1 5 0v4a2.5 2.5 0 0 1-5 0zM3 7h2.5M10.5 7H13M3 11h2.5M10.5 11H13",
  wrench: "M11 3a3 3 0 0 0-3.6 4.1L3 11.5 4.5 13l4.4-4.4A3 3 0 0 0 13 5z",
  report: "M4 2h5l3 3v9H4zM6 8h4M6 11h3",
  dash: "M2.5 3h5v4h-5zM9.5 3h4v7h-4zM2.5 9h5v4h-5z",
  book: "M3 3h4.5A1.5 1.5 0 0 1 9 4.5V13H4.5A1.5 1.5 0 0 1 3 11.5zM13 3H9v10h4z",
  chat: "M3 4h10v6H7l-3 2.5V10H3z",
  folder: "M2.5 4.5h4l1 1.5h6v6h-11z",
  gear: "M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M4 4l1 1M11 11l1 1M12 4l-1 1M5 11l-1 1",
};

export default function Icon({ name }: { name: string }) {
  const path = PATHS[name] ?? PATHS["list"];
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="icon">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
