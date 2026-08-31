import type { Tone } from "../../lib/status";

const ICON: Record<Tone, string> = {
  neutral: "•",
  success: "✓",
  warning: "!",
  danger: "✕",
  info: "i",
};

const BORDER: Record<Tone, string> = {
  neutral: "border-white/10",
  success: "border-accent/30",
  warning: "border-warning/30",
  danger: "border-danger/30",
  info: "border-info/30",
};

const BG: Record<Tone, string> = {
  neutral: "bg-white/5",
  success: "bg-accent-soft",
  warning: "bg-warning-soft",
  danger: "bg-danger-soft",
  info: "bg-info-soft",
};

const TEXT: Record<Tone, string> = {
  neutral: "text-gray-200",
  success: "text-accent",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

export function Alert({
  tone = "neutral",
  title,
  children,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-4 ${BORDER[tone]} ${BG[tone]}`}>
      <div className="flex gap-3">
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${TEXT[tone]} bg-black/20`}
        >
          {ICON[tone]}
        </span>
        <div className="min-w-0 space-y-1">
          {title && <p className={`text-sm font-medium ${TEXT[tone]}`}>{title}</p>}
          <div className="text-sm text-gray-300">{children}</div>
        </div>
      </div>
    </div>
  );
}
