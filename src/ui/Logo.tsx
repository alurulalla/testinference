/**
 * The mark: two lines of text, and a third that leaves the paragraph and
 * becomes a tick. Written words in, something checkable out.
 *
 * Drawn rather than loaded, so it is one colour that follows the theme
 * and there is no file to go missing.
 */
export default function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      aria-hidden="true"
      className="logo"
    >
      <rect x="96" y="96" width="832" height="832" rx="208" fill="currentColor" />
      <g
        fill="none"
        stroke="var(--surface)"
        strokeWidth="74"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M300 372h260" />
        <path d="M300 492h170" />
        <path d="M300 648l132 132 316-428" />
      </g>
    </svg>
  );
}
