// D Sonar's signal model, sonar-7: one sealed snapshot in, one ranked board out.
//
// The board ranks pre-token protocols by what their token would be worth if the
// protocol's record stayed as it is. The value is not a prediction of a launch;
// it is the entry's own claim, built only from the snapshot's figures.
//
//   curve             = Theil-Sen log-log fit of market cap on TVL over the
//                       snapshot's OWN live-token protocols with a positive
//                       market cap (128 of 144; the 16 that record $0 or less
//                       are dead tokens and are excluded from every fit)
//                         log10(mcap) = intercept + slope x log10(tvl)
//                       fitted at run time from the snapshot, never hardcoded
//   curve multiple    = curve(tvl) / tvl, clamped to [0.01, 2.0]
//   growth            = clamp(change_7d, -60, 120) per cent
//   growthMult        = 1 + (growth / 100) x 0.25
//   age               = days since listed_at (null when the snapshot names none)
//   ageMult           = 10 ^ (k x (log10(age + 1) - median log10(age + 1))),
//                       k the least-squares slope of the curve's log residual
//                       on centred log10(age + 1), shrunk to +/-0.05; 1 when
//                       the protocol carries no age
//   implied           = max(1, round(tvl x curve multiple x growthMult x ageMult))
//   range             = the same TVL carried through the p25-p75 multiples of
//                       the protocol's nearest live-token peers in its own
//                       category (up to five, nearest in log TVL); with fewer
//                       than two peers the range is the model's own typical
//                       out-of-sample error (x3.49) around the point estimate
//   score             = an explainable 0-100 composite, four sub-scores of
//                       0-25 each: scale (log TVL over the board's range),
//                       momentum (seven-day growth over the growth band),
//                       maturity (log age over the board's oldest), confidence
//                       (peer count times one minus the peers' multiple
//                       spread). The score presents the same figures the value
//                       already uses; it never changes the implied value.
//
// Why a curve, not a category median (sonar-2): the curve was tested out of
// sample before it was shipped. Five-fold cross-validation on 103 live-token
// protocols, then one 25-protocol holdout touched once, after selection:
//   model                              CV median abs error   holdout
//   sonar-6 (curve + growth + age)     85.6%                 82.7%
//   sonar-5 (curve + growth + age)     85.6%                 82.7%
//   sonar-4 (curve + growth + age)     85.6%                 82.7%
//   sonar-3 (curve + growth 0.25)      85.1%                 82.7%
// The range and the score are new in sonar-5 and do not move the point
// estimate: the value is still the sonar-4 number, and the CV above is
// sonar-4's, re-labelled. What they add is auditability — the range says
// how wide the category's own multiples spread around the point, and the
// score says, in four named parts, why a row ranks where it does. Sonar-6
// keeps the same value and adds mechanism-aware farm playbooks: the weekly
// action and the claim step now follow the protocol's own mechanism (lending,
// DEX, vault, perps, prediction, bridge, staking) instead of one template
// for all 198 rows. The playbooks do not move the point estimate either.
//   curve only (Theil-Sen)             85.0%                 82.3%
//   OLS curve                          86.0%                 -
//   category median                    90.6%                 -
//   global median                      91.4%                 85.5%
//   sonar-2 (median + growth + age)    92.3%                 84.5%
//   TVL only (multiple 1.0)            411.8%                141.3%
// The curve beats every median by about 5 points of median error and halves
// the typical error (x3.5 against x5.0). Growth is kept at quarter weight
// because out of sample it costs 0.1 points (85.1% vs 85.0%) and keeps the
// seven-day momentum the criteria ask for. Maturity (age) enters through a
// fitted multiplier: the age signal is weak (correlation about -0.05 between
// log age and the curve's log residual), so the slope is shrunk to +/-0.05
// and costs 0.5 points of CV median error (85.6% vs 85.1%) while the holdout
// is unchanged (82.7%) — the value now follows from TVL, growth and age, the
// three figures the criteria name, and 33 of the 128 training protocols carry
// no listed_at date, so the age input is missing for a quarter of the fit and
// those protocols get no age adjustment. Age also decides the farm hold and is
// shown per row. A category-shrinkage variant (curve x category factor) was
// tested and dropped too: 88.1%, worse than the plain global curve. The full
// table is in VALIDATION_CV and in the validation.json the program writes.
//
// Farm economics: every farm plan is netted, not just costed.
//   P(launch and rewards farmers) = 0.30 + 0.40 x log10(tvl / $50M) / 2,
//                                   clamped to [0.30, 0.70]
//   farmer pool  = implied value x P x 10% (the farmers' share of the token)
//   per-farmer EV = farmer pool / 50,000 farmers (a stated reference count)
//   total cost   = gas ($3 first transaction + $8/$4 setup + $2 a week
//                  + $2 to claim) + the capital's opportunity cost (5% a year
//                  over the hold)
//   net EV       = per-farmer EV - total cost
//   break-even   = the farmer count at which the expected reward equals the
//                  cost: farmer pool / total cost
//   break-even   = the farmer count at which the expected reward equals the
//                  cost: farmer pool / total cost
//   rating       = A (breaks even with 100,000 farmers), B (25,000),
//                  C (10,000), Skip (fewer). The rating follows the
//                  break-even count, not the net at the reference count, so
//                  it does not depend on how many farmers turn up; the net
//                  at the 50,000-farmer reference is shown beside it as the
//                  scenario that count implies.
// No protocol name is ever special-cased: the same functions score every row,
// and the dashboard prints the curve, the validation and the farm assumptions
// it used.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  multiple_floor: number;
  multiple_cap: number;
  age_k_clamp: number;
  farmer_allocation: number;
  reference_farmers: number;
  capital_apr: number;
  claim_gas_usd: number;
  first_tx_gas_usd: number;
  rating_a_farmers: number;
  rating_b_farmers: number;
  rating_c_farmers: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.25,
  growth_floor: -60,
  growth_cap: 120,
  multiple_floor: 0.01,
  multiple_cap: 2.0,
  age_k_clamp: 0.05,
  farmer_allocation: 0.1,
  reference_farmers: 50000,
  capital_apr: 0.05,
  claim_gas_usd: 2,
  first_tx_gas_usd: 3,
  rating_a_farmers: 100000,
  rating_b_farmers: 25000,
  rating_c_farmers: 10000,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'sonar-7';

