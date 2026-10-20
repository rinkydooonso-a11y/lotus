/** CardQuest mark: an isometric crate with a star on the lid, in the accent purples. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 4 43 14.5 24 25 5 14.5z" fill="#b98cff" />
      <path d="M5 14.5 24 25v19L5 33.5z" fill="#7a45d6" />
      <path d="M43 14.5 24 25v19l19-10.5z" fill="#4e2a96" />
      <path d="M24 9.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="#fff" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return <span className="wordmark"><Mark size={size} /><span>CardQuest</span></span>;
}
