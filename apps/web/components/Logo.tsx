/**
 * Icon + wordmark lockup. The icon is a standard exit/door glyph (reads
 * instantly, no legend needed); the wordmark carries a slight whole-lockup
 * tilt and two small corner accent marks for a touch of hand-set character
 * without risking illegibility at nav-bar sizes.
 */
export function Logo({
  iconClassName = "h-6 w-6",
  textClassName = "text-lg",
  className = "",
}: {
  iconClassName?: string;
  textClassName?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`shrink-0 text-mint-400 ${iconClassName}`}
        aria-hidden="true"
      >
        <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
        <path d="M11 12h9" />
        <path d="m16.5 8.5 3.5 3.5-3.5 3.5" />
      </svg>
      <span
        className={`relative inline-flex -rotate-1 items-baseline font-display font-extrabold leading-none tracking-tight ${textClassName}`}
      >
        <span className="text-cream-50">Exit</span>
        <span className="ml-1.5 text-mint-400">Keepa</span>
        <svg
          viewBox="0 0 24 24"
          className="absolute -right-3 -top-2.5 h-3 w-3 rotate-45 text-cream-100/25"
          aria-hidden="true"
        >
          <path d="M4 16 Q4 4 16 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <svg
          viewBox="0 0 24 24"
          className="absolute -bottom-2 -left-3 h-3 w-3 -rotate-[135deg] text-cream-100/25"
          aria-hidden="true"
        >
          <path d="M4 16 Q4 4 16 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    </span>
  );
}
