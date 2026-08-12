/**
 * The dispatch clock.
 *
 * The site's one shipping promise, stated in several places: an order placed
 * before 5pm ET on a business day leaves the warehouse the next business day.
 * This module turns that promise into a live sentence ("Order within 2h 14m
 * and it ships tomorrow"), so the announcement banner and the PDP shipping
 * line can show a deadline that is actually approaching rather than a static
 * rule the visitor has to work out for themselves.
 *
 * Everything is computed in Eastern time via Intl, so the countdown is right
 * for a visitor in any timezone without shipping a timezone library. Holidays
 * are not modelled; neither is the promise they would qualify.
 */

/** 5pm ET, in minutes since midnight. */
const CUTOFF_MINUTES = 17 * 60;

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/*
 * One formatter, reused. Constructing Intl.DateTimeFormat is the expensive
 * part; formatting with it is cheap enough to run on an interval.
 */
const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

/** Weekday index and minutes-since-midnight for `now`, in Eastern time. */
function etParts(now: Date): { weekday: number; minutes: number } {
  const parts = ET.formatToParts(now);
  const get = (type: string) =>
    parts.find(part => part.type === type)?.value ?? '';
  const weekday = WEEKDAY_INDEX[get('weekday')] ?? 0;
  // `% 24` guards against engines that render midnight as "24" despite h23.
  const hour = Number(get('hour')) % 24;
  return { weekday, minutes: hour * 60 + Number(get('minute')) };
}

/** Monday after a Friday or a weekend day; otherwise simply the next day. */
function nextBusinessDay(weekday: number): number {
  return weekday >= 1 && weekday <= 4 ? weekday + 1 : 1;
}

/**
 * The live shipping sentence for `now`.
 *
 * Before a business-day cutoff: "Order within 2h 14m and it ships tomorrow"
 * (or "ships Monday", from a Friday). After the cutoff, or on a weekend, the
 * countdown would be to a deadline most visitors are not waiting on, so it
 * states the outcome instead: "Orders placed now ship Wednesday", the business
 * day after the next cutoff the order can make.
 *
 * No trailing period, so the banner can use it bare and a sentence context can
 * add its own.
 */
export function shipCutoffMessage(now: Date = new Date()): string {
  const { weekday, minutes } = etParts(now);
  const beforeCutoff =
    weekday >= 1 && weekday <= 5 && minutes < CUTOFF_MINUTES;

  if (beforeCutoff) {
    const remaining = CUTOFF_MINUTES - minutes;
    const hours = Math.floor(remaining / 60);
    const clock = hours > 0 ? `${hours}h ${remaining % 60}m` : `${remaining}m`;
    const shipLabel =
      weekday <= 4 ? 'tomorrow' : DAY_NAMES[nextBusinessDay(weekday)];
    return `Order within ${clock} and it ships ${shipLabel}`;
  }

  // The order will be processed at the next business day's cutoff and ship
  // the business day after that. Friday evening and the weekend both resolve
  // to "processed Monday, ships Tuesday".
  const processDay = nextBusinessDay(weekday);
  return `Orders placed now ship ${DAY_NAMES[nextBusinessDay(processDay)]}`;
}

/**
 * Run `update` now and keep it current.
 *
 * A 30 second interval keeps the minute display honest without doing per-second
 * work for a value that only changes once a minute. The visibility listener
 * covers the tab that slept through its interval: browsers throttle timers in
 * background tabs, and a countdown that resumes stale on return would read as
 * broken.
 */
export function onShipCutoffTick(update: (message: string) => void): void {
  const tick = () => update(shipCutoffMessage());
  tick();
  window.setInterval(tick, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
}