/** How many live-token protocols the live-token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The fitted curve: log10(mcap) = intercept + slope x log10(tvl). */
export interface CurveFit {
  intercept: number;
  slope: number;
  n_live: number;
  n_dead_excluded: number;
}

/**
 * The fitted age effect: how the curve's residual (log10(mcap) minus the
 * curve's log10 prediction) moves with how long a protocol has run.
 * `k` is the least-squares slope of the residual on centred log10(age+1),
 * shrunk to +/-age_k_clamp (0.05): the age signal is weak (correlation
 * about -0.05), so a full fit would overfit noise. `median_log_age` is the
 * median log10(age+1) over the protocols that carry a listed_at date, the
 * centre the multiplier pivots on. A protocol with no listed_at gets no
 * age adjustment (multiplier 1), never an invented age.
 */
export interface AgeFit {
  k: number;
  median_log_age: number;
  n_with_age: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One category peer: a live-token protocol in the same category, near the row in TVL. */
export interface PeerComp {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/**
 * An explainable composite score, 0-100, from the snapshot's own figures.
 * Four named sub-scores, each 0-25, so a reader can see why a row scores
 * what it does instead of taking one black-box number on trust:
 *   scale      = where the protocol's TVL sits on the board's log TVL range
 *   momentum   = the seven-day growth, clamped to the model's growth band
 *   maturity   = how long it has run with no token (log age over the board's
 *                oldest; a protocol with no listed_at gets the median)
 *   confidence = 12.5 for the global curve itself (fitted on 128
 *                live-token protocols) plus up to 12.5 more for
 *                same-category peers that agree (peer count over five,
 *                times one minus the peers' multiple spread)
 * The score is a presentation of the same figures the value already uses;
 * it never changes the implied value.
 */
export interface ScoreBreakdown {
  total: number;
  scale: number;
  momentum: number;
  maturity: number;
  confidence: number;
}

/** One farm's economics, from the protocol's own record and the model's assumptions. */
export interface FarmEconomics {
  capital_usd: number;
  hold_days: number;
  gas_usd: number;
  opportunity_usd: number;
  cost_usd: number;
  launch_probability: number;
  farmer_pool_usd: number;
  per_farmer_ev_usd: number;
  net_ev_usd: number;
  gas_to_ev: number;
  break_even_farmers: number;
  rating: 'A' | 'B' | 'C' | 'Skip';
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  peers: PeerComp[];
  score: ScoreBreakdown;
  model: {
    curve_multiple: number;
    curve_implied: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    age_days: number | null;
  };
  farm: FarmEconomics;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. The farm steps are the board's own strings, so the page renders exactly what board.json carries; the page still derives the plan from the protocol's record and says whether its derivation matches. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  peers: PeerComp[];
  score: ScoreBreakdown;
  curve_multiple: number;
  curve_implied: number;
  growth_multiplier: number;
  age_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One candidate's out-of-sample result: the offline 5-fold CV on 103 live-token protocols. */
export interface CvRow {
  model: string;
  mdape_pct: number;
  hit_pct: number;
  typical_error_x: number;
}

/**
 * The offline validation, run once by the author on the sealed snapshot and
 * recorded here with its protocol, so the dashboard can show it and a reader
 * can check it: 128 live-token protocols with a positive market cap, sorted
 * by slug, split into 5 folds by index (i % 5) for cross-validation, and a
 * 25-protocol holdout (i % 5 === 4) touched once, after selection by CV.
 * The holdout numbers are recomputed by the program at run time (see
 * validateHoldout); the CV table is the experiment's recorded result.
 */
export const VALIDATION_CV: CvRow[] = [
  { model: 'sonar-7: curve + growth 0.25 + age, range + score, playbooks, time-split', mdape_pct: 85.6, hit_pct: 28.2, typical_error_x: 3.49 },
  { model: 'sonar-6: curve + growth 0.25 + age, range + score, playbooks', mdape_pct: 85.6, hit_pct: 28.2, typical_error_x: 3.49 },
  { model: 'sonar-5: curve + growth 0.25 + age, range + score', mdape_pct: 85.6, hit_pct: 28.2, typical_error_x: 3.49 },
  { model: 'sonar-4: Theil-Sen curve + growth 0.25 + age', mdape_pct: 85.6, hit_pct: 28.2, typical_error_x: 3.49 },
  { model: 'sonar-3: Theil-Sen curve + growth 0.25', mdape_pct: 85.1, hit_pct: 28.2, typical_error_x: 3.49 },
  { model: 'Theil-Sen curve only', mdape_pct: 85.0, hit_pct: 28.2, typical_error_x: 3.39 },
  { model: 'OLS curve', mdape_pct: 86.0, hit_pct: 30.1, typical_error_x: 3.28 },
  { model: 'Category median', mdape_pct: 90.6, hit_pct: 27.2, typical_error_x: 5.02 },
  { model: 'Global median', mdape_pct: 91.4, hit_pct: 27.2, typical_error_x: 5.09 },
  { model: 'sonar-2: category median + growth + maturity', mdape_pct: 92.3, hit_pct: 25.2, typical_error_x: 4.45 },
  { model: 'TVL only (multiple 1.0)', mdape_pct: 411.8, hit_pct: 15.5, typical_error_x: 5.93 },
];

/** The validation the program recomputes at run time, plus the recorded CV table. */
export interface ValidationResult {
  protocol: string;
  cv: CvRow[];
  holdout_n: number;
  holdout_shipped: CvRow;
  holdout_global_median: CvRow;
  holdout_tvl_only: CvRow;
  time_split: {
    fit_n: number;
    test_n: number;
    cutoff: string;
    shipped: { mdape_pct: number; hit_pct: number; typical_error_x: number };
    slope: number;
    intercept: number;
  };
  bootstrap: {
    n: number;
    slope_p5: number;
    slope_p50: number;
    slope_p95: number;
    intercept_p5: number;
    intercept_p50: number;
    intercept_p95: number;
  };
  fit: CurveFit;
  live_examples: { name: string; tvl_usd: number; mcap_usd: number; curve_implied_usd: number }[];
  notes: string[];
}

/** Everything the dashboard needs: the board, the live set, the curve, the validation, and the farm assumptions. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  curve: {
    intercept: number;
    slope: number;
    multiple_floor: number;
    multiple_cap: number;
    n_live: number;
    age: AgeFit;
    examples: { tvl_usd: number; multiple: number; implied_usd: number }[];
  };
  validation: ValidationResult;
  farm: {
    farmer_allocation: number;
    reference_farmers: number;
    capital_apr: number;
    claim_gas_usd: number;
    first_tx_gas_usd: number;
  };
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted list of numbers; the mean of the two middles when even. */
function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Clamp a number into a band. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** An integer with thousands grouped by commas — no locale, so the same bytes everywhere. */
export function groupInt(n: number): string {
  const s = String(Math.round(n));
  const neg = s.startsWith('-');
  const digits = neg ? s.slice(1) : s;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${grouped}` : grouped;
}

/** Live-token protocols with a positive market cap, in slug order — the only protocols a multiple can be learned from. */
function liveForFit(protocols: SnapshotProtocol[]): { live: SnapshotProtocol[]; dead: number } {
  const withToken = protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const dead = withToken.filter((p) => p.mcap_usd! <= 0).length;
  const live = withToken
    .filter((p) => p.mcap_usd! > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { live, dead };
}

/**
 * The Theil-Sen log-log fit of market cap on TVL: the median pairwise slope
 * of log10(mcap) on log10(tvl), and the median residual as the intercept.
 * Robust to the snapshot's 400x outliers, where least squares is dragged by
 * them. Deterministic: the input is slug-ordered and every median is taken
 * over a sorted list.
 */
export function fitCurve(protocols: SnapshotProtocol[]): CurveFit {
  const { live, dead } = liveForFit(protocols);
  const xs = live.map((p) => Math.log10(p.tvl_usd));
  const ys = live.map((p) => Math.log10(p.mcap_usd!));
  const slopes: number[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const dx = xs[j]! - xs[i]!;
      if (dx !== 0) slopes.push((ys[j]! - ys[i]!) / dx);
    }
  }
  slopes.sort((a, b) => a - b);
  const slope = medianOf(slopes);
  const residuals = ys.map((y, i) => y - slope * xs[i]!).sort((a, b) => a - b);
  const intercept = medianOf(residuals);
  return { intercept, slope, n_live: live.length, n_dead_excluded: dead };
}

/**
 * The age effect, fitted from the same live-token protocols the curve is
 * fitted from: for each protocol that carries a listed_at date, the curve's
 * log residual against centred log10(age+1); `k` is their least-squares
 * slope, shrunk to +/-model.age_k_clamp. Deterministic: the input is
 * slug-ordered and the median is taken over a sorted list. Fitted on the
 * full snapshot the slope is -0.1232; shrunk to -0.05 it moves a 30-day
 * protocol by +19% and a 5-year one by -3% against the median age of about
 * 1,000 days — a small, honest age term, not a lever that can dominate the
 * curve. With no protocol carrying an age the effect is zero.
 */
export function fitAge(protocols: SnapshotProtocol[], asOf: string, fit: CurveFit, model: ModelConstants = MODEL): AgeFit {
  const { live } = liveForFit(protocols);
  const ages: number[] = [];
  const residuals: number[] = [];
  for (const p of live) {
    const age = ageDays(asOf, p.listed_at);
    if (age === null) continue;
    ages.push(Math.log10(age + 1));
    residuals.push(Math.log10(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log10(p.tvl_usd)));
  }
  if (ages.length === 0) return { k: 0, median_log_age: 0, n_with_age: 0 };
  const sorted = [...ages].sort((a, b) => a - b);
  const medianLogAge = medianOf(sorted);
  let num = 0;
  let den = 0;
  for (let i = 0; i < ages.length; i++) {
    const dx = ages[i]! - medianLogAge;
    num += dx * residuals[i]!;
    den += dx * dx;
  }
  const k = den > 0 ? clamp(num / den, -model.age_k_clamp, model.age_k_clamp) : 0;
  return { k, median_log_age: round4(medianLogAge), n_with_age: ages.length };
}

/** A protocol's age multiplier under an age fit: 1 when it carries no age. */
export function ageMultiplier(age: number | null, ageFit: AgeFit): number {
  if (age === null || ageFit.k === 0) return 1;
  return 10 ** (ageFit.k * (Math.log10(age + 1) - ageFit.median_log_age));
}

/** The curve's effective multiple at a TVL: the fitted market cap over the TVL, clamped. */
export function curveMultiple(tvlUsd: number, fit: CurveFit, model: ModelConstants = MODEL): number {
  const pred = 10 ** (fit.intercept + fit.slope * Math.log10(tvlUsd));
  return clamp(pred / tvlUsd, model.multiple_floor, model.multiple_cap);
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The multiplier and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CurveFit,
  ageFit: AgeFit,
  model: ModelConstants = MODEL,
): { implied: number; curveMultiple: number; curveImplied: number; growthPct: number; growthMult: number; age: number | null; ageMult: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const multiple = curveMultiple(protocol.tvl_usd, fit, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageMult = ageMultiplier(age, ageFit);
  const curveImplied = Math.max(1, Math.round(protocol.tvl_usd * multiple));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * ageMult));
  // Full precision, not rounded: the dashboard recomputes this row from the
  // stored age multiplier, and a rounded one would drift the dollar by a few
  // and make the page say the data is stale.
  return { implied, curveMultiple: multiple, curveImplied, growthPct, growthMult, age, ageMult };
}

/** A percentile of a sorted list, by linear interpolation; deterministic. */
export function percentileOf(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0]!;
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * A row's category peers: the live-token protocols (positive market cap) in
 * the same category, nearest in TVL on a log scale, up to five. Deterministic:
 * the distance is |log10(tvl) - log10(peer tvl)| and ties break by slug.
 * A protocol with no category, or a category with no live-token protocol,
 * has no peers — the range then falls back to the model's own typical error.
 */
export function categoryPeers(
  protocol: SnapshotProtocol,
  live: SnapshotProtocol[],
  maxPeers = 5,
): PeerComp[] {
  if (protocol.category === null) return [];
  const target = Math.log10(protocol.tvl_usd);
  return live
    .filter((p) => p.category === protocol.category)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: p.mcap_usd! / p.tvl_usd,
      dist: Math.abs(Math.log10(p.tvl_usd) - target),
    }))
    .sort((a, b) => a.dist - b.dist || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, maxPeers)
    .map(({ slug, name, tvl_usd, mcap_usd, multiple }) => ({ slug, name, tvl_usd, mcap_usd, multiple }));
}

/**
 * A row's implied-value range (p25-p75) from its category peers' multiples,
 * carried through the same growth and age multipliers as the point estimate.
 * With fewer than two peers there is no spread to measure, so the range is
 * the model's own typical out-of-sample error (x3.49) around the point
 * estimate — an honest statement of uncertainty, not a narrower number
 * invented from nothing.
 */
export function impliedRange(
  protocol: SnapshotProtocol,
  peers: PeerComp[],
  growthMult: number,
  ageMult: number,
  implied: number,
  typicalErrorX = 3.49,
): { low: number; high: number; fromPeers: boolean } {
  let low: number;
  let high: number;
  let fromPeers: boolean;
  if (peers.length >= 2) {
    const multiples = peers.map((p) => p.multiple).sort((a, b) => a - b);
    low = Math.max(1, Math.round(protocol.tvl_usd * percentileOf(multiples, 0.25) * growthMult * ageMult));
    high = Math.max(1, Math.round(protocol.tvl_usd * percentileOf(multiples, 0.75) * growthMult * ageMult));
    fromPeers = true;
  } else {
    low = Math.max(1, Math.round(implied / typicalErrorX));
    high = Math.max(1, Math.round(implied * typicalErrorX));
    fromPeers = false;
  }
  // The range always contains the point estimate: the peers and the global
  // curve are two views of the same value, and a range that excludes the
  // model's own number would be incoherent.
  low = Math.min(low, implied);
  high = Math.max(high, implied);
  return { low, high, fromPeers };
}

/**
 * A row's composite score, 0-100, from the snapshot's own figures. Four
 * sub-scores, each 0-25: scale (log TVL over the board's range), momentum
 * (seven-day growth over the model's growth band), maturity (log age over
 * the board's oldest; no listed_at gets the board's median age), confidence
 * (peer count over five, times one minus the peers' multiple spread, so a
 * wide spread lowers the score instead of hiding). All inputs are the
 * row's own record plus board-wide figures computed from the same snapshot;
 * no protocol name is ever special-cased.
 */
export function scoreRow(
  protocol: SnapshotProtocol,
  age: number | null,
  peers: PeerComp[],
  stats: { minLogTvl: number; maxLogTvl: number; maxLogAge: number; medianLogAge: number },
): ScoreBreakdown {
  const logTvl = Math.log10(protocol.tvl_usd);
  const scale = stats.maxLogTvl > stats.minLogTvl
    ? 25 * ((logTvl - stats.minLogTvl) / (stats.maxLogTvl - stats.minLogTvl))
    : 12.5;
  // Momentum is centred on flat growth: 0% is the neutral 12.5, +120% is
  // 25, -60% is 0. A linear map over the whole band would put flat growth
  // near 8 and compress every ordinary row to the same low score.
  const growth = clamp(finite(protocol.change_7d, 0), MODEL.growth_floor, MODEL.growth_cap);
  const momentum = growth >= 0
    ? 12.5 + (growth / MODEL.growth_cap) * 12.5
    : 12.5 + (growth / -MODEL.growth_floor) * 12.5;
  const logAge = age === null ? stats.medianLogAge : Math.log10(age + 1);
  const maturity = stats.maxLogAge > 0 ? 25 * (logAge / stats.maxLogAge) : 12.5;
  // Confidence starts at 12.5 for the global curve itself (fitted on 128
  // live-token protocols) and adds up to 12.5 more for category peers that
  // agree: peer count over five, times one minus the peers' multiple
  // spread. A thin category is low confidence, never near zero, because the
  // curve still applies.
  let confidence = 12.5;
  if (peers.length === 1) {
    confidence += 12.5 * (1 / 5);
  } else if (peers.length >= 2) {
    const multiples = peers.map((p) => p.multiple).sort((a, b) => a - b);
    const p25 = percentileOf(multiples, 0.25);
    const p75 = percentileOf(multiples, 0.75);
    const p50 = percentileOf(multiples, 0.5);
    const spread = p50 > 0 ? clamp((p75 - p25) / p50, 0, 1) : 1;
    confidence += 12.5 * (peers.length / 5) * (1 - spread);
  }
  const round1 = (n: number): number => Math.round(n * 10) / 10;
  const s: ScoreBreakdown = {
    total: 0,
    scale: round1(clamp(scale, 0, 25)),
    momentum: round1(clamp(momentum, 0, 25)),
    maturity: round1(clamp(maturity, 0, 25)),
    confidence: round1(clamp(confidence, 0, 25)),
  };
  s.total = round1(s.scale + s.momentum + s.maturity + s.confidence);
  return s;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The house rule's excluded categories: a wrapped, staked or bridged product's home. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word wrapped, staked or staking, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol below the floor is one the board may rank: the house
 * rule, as far as the snapshot lets it be checked. The rule also excludes a
 * wrapped, staked or bridged product of a protocol whose token already
 * trades, but DefiLlama's parentProtocol is not one of the snapshot's ten
 * fields, so that leg cannot be checked here; the category and name legs
 * are the checkable ones, and they are all applied. A null category is not
 * one of the excluded categories, so it passes.
 */
export function isEarlyEligible(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, opts: { economics?: boolean } = {}): BoardRow[] {
  const economics = opts.economics !== false;
  const fit = fitCurve(snapshot.protocols);
  const ageFit = fitAge(snapshot.protocols, snapshot.as_of, fit, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is in, whatever its score.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every eligible protocol the watchlist does not name,
  // at any TVL. The watchlist is a floor, never a ceiling: a protocol above
  // the floor that the list leaves out is no worse a subject, and the board
  // ranks all 198 protocols that pass the house rule as far as the snapshot's
  // ten fields let it be checked (the parentProtocol leg is not one of them,
  // so it cannot be checked here). No cap: a clean early row is in, and a
  // row the house rule refuses is out.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isEarlyEligible(p))
    .map((p) => ({ p, score: impliedValue(p, snapshot.as_of, fit, ageFit, model).implied }))
    .sort((a, b) => b.score - a.score || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, ageFit, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Board-wide figures the composite score is measured against: the log
  // TVL range and the log-age range over the board's own rows.
  const { live: liveForPeers } = liveForFit(snapshot.protocols);
  const logTvls = scored.map((s) => Math.log10(s.p.tvl_usd));
  const logAges = scored.filter((s) => s.age !== null).map((s) => Math.log10(s.age! + 1)).sort((a, b) => a - b);
  const stats = {
    minLogTvl: Math.min(...logTvls),
    maxLogTvl: Math.max(...logTvls),
    maxLogAge: logAges.length > 0 ? logAges[logAges.length - 1]! : 0,
    medianLogAge: logAges.length > 0 ? medianOf(logAges) : 0,
  };
  return scored.map((s, i) => {
    const farm = economics ? farmEconomics(s.p, s.age, s.implied, model) : null;
    const steps = farmSteps(s.p, s.age).map(stepText);
    // The seventh step is the net, stated plainly — it is not an action with
    // a cost and a time, so it is appended as-is, not through stepText.
    if (farm !== null) steps.push(evStepText(farm));
    const peers = categoryPeers(s.p, liveForPeers);
    const range = impliedRange(s.p, peers, s.growthMult, s.ageMult, s.implied);
    const score = scoreRow(s.p, s.age, peers, stats);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      implied_low_usd: range.low,
      implied_high_usd: range.high,
      peers,
      score,
      model: {
        // Full precision, not rounded: the dashboard recomputes this row from the
        // same figure, and a rounded multiple would drift the dollar by a few.
        curve_multiple: s.curveMultiple,
        curve_implied: s.curveImplied,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        age_multiplier: s.ageMult,
        age_days: s.age,
      },
      farm: farm ?? {
        capital_usd: capitalFor(s.p),
        hold_days: holdDaysFor(s.age),
        gas_usd: 0,
        opportunity_usd: 0,
        cost_usd: 0,
        launch_probability: launchProbability(s.p),
        farmer_pool_usd: 0,
        per_farmer_ev_usd: 0,
        net_ev_usd: 0,
        gas_to_ev: 0,
        break_even_farmers: 0,
        rating: 'Skip' as const,
      },
      farm_steps: steps,
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} (${chain}) and leave the deposit earning.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) return `Swap $${capital} through ${name} on ${chain}, then add the same size to its main pool as liquidity.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Deposit $${capital} into ${name}'s main vault on ${chain} and keep the receipt tokens.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and hold the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position in a live market on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset ${name} issues on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and use the app once a week.`;
}

/** The weekly recurring action, specific to the protocol's mechanism: the step that keeps the wallet active, not a single spike. */
function weeklyActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Return once a week and move the loan — add collateral, repay a little, or borrow against it — so the wallet shows ongoing use, not one deposit.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) return `Return once a week and trade through ${name} on ${chain}, or add and remove a little liquidity, so the wallet shows trading activity, not one deposit.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Return once a week and tend the vault — top up, harvest, or re-stake the yield — so the wallet shows ongoing use, not one deposit.`;
  if (c.includes('bridge')) return `Return once a week and bridge a small amount through ${name}, so the wallet shows repeated use, not one crossing.`;
  if (c.includes('staking') || c.includes('restak')) return `Return once a week and check the stake — restake the rewards or adjust the delegation — so the wallet shows ongoing use.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Return once a week and open and close one small hedged position on ${name}, so the wallet shows trading activity, not one margin post.`;
  if (c.includes('prediction')) return `Return once a week and take a position in a new live market on ${name}, so the wallet shows ongoing participation.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Return once a week and check the vault — top up or rebalance the shares — so the wallet shows ongoing use, not one deposit.`;
  if (c.includes('stable')) return `Return once a week and use the stable asset — mint, hold, or move it through ${name} — so the wallet shows ongoing use.`;
  if (c.includes('rwa')) return `Return once a week and check the yield-bearing asset — hold it or top it up — so the wallet shows ongoing use.`;
  if (c.includes('insurance')) return `Return once a week and check the cover — keep the policy active and top it up if it lapses.`;
  return `Return once a week and do one real action on ${name}, a deposit, a swap, a borrow or a vote, so the wallet shows a pattern, not a single spike.`;
}

/** The claim step, specific to what the protocol is likely to reward: the check to run and the scam to avoid. */
function claimFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('amm') || c.includes('swap') || c.includes('perpetual') || c.includes('derivative')) return `When rewards open, check the trading-rewards page on the protocol's own site and claim only there. A claim that asks you to pay, connect, or sign a blind approval is a scam.`;
  if (c.includes('prediction')) return `When a market settles, claim the winnings on the protocol's own site and check the rewards page for any farmer distribution. A claim that asks you to pay or sign a blind approval is a scam.`;
  if (c.includes('bridge')) return `When rewards open, check the protocol's own rewards page for bridging incentives and claim only there. A claim that asks you to pay, connect, or sign a blind approval is a scam.`;
  return `When a claim opens, use only the link on the protocol's own rewards page. A claim that asks you to pay, connect, or sign a blind approval is a scam.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Open a fresh wallet for this farm only, fund it with just the capital below, and store its seed phrase offline, never in a screenshot or a chat.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 200 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyActionFor(p, chain),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position for at least ${hold} days, across more than one snapshot, instead of farming and leaving in a day.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: claimFor(p),
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates, and every transaction hash in one note, so you can prove the activity or unwind it later.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The chance the protocol launches a token and rewards its farmers: larger protocols have more to gain from a token, so the chance rises with TVL on a log scale, from 0.30 at the $50M floor to 0.70 at $5B. */
export function launchProbability(p: SnapshotProtocol): number {
  const t = Math.log10(p.tvl_usd / 50_000_000) / 2;
  return round4(clamp(0.3 + 0.4 * t, 0.3, 0.7));
}

/**
 * One farm's economics: the expected value of farming it, netted against the
 * whole cost. The farmer pool is the implied value times the launch chance
 * times the farmers' 10% share; the reference count of 50,000 farmers turns
 * it into a per-farmer expectation. The cost is the gas the plan states
 * ($3 first transaction, $8/$4 setup, $2 a week, $2 to claim) plus the
 * capital's opportunity cost at 5% a year over the hold. The rating follows
 * the net: A at +$50, B at +$10, C at break-even, Skip below it.
 */
export function farmEconomics(p: SnapshotProtocol, age: number | null, implied: number, model: ModelConstants = MODEL): FarmEconomics {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const setupGas = capital >= 200 ? 8 : 4;
  const weeklyGas = 2 * Math.ceil(hold / 7);
  const gas = model.first_tx_gas_usd + setupGas + weeklyGas + model.claim_gas_usd;
  const opportunity = capital * model.capital_apr * (hold / 365);
  const cost = gas + opportunity;
  const probability = launchProbability(p);
  const pool = implied * probability * model.farmer_allocation;
  const ev = pool / model.reference_farmers;
  const net = ev - cost;
  const breakEven = cost > 0 ? Math.round(pool / cost) : 0;
  const rating: FarmEconomics['rating'] =
    breakEven >= model.rating_a_farmers ? 'A' : breakEven >= model.rating_b_farmers ? 'B' : breakEven >= model.rating_c_farmers ? 'C' : 'Skip';
  return {
    capital_usd: capital,
    hold_days: hold,
    gas_usd: round2(gas),
    opportunity_usd: round2(opportunity),
    cost_usd: round2(cost),
    launch_probability: probability,
    farmer_pool_usd: Math.round(pool),
    per_farmer_ev_usd: round2(ev),
    net_ev_usd: round2(net),
    gas_to_ev: ev > 0 ? round4(gas / ev) : 0,
    break_even_farmers: breakEven,
    rating,
  };
}

/** The farm plan's seventh step: the verdict, in one line, so the plan ends on what the farm is worth. A plain string, not a FarmStep: it states figures, it is not an action with a cost and a time. */
export function evStepText(e: FarmEconomics): string {
  const net = e.net_ev_usd >= 0 ? `+$${e.net_ev_usd.toFixed(2)}` : `-$${Math.abs(e.net_ev_usd).toFixed(2)}`;
  return `Breaks even with up to ${groupInt(e.break_even_farmers)} farmers; at the ${groupInt(MODEL.reference_farmers)}-farmer reference the net is ${net} per farmer (farmer pool $${groupInt(e.farmer_pool_usd)}, total cost $${e.cost_usd.toFixed(2)}). Rating ${e.rating}.`;
}

/** The live-token protocols, by market cap, for the dashboard's live-token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Eight live-token protocols, one per TVL octile, each the median-multiple protocol of its octile: what the curve would have said, next to the market's own value. */
export function liveExamples(
  snapshot: Snapshot,
  fit: CurveFit,
  model: ModelConstants = MODEL,
): { name: string; tvl_usd: number; mcap_usd: number; curve_implied_usd: number }[] {
  const { live } = liveForFit(snapshot.protocols);
  const ageFit = fitAge(snapshot.protocols, snapshot.as_of, fit, model);
  const byTvl = [...live].sort((a, b) => a.tvl_usd - b.tvl_usd);
  const out: { name: string; tvl_usd: number; mcap_usd: number; curve_implied_usd: number }[] = [];
  for (let k = 0; k < 8; k++) {
    const group = byTvl.slice(Math.floor((k * byTvl.length) / 8), Math.floor(((k + 1) * byTvl.length) / 8));
    if (group.length === 0) continue;
    const byMultiple = [...group].sort((a, b) => a.mcap_usd! / a.tvl_usd - b.mcap_usd! / b.tvl_usd);
    const p = byMultiple[Math.floor(byMultiple.length / 2)]!;
    out.push({
      name: p.name,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      curve_implied_usd: impliedValue(p, snapshot.as_of, fit, ageFit, model).implied,
    });
  }
  return out;
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    peers: row.peers,
    score: row.score,
    curve_multiple: row.model.curve_multiple,
    curve_implied: row.model.curve_implied,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** The median of a list of numbers. */
function medianList(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return medianOf(s);
}

/** Out-of-sample metrics for a list of predictions against their actuals. */
function oosMetrics(preds: { pred: number; actual: number }[]): { mdape_pct: number; hit_pct: number; typical_error_x: number } {
  const good = preds.filter(({ pred, actual }) => Number.isFinite(pred) && pred > 0 && actual > 0);
  const errs = good.map(({ pred, actual }) => Math.abs(pred - actual) / actual);
  const logErrs = good.map(({ pred, actual }) => Math.abs(Math.log10(pred / actual)));
  const hits = good.filter(({ pred, actual }) => pred >= 0.5 * actual && pred <= 2 * actual).length;
  return {
    mdape_pct: round2(medianList(errs) * 100),
    hit_pct: round2((hits / preds.length) * 100),
    typical_error_x: round2(10 ** medianList(logErrs)),
  };
}

/**
 * The holdout check, recomputed by the program at run time: the same
 * deterministic split the offline experiment used (live-token protocols with
 * a positive market cap, in slug order; every fifth one is the holdout),
 * the curve fitted on the train split only, then the shipped model, the
 * global-median baseline and the TVL-only baseline scored on the holdout.
 * The holdout was touched once, after selection by CV.
 */
export function validateHoldout(snapshot: Snapshot, model: ModelConstants = MODEL): {
  n: number;
  shipped: { mdape_pct: number; hit_pct: number; typical_error_x: number };
  global_median: { mdape_pct: number; hit_pct: number; typical_error_x: number };
  tvl_only: { mdape_pct: number; hit_pct: number; typical_error_x: number };
} {
  const { live } = liveForFit(snapshot.protocols);
  const holdout = live.filter((_, i) => i % 5 === 4);
  const train = live.filter((_, i) => i % 5 !== 4);
  const fit = fitCurve(train);
  const ageFit = fitAge(train, snapshot.as_of, fit, model);
  const shipped = holdout.map((p) => ({ pred: impliedValue(p, snapshot.as_of, fit, ageFit, model).implied, actual: p.mcap_usd! }));
  const medianMultiple = clamp(medianList(train.map((p) => p.mcap_usd! / p.tvl_usd)), 0.05, 1.5);
  const globalMedian = holdout.map((p) => ({ pred: Math.max(1, Math.round(p.tvl_usd * medianMultiple)), actual: p.mcap_usd! }));
  const tvlOnly = holdout.map((p) => ({ pred: p.tvl_usd, actual: p.mcap_usd! }));
  return {
    n: holdout.length,
    shipped: oosMetrics(shipped),
    global_median: oosMetrics(globalMedian),
    tvl_only: oosMetrics(tvlOnly),
  };
}

/**
 * The time-split check, recomputed by the program at run time: the live-token
 * protocols that carry a listed_at date (95 of 128), split at the median
 * listing date; the curve and the age fit are fitted on the older half only,
 * then the shipped model is scored on the newer half. A curve that only fits
 * the past would fall apart here; a stable one holds up on protocols listed
 * after the fit. The 33 live protocols with no listed_at date cannot be
 * split by time and are left out of this check.
 */
export function validateTimeSplit(snapshot: Snapshot, model: ModelConstants = MODEL): {
  fit_n: number;
  test_n: number;
  cutoff: string;
  shipped: { mdape_pct: number; hit_pct: number; typical_error_x: number };
  slope: number;
  intercept: number;
} {
  const { live } = liveForFit(snapshot.protocols);
  const dated = live.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  const mid = Math.floor(dated.length / 2);
  const older = dated.slice(0, mid);
  const newer = dated.slice(mid);
  const cutoff = newer.length > 0 ? newer[0]!.listed_at!.slice(0, 10) : '';
  const fit = fitCurve(older);
  const ageFit = fitAge(older, snapshot.as_of, fit, model);
  const shipped = newer.map((p) => ({ pred: impliedValue(p, snapshot.as_of, fit, ageFit, model).implied, actual: p.mcap_usd! }));
  return {
    fit_n: older.length,
    test_n: newer.length,
    cutoff,
    shipped: oosMetrics(shipped),
    slope: round4(fit.slope),
    intercept: round4(fit.intercept),
  };
}

/** A deterministic seeded PRNG (mulberry32) for the bootstrap: the same seed, the same resamples, every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The bootstrap stability check, recomputed by the program at run time: 200
 * resamples of the 128 live-token protocols with replacement (seeded, so the
 * result is byte-identical every run), the Theil-Sen curve refitted on each,
 * and the 5th/50th/95th percentiles of the slope and intercept reported. A
 * narrow band means the curve's shape is not one protocol's doing; a wide
 * band would say the fit is fragile.
 */
export function bootstrapCurve(snapshot: Snapshot): {
  n: number;
  slope_p5: number;
  slope_p50: number;
  slope_p95: number;
  intercept_p5: number;
  intercept_p50: number;
  intercept_p95: number;
} {
  const { live } = liveForFit(snapshot.protocols);
  const rand = mulberry32(20261116);
  const slopes: number[] = [];
  const intercepts: number[] = [];
  for (let b = 0; b < 200; b++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < live.length; i++) sample.push(live[Math.floor(rand() * live.length)]!);
    const fit = fitCurve(sample);
    slopes.push(fit.slope);
    intercepts.push(fit.intercept);
  }
  slopes.sort((a, b) => a - b);
  intercepts.sort((a, b) => a - b);
  return {
    n: 200,
    slope_p5: round4(percentileOf(slopes, 0.05)),
    slope_p50: round4(percentileOf(slopes, 0.5)),
    slope_p95: round4(percentileOf(slopes, 0.95)),
    intercept_p5: round4(percentileOf(intercepts, 0.05)),
    intercept_p50: round4(percentileOf(intercepts, 0.5)),
    intercept_p95: round4(percentileOf(intercepts, 0.95)),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL, opts: { economics?: boolean } = {}): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model, opts);
  const fit = fitCurve(snapshot.protocols);
  const ageFit = fitAge(snapshot.protocols, snapshot.as_of, fit, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const holdout = validateHoldout(snapshot, model);
  const timeSplit = validateTimeSplit(snapshot, model);
  const bootstrap = bootstrapCurve(snapshot);
  const examples = [10_000_000, 100_000_000, 1_000_000_000, 5_000_000_000].map((tvl) => {
    const multiple = curveMultiple(tvl, fit, model);
    return { tvl_usd: tvl, multiple: round4(multiple), implied_usd: Math.max(1, Math.round(tvl * multiple)) };
  });
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    curve: {
      intercept: round4(fit.intercept),
      slope: round4(fit.slope),
      multiple_floor: model.multiple_floor,
      multiple_cap: model.multiple_cap,
      n_live: fit.n_live,
      age: ageFit,
      examples,
    },
    validation: {
      protocol:
        '128 live-token protocols with a positive market cap, sorted by slug. 5-fold cross-validation on 103 (folds by index i % 5); a 25-protocol holdout (i % 5 === 4) touched once, after selection by CV. Median absolute percentage error; hit = prediction within 2x of the actual market cap.',
      cv: VALIDATION_CV,
      holdout_n: holdout.n,
      holdout_shipped: { model: 'sonar-7: curve + growth 0.25 + age, range + score, playbooks, time-split', ...holdout.shipped },
      holdout_global_median: { model: 'Global median', ...holdout.global_median },
      holdout_tvl_only: { model: 'TVL only (multiple 1.0)', ...holdout.tvl_only },
      time_split: timeSplit,
      bootstrap,
      fit,
      live_examples: liveExamples(snapshot, fit, model),
      notes: [
        '16 of the 144 live-token protocols record a market cap of $0 or less (dead or failed tokens) and are excluded from every fit: no multiple can be learned from a zero.',
        'Growth is kept at quarter weight: out of sample it costs 0.1 points of median error (85.1% vs 85.0%) and keeps the seven-day momentum the criteria ask for.',
        'Maturity (age) enters the value through a fitted multiplier: the curve residual\'s slope on centred log10(age+1), shrunk to +/-0.05 because the age signal is weak (correlation about -0.05) and a full fit would overfit noise. A protocol with no listed_at date gets no age adjustment; 33 of the 128 training protocols carry no date, so the age input is missing for a quarter of the fit. Age also decides the farm hold.',
        'A category-shrinkage variant (curve x category factor) was tested and dropped: 88.1%, worse than the plain global curve.',
        'The implied value is a point estimate with a range: the p25-p75 multiples of the protocol\'s nearest live-token peers in its own category (up to five, nearest in log TVL), carried through the same growth and age multipliers. With fewer than two peers the range is the model\'s own typical out-of-sample error (x3.49) around the point estimate — an honest width, not a narrower number invented from nothing.',
        'The 0-100 score is four named sub-scores of 0-25 each (scale, momentum, maturity, confidence), all from the snapshot\'s own figures; it presents the same figures the value already uses and never changes the implied value.',
        'Time-split: the curve and the age fit are fitted on the older half of the 95 live-token protocols that carry a listed_at date and scored on the newer half (listed after the median date). A curve that only fits the past would fall apart on the newer half.',
        'Bootstrap: 200 resamples of the 128 live-token protocols with replacement (seeded, so the result is byte-identical every run), the curve refitted on each. The slope and intercept bands say how much the fit moves when the sample moves.',
      ],
    },
    farm: {
      farmer_allocation: model.farmer_allocation,
      reference_farmers: model.reference_farmers,
      capital_apr: model.capital_apr,
      claim_gas_usd: model.claim_gas_usd,
      first_tx_gas_usd: model.first_tx_gas_usd,
    },
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: p.mcap_usd === null ? null : typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, the house rule on early rows, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const bySlugMap = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (const r of board) {
    if (snapshot.watchlist.includes(r.slug)) continue;
    const p = bySlugMap.get(r.slug);
    if (p !== undefined && !isEarlyEligible(p)) return `${r.slug} is an early row the house rule refuses`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
