export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 px-6 py-10 text-center">
      <p className="text-sm font-medium text-gray-300">{title}</p>
      {description && <p className="mx-auto mt-1.5 max-w-sm text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
