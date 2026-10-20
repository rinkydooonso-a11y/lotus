/** CardQuest mark: a tilted card with a compass star. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="cq-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c69bff" /><stop offset="1" stopColor="#7b3dff" /></linearGradient>
      </defs>
      <rect x="7" y="3.5" width="18" height="25" rx="4" transform="rotate(-10 16 16)" fill="url(#cq-g)" />
      <path d="M16 9.5l1.7 4.8 4.8 1.7-4.8 1.7L16 22.5l-1.7-4.8L9.5 16l4.8-1.7z" fill="#fff" />
    </svg>
  );
}

export function Logo() {
  return <span className="logo"><Mark /><span>Card<b>Quest</b></span></span>;
}
