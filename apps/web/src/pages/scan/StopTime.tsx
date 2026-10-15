// When a run stopped, next to its stop message. Two runs can stop with the same words (a run
// that fails again fails the same way), so the time is what shows the stop is the new run's. It
// is shown in the browser's own locale and time zone, with seconds, and with the date when it
// was not today.

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function formatStopTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  return new Intl.DateTimeFormat(undefined, {
    ...(sameDay(at, now) ? {} : { dateStyle: "medium" }),
    timeStyle: "medium",
  }).format(at);
}

export function StopTime({ at }: { at: string | null }) {
  if (!at) return null;
  return (
    <span>
      Ended <time dateTime={at}>{formatStopTime(at)}</time>
    </span>
  );
}
