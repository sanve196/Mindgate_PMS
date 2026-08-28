// Pure rating-rule helpers — no db, unit-tested directly (same pattern as
// phase-machine.js). Kept separate from modules/performance/index.js so the
// actual eligibility logic (not just "does it wire up") gets tested without
// a database.

// BR-6.5: "3 consecutive A/A+ ratings, with the most recent cycle rated A+."
// See migrations/007-super50.js for the letter-grade -> numeric mapping
// this implements (A/A+ = 4 or 5; A+ specifically = 5).
// `recentRatingsDesc` = final_rating values for an employee's published
// cycles of one cycle_type, most-recent-first, already limited to the last
// 3 by the caller's query. Returns false (not throws) on incomplete history
// — fewer than 3 published cycles is simply not yet eligible, not an error.
function isSuper50Eligible(recentRatingsDesc) {
  if (!Array.isArray(recentRatingsDesc) || recentRatingsDesc.length < 3) return false;
  const top3 = recentRatingsDesc.slice(0, 3).map(Number);
  if (top3.some((v) => Number.isNaN(v))) return false;
  const allTopTier = top3.every((v) => Math.round(v) >= 4);
  const mostRecentIsTopGrade = Math.round(top3[0]) === 5;
  return allTopTier && mostRecentIsTopGrade;
}

module.exports = { isSuper50Eligible };
