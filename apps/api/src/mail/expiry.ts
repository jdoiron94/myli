// The instance has no time zone setting, so an email gives a link's expiry in UTC, and says so. A
// 24-hour clock reads the same everywhere: "November 21, 2026 at 23:12 UTC".
const EXPIRY_FORMAT = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

/** When a link in an email stops working, as the email says it. */
export function formatExpiry(at: Date): string {
  return EXPIRY_FORMAT.format(at);
}
