// Sonar-8 tests — test-driven-development (obra/superpowers, 323,982★):
// RED first: these tests are written BEFORE the sonar-8 model changes, so
// they fail on the sonar-7 code, then pass after. Run:
//   node --test tests/sonar8.test.ts
// Adapted to node:test + node:assert (no Jest/Vitest — stdlib only).
// javascript-testing-patterns: pure functions, one assertion per test,
// hand-written fixtures (no faker).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MODEL, buildBoard, buildRadar, farmEconomics, fitCurve, fitTokenOdds,
  tokenOdds, ledgerFor, rankRangesFor, validateCv, validateLoo,
  validateWalkForward, dataQualityFor, parseSnapshot,
} from '../lib/model.ts';

const snapshot = parseSnapshot(readFileSync(new URL('../../kit-sonar8/token-radar-01-kit/input/snapshot.json', import.meta.url), 'utf8'));

test('growth weight is the fitted plateau centre (0.2), not the manual 0.25', () => {
  assert.equal(MODEL.growth_weight, 0.2);
});

test('curve fit uses the 95 age-bearing live-token comps only', () => {
  const fit = fitCurve(snapshot.protocols);
  assert.equal(fit.n_live, 95);
  assert.equal(fit.n_dead_excluded, 16);
});

test('token odds: fitted logistic, probabilities in (0,1), mean near base rate', () => {
  const odds = fitTokenOdds(snapshot);
  assert.equal(odds.beta.length, 4);
  const probs = snapshot.protocols.map((p) => tokenOdds(p, odds));
  assert.ok(probs.every((x) => x > 0 && x < 1), 'every odds in (0,1)');
  const mean = probs.reduce((a, b) => a + b, 0) / probs.length;
  assert.ok(Math.abs(mean - 416 / 758) < 0.05, `mean odds ${mean} near base rate ${416 / 758}`);
  // Age is the strong term: an old protocol has higher odds than a young one, all else equal.
  const oldP = { slug: 'old', name: 'Old', category: null, chains: ['Ethereum'], tvl_usd: 100_000_000, change_7d: 0, mcap_usd: null, listed_at: '2021-11-14', gecko_id: null, symbol: null };
  const youngP = { ...oldP, slug: 'young', listed_at: '2026-10-15' };
  assert.ok(tokenOdds(oldP, odds) > tokenOdds(youngP, odds), 'older > younger odds');
});

test('token odds: 5-fold CV AUC beats the 0.5 coin flip by a clear margin', () => {
  const sorted = [...snapshot.protocols].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const oof: { s: number; y: number }[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const test = sorted.filter((_, i) => i % 5 === fold);
    const train = sorted.filter((_, i) => i % 5 !== fold);
    const odds = fitTokenOdds({ ...snapshot, protocols: train });
    for (const p of test) oof.push({ s: tokenOdds(p, odds), y: p.mcap_usd === null && p.gecko_id === null && p.symbol === null ? 0 : 1 });
  }
  const pos = oof.filter((r) => r.y === 1).map((r) => r.s);
  const neg = oof.filter((r) => r.y === 0).map((r) => r.s);
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  const auc = wins / (pos.length * neg.length);
  assert.ok(auc > 0.6, `CV AUC ${auc}`);
});

test('farm economics: low-end net never exceeds point net; rating follows the low end', () => {
  const board = buildBoard(snapshot);
  const top = board[0]!;
  assert.ok(top.farm.net_ev_low_usd <= top.farm.net_ev_usd, 'low-end net <= point net');
  assert.ok(top.farm.expected_pool_usd > 0, 'expected pool positive');
  assert.ok(top.farm.token_odds > 0 && top.farm.token_odds < 1, 'odds in (0,1)');
  // Rating is the low-end break-even rating: recompute it from the low pool.
  const beLow = Math.round(top.farm.expected_low_pool_usd / top.farm.cost_usd);
  const expected = beLow >= 100000 ? 'A' : beLow >= 25000 ? 'B' : beLow >= 10000 ? 'C' : 'Skip';
  assert.equal(top.farm.rating, expected);
});

