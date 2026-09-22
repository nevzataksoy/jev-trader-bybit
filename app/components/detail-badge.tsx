"use client";

import type { ReactNode } from "react";

export function DetailBadge({
  label,
  children,
  tone = "neutral",
  className = "",
}: {
  label: string;
  children: ReactNode;
  tone?: "neutral" | "info" | "warning" | "success";
  className?: string;
}) {
  return (
    <details className={`detail-badge detail-badge--${tone} ${className}`.trim()}>
      <summary>
        <span>{label}</span>
        <i aria-hidden="true">⌄</i>
      </summary>
      <div className="detail-badge__popover">{children}</div>
    </details>
  );
}
