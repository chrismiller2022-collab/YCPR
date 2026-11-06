// Overnight quiet hours: no paper trading, market recording or ProphetX listening between 9pm and 9am Eastern, when
// markets barely move and every run still costs database reads. BOT_QUIET_HOURS overrides the window as "start-end"
// in Eastern hours (e.g. "22-8"), or "off" to run around the clock.
const DEFAULT_WINDOW = "21-9";

function easternHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(now));
}

export function isQuietHours(now: Date = new Date(), window: string = process.env.BOT_QUIET_HOURS ?? DEFAULT_WINDOW): boolean {
  if (window.trim().toLowerCase() === "off") return false;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(window.trim());
  if (!m) return false;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const h = easternHour(now);
  return start <= end ? h >= start && h < end : h >= start || h < end;
}
