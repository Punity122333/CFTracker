// All tunables for the Phase 5 skill model and ranker.
// Named constants with a one-line comment each; no hardcoded numbers elsewhere.

// ---- hard window around effective ability ----
export const MAX_STRETCH = 200; // hardest allowed: difficulty <= theta_problem + this
export const MAX_BELOW = 300; // easiest allowed: difficulty >= theta_problem - this

// ---- global anchor ----
export const ESTIMATE_WINDOWS_DAYS = [120, 365]; // try 120d, then 365d, then all time
export const MIN_SOLVES_ESTIMATE = 5; // minimum rated solves inside the chosen window
export const SOLVE_PERCENTILE = 70; // percentile of solved difficulties used
export const SOLVE_MARGIN = 50; // people solve below their max; subtract this
export const CONTEST_ONLY_CAP = 1400; // contest rating alone below this is used as-is
export const CONTEST_ONLY_DISCOUNT = 200; // contest rating alone above the cap: rating minus this
export const COLD_START_RATING = 800; // global theta with no data at all
export const RATING_MIN = 800; // global theta lower clamp
export const RATING_MAX = 2800; // global theta upper clamp

// ---- recency ----
export const RECENCY_HALFLIFE_DAYS = 60; // exponential decay half-life for all evidence

// ---- per-topic ability ----
export const ELO_SCALE = 400; // logistic scale: P(solve) = 1/(1+10^((d-theta)/400))
export const SHRINKAGE_K = 4; // effective prior observations pulling theta toward the prior
export const HELP_WEIGHT = 0.4; // aided solves/failures count at this fraction of full weight
export const UNTOUCHED_PENALTY = 100; // untouched topic prior sits this far below its fallback
export const TOPIC_BELOW_CAP = 500; // theta_topic never below theta_global - this
export const TOPIC_ABOVE_CAP = 500; // theta_topic never above theta_global + this
export const SOFTMIN_TEMP = 200; // softmin temperature over a problem's topic thetas

// ---- scoring weights (fit is dominant by magnitude) ----
export const W_FIT = 10; // gaussian difficulty fit around target
export const FIT_SIGMA = 150; // gaussian width for difficulty fit
export const W_WEAK = 4; // need of a weak topic (below global / failure-heavy)
export const W_ATTEMPTED = 2; // attempted-but-never-solved bonus (post-filter only)
export const W_READINESS = 1.5; // topic is in the current study-next list
export const W_POPULARITY = 1; // mild prior for higher solvedCount at equal fit
export const DIVERSITY_SAME_TOPIC = 3; // greedy penalty per repeat of a topic in one list
export const DIVERSITY_SAME_CONTEST = 2; // greedy penalty per repeat of a contest in one list

// ---- target window ----
export const TARGET_OFFSET = 100; // default target = theta_problem + this (~50-65% solve chance)
export const TARGET_WINDOW_LO = 50; // displayed window = [target - this, target + TARGET_WINDOW_HI]
export const TARGET_WINDOW_HI = 100; // displayed window = [target - TARGET_WINDOW_LO, target + this]

// ---- adaptive ramp (per topic) ----
export const RAMP_UP_STREAK = 3; // consecutive unaided near-target solves before raising offset
export const RAMP_DOWN_STREAK = 2; // consecutive failures/stuck before lowering offset
export const RAMP_STEP = 50; // offset moves by this much

// ---- study-next eligibility ----
export const STUDY_NEXT_MARGIN = 200; // topic eligible when rangeLo <= global + stretch + this
export const PRACTICE_THRESHOLD_DEFAULT = 5; // topics with this many solves leave study-next

// ---- topic solve weighting for status ----
export const TOPIC_FLOOR_MARGIN = 200; // solve counts fully when difficulty >= rangeLo - this
export const TOPIC_EASY_WEIGHT = 0.3; // easier solves count at this fraction

// ---- daily problem ----
export const DAILY_TOP_K = 20; // seeded pick is drawn from the top K by score

// ---- solvedCount sanity filter (optional, off by default) ----
export const SOLVED_COUNT_FLOOR = 100; // cf problems below this many solves look mis-rated

// ---- trainer Leitner boxes ----
export const TRAINER_BOX_INTERVALS = [1, 3, 7, 14, 30]; // days until due per box 1-5
export const TRAINER_MAX_BOX = 5; // highest Leitner box

// ---- feedback on recommendations (easy / right / hard) ----
export const FEEDBACK_WEIGHT = 0.5; // an "easy" counts as an extra solve at this weight
export const FEEDBACK_RIGHT_WEIGHT = 0.2; // a "right" adds confidence-only evidence at this weight
export const FEEDBACK_FAIL_WEIGHT = 0.5; // a "hard" counts as partial failure evidence at this weight
export const FEEDBACK_NUDGE = 25; // target offset moves by this per easy/hard feedback
export const FEEDBACK_MAX_DRIFT = 50; // max feedback offset movement per topic per week

// ---- solve quality (editorial-assisted solves as partial evidence) ----
export const SOLVE_WEIGHT_TAG_HINT = 0.9; // tags hint (ladder step 1) used
export const SOLVE_WEIGHT_HINT2 = 0.7; // rating hint (ladder step 2) used
export const SOLVE_WEIGHT_EDITORIAL = 0.4; // editorial opened before solving
export const SOLVE_WEIGHT_ASSISTED = 0.25; // solved only with accepted code or help, no logic written

// ---- in-contest evidence ----
export const IN_CONTEST_WINDOW_HOURS = 3; // submissions within this of contest end count as in-contest
export const IN_CONTEST_SOLVE_BONUS = 1.25; // in-contest solve evidence multiplier (time-limited)
export const IN_CONTEST_FAIL_WEIGHT = 1.0; // in-contest failure evidence weight
export const UPSOLVE_WEIGHT = 0.5; // later solve evidence weight
export const UPSOLVE_HALFLIFE_DAYS = 30; // upsolve weight decays with days after the contest

// ---- next rung ----
export const RUNG_STEP = 75; // next-rung difficulty step above the solved problem

// ---- mistake patterns ----
export const MISTAKE_WINDOW_DAYS = 60; // mistake pattern window
export const MISTAKE_DOMINANT_SHARE = 0.35; // share triggering the dominant-category notice
export const MISTAKE_MIN_COUNT = 5; // minimum mistakes before the notice shows
export const MISTAKE_BIAS = 0.5; // ranker bonus for dominant-mistake topics (post-filter only)

// ---- weekly plan ----
export const PLAN_WEAK_COUNT = 3; // plan problems from weakest topics (scaled by weekly goal)
export const PLAN_NEW_TOPIC_COUNT = 2; // practice problems for the new study-next topic
export const PLAN_MAX_REVIEWS_PER_DAY = 3; // spaced-repetition reviews cap per day
export const PLAN_TRAINER_SESSIONS = 2; // trainer sessions per week
export const PLAN_STRETCH_COUNT = 1; // stretch problems per week
export const PLAN_REVISIT_COUNT = 2; // stuck-list problems per week
export const PLAN_MAX_PER_DAY = 4; // hard cap of plan items per day
export const PLAN_REST_DAY = 6; // 0=monday: default lighter day index

// ---- warmup ----
export const WARMUP_BELOW = 150; // warmup target sits this far below global theta
export const WARMUP_COUNT = 3; // problems per warmup session
export const WARMUP_DEFAULT_MINUTES = 30; // default warmup countdown length
