import type { ReactNode, SVGProps } from "react";

/** One line-icon set for the whole site: 24px grid, round caps, drawn in currentColor. */
type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P & { children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{children}</svg>;
}

export const IconPlay = (p: P) => <Svg {...p}><path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5Z" fill="currentColor" stroke="none" /></Svg>;
export const IconPause = (p: P) => <Svg {...p}><rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" /></Svg>;
export const IconReplay = (p: P) => <Svg {...p}><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v3.6h3.6" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></Svg>;
export const IconChevronRight = (p: P) => <Svg {...p}><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></Svg>;
export const IconChevronLeft = (p: P) => <Svg {...p}><path d="M14.5 5.5 8 12l6.5 6.5" /></Svg>;
export const IconChevronDown = (p: P) => <Svg {...p}><path d="m5.5 9.5 6.5 6.5 6.5-6.5" /></Svg>;
export const IconArrowUpRight = (p: P) => <Svg {...p}><path d="M7.5 16.5l9-9M9 7.5h7.5V15" /></Svg>;
export const IconCopy = (p: P) => <Svg {...p}><rect x="8.5" y="8.5" width="11" height="11" rx="2.6" /><path d="M15.5 8.5V7a2.5 2.5 0 0 0-2.5-2.5H7A2.5 2.5 0 0 0 4.5 7v6A2.5 2.5 0 0 0 7 15.5h1.5" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const IconMenu = (p: P) => <Svg {...p}><path d="M4.5 8.5h15M4.5 15.5h15" /></Svg>;
export const IconLocate = (p: P) => <Svg {...p}><path d="M20 4 4.6 10.4a.5.5 0 0 0 .05.94L11 13l1.66 6.35a.5.5 0 0 0 .94.05Z" fill="currentColor" fillOpacity=".18" /></Svg>;
export const IconExpand = (p: P) => <Svg {...p}><path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15" /></Svg>;
export const IconGlobe = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c2.2 2.3 3.3 5 3.3 8s-1.1 5.7-3.3 8c-2.2-2.3-3.3-5-3.3-8s1.1-5.7 3.3-8Z" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5.2" /><circle cx="12" cy="16.2" r=".4" fill="currentColor" /></Svg>;
export const IconCoin = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.6" /><path d="M12 9.6v4.8" /></Svg>;
export const IconX = ({ size = 15, ...p }: P) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...p}><path fill="currentColor" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.2h1.7L7.4 4.7H5.58l11.09 14.5Z" /></svg>;

/** Shard: a faceted blue gem. */
export function Shard({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="gem">
      <path d="M12 2.5 20 9l-8 12.5L4 9z" fill="#34cde3" />
      <path d="M12 2.5 20 9h-8z" fill="#a6eef8" />
      <path d="M12 2.5 4 9h8z" fill="#6ed8ea" />
      <path d="M4 9h8v12.5z" fill="#1d8fa3" />
    </svg>
  );
}

/** Ticket: gold stub with a notch on each side. */
export function Ticket({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="ticket-ico">
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h14a1.5 1.5 0 0 1 1.5 1.5V10a2 2 0 0 0 0 4v2.5A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5V14a2 2 0 0 0 0-4z" fill="#f2c14e" />
      <path d="M15 6.6v10.8" stroke="#a8771a" strokeWidth="1.4" strokeDasharray="1.6 1.6" />
    </svg>
  );
}

/** Isometric crate glyph, in purple or (ticket crates) gold. */
export function CrateGlyph({ size = 32, gold = false }: { size?: number; gold?: boolean }) {
  const [lid, l, r] = gold ? ["#ffe08f", "#e0a92d", "#a8771a"] : ["#ff7c01", "#34cde3", "#1d8fa3"];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 4 43 14.5 24 25 5 14.5z" fill={lid} />
      <path d="M5 14.5 24 25v19L5 33.5z" fill={l} />
      <path d="M43 14.5 24 25v19l19-10.5z" fill={r} />
      <path d="M14 9.3 33 19.8v4.4L14 13.7z" fill="#121212" />
      <path d="M22.6 24.2 24 25l1.4-.8v19l-1.4.8-1.4-.8z" fill="#121212" />
    </svg>
  );
}
