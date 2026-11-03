/** CardQuest mark: two cards, C and Q, overlapping. Orange behind, blue in front. */
export function Mark({ size = 28, gap = "#121212" }: { size?: number; gap?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-hidden="true" className="mark" style={{ ["--logo-gap" as string]: gap }}>
      <g transform="rotate(-10 18 34)">
        <rect x="3" y="14" width="31" height="41" rx="7" fill="#ff7c01" />
        <text x="18.5" y="43" textAnchor="middle" fontFamily="Unbounded, Arial, sans-serif" fontWeight="900" fontSize="20" fill="#121212">C</text>
      </g>
      <g transform="rotate(9 45 31)">
        <rect x="30" y="10" width="31" height="41" rx="7" fill="#34cde3" stroke="var(--logo-gap)" strokeWidth="3" paintOrder="stroke" />
        <text x="45.5" y="39.5" textAnchor="middle" fontFamily="Unbounded, Arial, sans-serif" fontWeight="900" fontSize="20" fill="#121212">Q</text>
      </g>
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return <span className="wordmark"><Mark size={size} /><span>CARDQUEST</span></span>;
}
