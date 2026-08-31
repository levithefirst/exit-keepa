import type { Tone } from "../../lib/status";
import { TONE_CLASSES } from "../../lib/status";

export function Badge({
  tone = "neutral",
  pending,
  children,
}: {
  tone?: Tone;
  pending?: boolean;
  children: React.ReactNode;
}) {
  const c = TONE_CLASSES[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${c.bg} ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot} ${pending ? "animate-pulse" : ""}`} />
      {children}
    </span>
  );
}
