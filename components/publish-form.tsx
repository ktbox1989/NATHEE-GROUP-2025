"use client";

import { useState, type FormEvent } from "react";

/**
 * The one control that changes what the public sees.
 *
 * The server is already idempotent: every publication event carries a request
 * key with a unique index behind it, and the route answers a repeat with
 * "already_published" rather than appending a second event. This adds the half
 * that idempotency cannot provide — telling the person in front of it that the
 * first click was received. An enabled button that appears to do nothing is why
 * people click twice.
 *
 * The key is generated once when the page renders, so the two clicks of a
 * double-click carry the same key and the second is recognised as the same
 * request rather than as a new one.
 *
 * Unpublishing asks first. It is not destructive — nothing is deleted and the
 * content can be published again — but it takes a page away from every visitor,
 * and that is worth one deliberate confirmation.
 */
export function PublishForm({
  action,
  fields,
  label,
  busyLabel = "กำลังดำเนินการ…",
  confirm,
}: {
  action: string;
  fields: Record<string, string>;
  label: string;
  busyLabel?: string;
  /** When set, the action is only taken after the operator agrees to this. */
  confirm?: string;
}) {
  const [busy, setBusy] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    if (confirm && !window.confirm(confirm)) {
      event.preventDefault();
      return;
    }
    // Set after the browser has accepted the submission, never before: a button
    // disabled during the click would cancel the request it was meant to send.
    setBusy(true);
  }

  return (
    <form className="cms-inline-form" action={action} method="post" onSubmit={submit}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" disabled={busy} aria-busy={busy}>
        {busy ? busyLabel : label}
      </button>
    </form>
  );
}
