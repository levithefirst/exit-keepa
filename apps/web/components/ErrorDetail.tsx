import { humanizeError } from "../lib/humanizeError";

/** A failure message, shown as a short human sentence with the exact raw
 * text available on request - never hidden, just never the headline. */
export function ErrorDetail({ message, className = "" }: { message: string; className?: string }) {
  const { summary, showRaw } = humanizeError(message);
  return (
    <div className={className}>
      <p className="text-pretty text-xs text-danger">{summary}</p>
      {showRaw && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-cream-400 hover:text-cream-300">Show exact error</summary>
          <p className="mt-1 break-all font-mono text-[11px] text-cream-400">{message}</p>
        </details>
      )}
    </div>
  );
}
