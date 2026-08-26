"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const PendingContext = createContext(false);

/**
 * Native CMS mutation form with an honest pending state.
 *
 * The inputs stay enabled so the browser submits their values. Only submit
 * controls are disabled after the accepted submit event; the endpoint remains
 * responsible for validation, persistence and the redirect that reloads D1.
 */
export function PendingForm({
  action,
  className,
  children,
  busyMessage = "กำลังบันทึก รอการยืนยันจากระบบ…",
}: {
  action: string;
  className?: string;
  children: ReactNode;
  busyMessage?: string;
}) {
  const [busy, setBusy] = useState(false);

  function submit() {
    setBusy(true);
  }

  return (
    <PendingContext.Provider value={busy}>
      <form action={action} method="post" className={className} onSubmit={submit} aria-busy={busy}>
        {children}
        {busy && <p className="cms-pending-message" role="status" aria-live="polite">{busyMessage}</p>}
      </form>
    </PendingContext.Provider>
  );
}

export function PendingSubmitButton({
  children,
  busyLabel = "กำลังบันทึก…",
  className,
}: {
  children: ReactNode;
  busyLabel?: string;
  className?: string;
}) {
  const busy = useContext(PendingContext);
  return <button className={className} type="submit" disabled={busy} aria-busy={busy}>{busy ? busyLabel : children}</button>;
}
