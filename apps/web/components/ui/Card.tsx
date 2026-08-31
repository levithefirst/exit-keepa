export function Card({
  interactive,
  className = "",
  children,
  as: As = "div",
}: {
  interactive?: boolean;
  className?: string;
  children: React.ReactNode;
  as?: "div" | "section";
}) {
  return (
    <As
      className={`rounded-xl border border-white/10 bg-surface p-5 ${
        interactive ? "transition-colors hover:border-accent/40" : ""
      } ${className}`}
    >
      {children}
    </As>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="font-semibold text-white">{title}</h2>
        {description && <p className="mt-1 text-sm text-gray-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}
