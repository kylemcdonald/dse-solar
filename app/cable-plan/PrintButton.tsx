"use client";

export function PrintButton({ className }: { className?: string }) {
  return (
    <button className={className} type="button" onClick={() => window.print()}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z" />
      </svg>
      Print cut sheet
    </button>
  );
}
