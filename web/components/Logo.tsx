/** CardQuest mark: a CQ monogram in the brand blue-to-orange gradient. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="mark"><defs><linearGradient id="cqm" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2f8bff"/><stop offset=".5" stop-color="#ff5a4a"/><stop offset="1" stop-color="#ff9a3c"/></linearGradient></defs><g fill="none" stroke="url(#cqm)" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"><rect x="5" y="9" width="24" height="30" rx="4" transform="rotate(-8 17 24)"/><rect x="19" y="9" width="24" height="30" rx="4" transform="rotate(8 31 24)"/><path d="M17 20h-4v8h4M28 31l8 7M31 20h4v8h-4z"/></g></svg>
  );
}

export function Logo({ size = 24 }: { size?: number }) {
  return <span className="wordmark"><Mark size={size} /><span>CardQuest</span></span>;
}
