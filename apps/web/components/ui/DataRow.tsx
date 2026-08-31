/** A label/value row for technical data (addresses, calldata, selectors). */
export function DataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-white/5 py-2 last:border-0 sm:flex-row sm:gap-4">
      <span className="shrink-0 text-xs text-gray-500 sm:w-32">{label}</span>
      <span className="data-mono min-w-0 break-all font-mono text-xs text-gray-300">{children}</span>
    </div>
  );
}