test('deposit threshold: at the threshold, low-end net is ~$0; null when it never pays', () => {
  const board = buildBoard(snapshot);
  const withThreshold = board.find((r) => r.farm.deposit_threshold_usd !== null)!;
  const e = withThreshold.farm;
  const d = e.deposit_threshold_usd!;
  assert.ok(d > 0, 'threshold positive');
  // EV(D) = evLow * D/C0 ; cost(D) = gas + D*0.05*hold/365 ; net(D*) ~ 0.
  const evAtD = e.per_farmer_ev_low_usd * (d / e.capital_usd);
  const costAtD = e.gas_usd + d * 0.05 * (e.hold_days / 365);
  assert.ok(Math.abs(evAtD - costAtD) < 1.0, `net at threshold ${evAtD - costAtD}`);
  const never = board.find((r) => r.farm.deposit_threshold_usd === null);
  assert.ok(never !== undefined, 'some row never pays at any deposit');
});

test('ledger: every one of the 758 protocols is accounted for, exactly once', () => {
  const board = buildBoard(snapshot);
  const ledger = ledgerFor(snapshot, board);
  assert.equal(ledger.total, 758);
  const sum = ledger.board_rows + ledger.excluded_pre_token + ledger.live_mcap_positive
    + ledger.live_mcap_zero_or_less + ledger.token_recorded_no_mcap;
  assert.equal(sum, 758);
  assert.equal(ledger.board_rows, 198);
  assert.equal(ledger.watchlist_rows, 40);
  assert.equal(ledger.early_rows, 158);
  const exclSum = ledger.excluded_by_category + ledger.excluded_by_version
    + ledger.excluded_by_wrapped_word + ledger.excluded_by_exchange_prefix;
  assert.equal(exclSum, ledger.excluded_pre_token);
});

test('rank ranges: every row range contains its rank; top row range is narrow', () => {
  const { board, radar } = buildRadar(snapshot);
  const ranges = rankRangesFor(snapshot, board);
  assert.equal(ranges.length, board.length);
  for (let i = 0; i < board.length; i++) {
    assert.ok(ranges[i]!.low <= board[i]!.rank && board[i]!.rank <= ranges[i]!.high,
      `row ${board[i]!.rank} in [${ranges[i]!.low}, ${ranges[i]!.high}]`);
  }
  assert.ok(ranges[0]!.high - ranges[0]!.low <= 10, 'top row range width <= 10');
});

test('validation: CV, LOO and walk-forward all return finite MdAPE in range', () => {
  const cv = validateCv(snapshot);
  assert.ok(Number.isFinite(cv.mdape_pct) && cv.mdape_pct > 0 && cv.mdape_pct < 200, `CV ${cv.mdape_pct}`);
  assert.equal(cv.n, 95);
  const loo = validateLoo(snapshot);
  assert.ok(Number.isFinite(loo.mdape_pct) && loo.mdape_pct > 0 && loo.mdape_pct < 200, `LOO ${loo.mdape_pct}`);
  const wf = validateWalkForward(snapshot);
  assert.equal(wf.windows.length, 3);
  for (const w of wf.windows) assert.ok(Number.isFinite(w.mdape_pct) && w.mdape_pct > 0 && w.mdape_pct < 300, `WF ${w.mdape_pct}`);
});

test('data quality: no duplicate slugs, null profile counted, TVL all positive', () => {
  const q = dataQualityFor(snapshot);
  assert.equal(q.duplicate_slugs, 0);
  assert.equal(q.total, 758);
  assert.equal(q.null_change_7d, 4);
  assert.equal(q.null_listed_at, 113);
  assert.equal(q.null_category, 0);
  assert.ok(q.min_tvl_usd >= 5_000_000, 'floor is $5M');
});
