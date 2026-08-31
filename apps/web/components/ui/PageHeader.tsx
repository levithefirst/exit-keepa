export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-gray-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}
