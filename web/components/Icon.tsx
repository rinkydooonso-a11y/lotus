/** Line icons drawn on a 24px grid with a 1.8 stroke, so every glyph in the UI shares one weight. */
const PATHS = {
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  menu: <path d="M4 8h16M4 16h16" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  back: <path d="m15 6-6 6 6 6" />,
  arrow: <path d="M7 17 17 7M9 7h8v8" />,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  locate: <path d="M20.5 3.5 3.5 10.6l7.1 2.8 2.8 7.1z" fill="currentColor" />,
  sidebar: <><rect x="3" y="4.5" width="18" height="15" rx="3" /><path d="M9.5 4.5v15" /></>,
  cube: <><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></>,
  ticket: <><path d="M4 7a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 7v2.5a2.5 2.5 0 0 0 0 5V17a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17v-2.5a2.5 2.5 0 0 0 0-5z" /><path d="M14.5 6v1.5M14.5 11v2M14.5 16.5V18" /></>,
  shard: <path d="M7 4.5h10l4 4.8L12 20 3 9.3zM3 9.3h18M10.2 4.5 8.6 9.3 12 20l3.4-10.7-1.6-4.8" />,
  card: <><rect x="6" y="3" width="12" height="18" rx="2.5" /><path d="M9 7h6" /></>,
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><rect x="4" y="7.5" width="16.5" height="12" rx="2.5" /><circle cx="16.5" cy="13.5" r="1.2" fill="currentColor" stroke="none" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.6 5.3 3.6 8.5s-1 6.1-3.6 8.5c-2.6-2.4-3.6-5.3-3.6-8.5s1-6.1 3.6-8.5z" /></>,
  phone: <><rect x="6.5" y="3" width="11" height="18" rx="2.5" /><path d="M11 18h2" /></>,
  x: <path fill="currentColor" stroke="none" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.2h1.7L7.4 4.7H5.58l11.09 14.5Z" />,
  replay: <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4.5H9" />,
  alert: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5.5M12 16.2v.3" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : "icon"} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

/** The crate as players see it on the map, flat-shaded; gold for ticket crates. */
export function CrateGlyph({ size = 28, gold = false }: { size?: number; gold?: boolean }) {
  const [top, left, right] = gold ? ["#ffe08f", "#e0a92d", "#a8771a"] : ["#c4a3ff", "#8a55f0", "#5b31b3"];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 4 43 14.5 24 25 5 14.5z" fill={top} />
      <path d="M5 14.5 24 25v19L5 33.5z" fill={left} />
      <path d="M43 14.5 24 25v19l19-10.5z" fill={right} />
      <path d="M14 9.3 33 19.8v4.4L14 13.7z" fill="rgba(255,255,255,.85)" />
      <path d="M22.6 24.2 24 25l1.4-.8v19l-1.4.8-1.4-.8z" fill="rgba(255,255,255,.85)" />
    </svg>
  );
}
