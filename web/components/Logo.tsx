/** CardQuest mark: the CQ monogram in its brand ring. */
export function Mark({ size = 28 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.png" width={size} height={size} alt="" aria-hidden="true" className="mark" style={{ borderRadius: "50%" }} />;
}

export function Logo({ size = 24 }: { size?: number }) {
  return <span className="wordmark"><Mark size={size} /><span>CardQuest</span></span>;
}
