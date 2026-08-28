// Pure timing logic for Quarterly Connect reminders (BR-4.4) — no db, so
// the actual "when is this due" decision is unit-tested directly, same
// pattern as phase-machine.js and rating-rules.js. The DB-touching
// orchestration (finding employees, sending notifications) lives in
// modules/performance/index.js and is covered by an integration test
// instead, matching this codebase's established split.

const DEFAULT_CADENCE_DAYS = 90;   // "quarterly"
const DEFAULT_COOLDOWN_DAYS = 7;   // don't re-remind more than once a week

function daysBetween(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

// lastConnectDate: Date|null (null = never held one). today: Date.
function isConnectDue(lastConnectDate, today, cadenceDays = DEFAULT_CADENCE_DAYS) {
  if (!lastConnectDate) return true; // never held one — always due
  return daysBetween(lastConnectDate, today) >= cadenceDays;
}

// lastReminderDate: Date|null. Returns whether it's safe to send another
// reminder now (either never reminded, or the cooldown has elapsed).
function shouldRemindAgain(lastReminderDate, today, cooldownDays = DEFAULT_COOLDOWN_DAYS) {
  if (!lastReminderDate) return true;
  return daysBetween(lastReminderDate, today) >= cooldownDays;
}

module.exports = { isConnectDue, shouldRemindAgain, DEFAULT_CADENCE_DAYS, DEFAULT_COOLDOWN_DAYS };
