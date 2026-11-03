/** CardQuest mark: two cards, C and Q, overlapping. Orange behind, blue in front. */
/** The two cards, drawn into a 64-unit box. Shared by the logo and the crate. */
function MarkArt({ gap }: { gap: string }) {
  return (
    <>
      <g transform="rotate(-10 18 34)">
        <rect x="3" y="14" width="31" height="41" rx="7" fill="#ff7c01" />
        <text x="18.5" y="43" textAnchor="middle" fontFamily="Unbounded, Arial, sans-serif" fontWeight="900" fontSize="20" fill="#121212">C</text>
      </g>
      <g transform="rotate(9 45 31)">
        <rect x="30" y="10" width="31" height="41" rx="7" fill="#34cde3" stroke={gap} strokeWidth="3" paintOrder="stroke" />
        <text x="45.5" y="39.5" textAnchor="middle" fontFamily="Unbounded, Arial, sans-serif" fontWeight="900" fontSize="20" fill="#121212">Q</text>
      </g>
    </>
  );
}

export function Mark({ size = 28, gap = "#121212" }: { size?: number; gap?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-hidden="true" className="mark">
      <MarkArt gap={gap} />
    </svg>
  );
}

/** A crate with the CardQuest cards on its front: orange lid, graphite sides, the C and Q laid on the left face. */
export function CrateMark({ size = 64, gold = false }: { size?: number; gold?: boolean }) {
  const lid = gold ? "#ffd24a" : "#ff7c01";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-hidden="true" className="crate-mark">
      <path d="M5 14.5 24 25v19L5 33.5z" fill="#2b2b30" />
      <path d="M43 14.5 24 25v19l19-10.5z" fill="#1a1a1d" />
      <path d="M24 4 43 14.5 24 25 5 14.5z" fill={lid} />
      <path d="M14 9.3 33 19.8" stroke="#121212" strokeOpacity=".28" strokeWidth="2.2" />
      <path d="M5 14.5 24 25v19L5 33.5z" fill="none" stroke={lid} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M43 14.5 24 25v19l19-10.5z" fill="none" stroke={lid} strokeWidth="1.2" strokeOpacity=".55" strokeLinejoin="round" />
      <g transform="matrix(0.255 0.141 0 0.255 6.4 19.2)"><MarkArt gap="#2b2b30" /></g>
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return <span className="wordmark"><Mark size={size} /><span>CARDQUEST</span></span>;
}
