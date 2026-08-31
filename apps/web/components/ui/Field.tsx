import type { InputHTMLAttributes } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-300">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      className={`w-full rounded-lg border border-white/15 bg-surface px-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-600 outline-none transition-colors focus:border-accent/50 ${className}`}
      {...rest}
    />
  );
}
