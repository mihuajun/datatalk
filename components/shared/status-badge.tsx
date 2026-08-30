import type { ReactNode } from "react";

type StatusBadgeProps = {
  tone?: "brand" | "success" | "warning" | "neutral";
  children: ReactNode;
};

const toneMap: Record<NonNullable<StatusBadgeProps["tone"]>, string> = {
  brand: "bg-[#edf3ff] text-[#2167e8]",
  success: "bg-[#eaf8f2] text-[#16845b]",
  warning: "bg-[#fff6e8] text-[#b86b11]",
  neutral: "bg-[#f2f5f9] text-[#526174]",
};

export function StatusBadge({ tone = "neutral", children }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${toneMap[tone]}`}
    >
      {children}
    </span>
  );
}
