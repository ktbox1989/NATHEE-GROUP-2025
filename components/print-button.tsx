"use client";

export function PrintButton({ label = "พิมพ์ฉลากชุดนี้" }: { label?: string }) {
  return (
    <button className="button button-gradient" type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
