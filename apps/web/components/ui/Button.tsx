import Link from "next/link";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-black hover:bg-accent-dim disabled:hover:bg-accent",
  secondary: "border border-white/15 text-gray-200 hover:border-white/30 hover:bg-white/5",
  danger: "border border-danger/40 text-danger hover:bg-danger-soft",
  ghost: "text-gray-400 hover:text-white",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md") {
  return `inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  return <button className={`${buttonClasses(variant, size)} ${className}`} {...props} />;
}

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
  external,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={`${buttonClasses(variant, size)} ${className}`}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={`${buttonClasses(variant, size)} ${className}`}>
      {children}
    </Link>
  );
}
