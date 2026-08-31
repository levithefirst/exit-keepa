/**
 * Progressive disclosure for technical detail (calldata, decoded args,
 * Roles conditions) that advanced users want available but that shouldn't
 * compete with the plain-language summary for visual attention.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group rounded-xl border border-white/10 bg-surface" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-gray-300 hover:text-white">
        {summary}
        <span className="text-gray-500 transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-white/10 p-4">{children}</div>
    </details>
  );
}
