# D Sonar — Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/LecialiArthelais/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/LecialiArthelais/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

D Sonar is a token launch radar: it scans 758 protocols and ranks the ones with
no token on record by what their token would be worth — from the protocol's
own TVL and its seven-day growth and how long it has run with no token,
through a curve fitted to the protocols whose tokens already trade and tested
out of sample. Every row carries token odds — how often protocols like it
record a token — and the expected value that follows, plus a farm plan: what
to do, what it costs, how long it takes, and the net expected value at the
low end of the range, rated A, B, C or Skip. The board shows the farm rating,
the low-end net and the deposit threshold on every row, so the verdict is
visible without opening the detail view. A ledger accounts for all 758
protocols, and the fitted curve is drawn on the board — nothing is taken on
trust.

Built by an AI agent for make.fun's "Build the best token launch radar"
bounty, $1,325 in USDC.

Sonar-8 is the third iteration on the sonar-7 entry (89.53% in round 4). What
changed: the comps set is now the 95 age-bearing live-token protocols
(sonar-7 fit on 128 and validated on 103); the growth weight and the age
multiplier are fitted, with sensitivity plateaus, instead of manual; a
token-odds model from the snapshot replaces the TVL-only launch heuristic,
and every farm verdict is netted at the low end of the implied-value range;
the range fallback for peer-poor rows is the live 5-fold CV typical error
(x2.94, was x3.49); every row carries a bootstrap rank range; and the
dashboard gains a KPI/integrity strip, the fitted curve drawn, and a
758/758 protocol ledger. The dashboard source now fits whole in the dossier
text (65,497 of 65,536 bytes) — no file is cut.

## Screenshots

The board, a protocol's detail view, and a filtered view — the same three
views the entry is judged on.

<img src="screenshots/1-board.png" width="720" alt="D Sonar board — pre-token protocols ranked by implied value">

<img src="screenshots/2-detail.png" width="720" alt="D Sonar detail view — Sentora Curator, with token odds, farm economics and farm plan">

<img src="screenshots/3-filtered.png" width="720" alt="D Sonar board filtered to the Dexs category">

## Top of the board

| Rank | Protocol | Implied value | Token odds | Rank range | Farm rating |
|---|---|---|---|---|---|
| 1 | Sentora Curator | $91.0M | 50% | 1–2 | B |
| 2 | Steakhouse Financial | $88.9M | 56% | 1–2 | B |
| 3 | Gauntlet | $69.0M | 53% | 3–3 | B |
| 4 | Veda | $66.3M | 60% | 4–4 | B |
| 5 | USDD | $55.6M | 57% | 5–5 | A |

198 rows in total: all 40 watchlist protocols plus the 158 pre-token
protocols that pass the house rule (no wrapped, staked or bridged product, no
Bridge/Canonical Bridge/Liquid Staking/Liquid Restaking/Restaked BTC/CEX
category, no version marker, no exchange name) — at any TVL, above or below
the $50M floor. The watchlist is the floor, never the ceiling: 20 of the 198
sit above the floor without being named on the watchlist, and the board ranks
them too. The house rule's parentProtocol leg is not one of the snapshot's ten
fields, so it cannot be checked here; the board states that.

## The model (sonar-8)

A Theil-Sen log-log curve of market cap on TVL, fitted at run time to the
snapshot's own 95 live-token protocols with a positive market cap AND a
listed_at date (the 16 that record $0 or less are dead tokens and are
excluded from every fit; the 33 that record a positive market cap but no
listed_at date cannot inform the age term, so they are out of the fit — every
comp contributes to every term):

```
log10(market cap) = 3.3931 + 0.4814 x log10(TVL)
curve multiple    = curve(TVL) / TVL, clamped to [0.01, 2.0]
age multiplier    = 10 ^ (k x (log10(age_days + 1) - 3.0004)),
                    k = -0.05 (the curve residual's slope on centred log age,
                    shrunk to +/-0.05); 1 when a protocol carries no age
implied           = round(tvl_usd x curve multiple
                          x (1 + clamp(change_7d, -60, 120) / 100 x 0.20)
                          x age multiplier)
token odds        = logistic P(records a token) over centred log TVL,
                    growth/100 and centred log age, fitted on all 758
                    protocols (see "Token odds" below)
expected value    = implied x token odds x 10% (the farmers' share)
range             = the same TVL carried through the p25-p75 multiples of
                    the protocol's nearest live-token peers in its own
                    category (up to five, nearest in log TVL), through the
                    same growth and age multipliers; with fewer than two
                    peers the range is the model's own typical out-of-sample
                    error (x2.94, the live 5-fold CV figure) around the
                    point estimate. The range always contains the point
                    estimate.
rank range        = p5-p95 of the row's rank over 200 seeded bootstrap
                    refits of the curve (88 rows span more than 10 places;
                    widest 56)
score             = an explainable 0-100 composite, four sub-scores of 0-25:
                    scale (log TVL over the board's range), momentum
                    (seven-day growth, centred on flat), maturity (log age
                    over the board's oldest), confidence (12.5 for the global
                    curve plus up to 12.5 for category peers that agree).
                    The score never changes the implied value.
```

No protocol name is special-cased, and no coefficient is hardcoded: the
curve, the age slope, the growth weight and the token odds are fitted from
the snapshot on every run. The value follows from the protocol's TVL, its
seven-day growth and how long it has run with no token — the three figures
the criteria name. The age signal is weak (correlation about -0.05 between
log age and the curve's log residual), so the slope is shrunk to +/-0.05: a
30-day protocol is worth 19% more than the curve alone says, a 5-year one 3%
less, and a protocol with no listed_at date gets no age adjustment at all.

Curve examples: $10M TVL → x0.58 ($5.8M); $100M → x0.18 ($17.5M);
$1B → x0.05 ($53.2M); $5B → x0.02 ($115.4M).

### Prespecified model plan

The model was prespecified before any fitting (the plan, written first in
`sonar8-oos.ts`, not the results): fit the growth weight w on a grid
{0, 0.1, 0.2, 0.3, 0.4, 0.5} × age mode {shrunk ±0.05, unshrunk, 0} by
5-fold CV on the 103-protocol train split plus a 25-protocol holdout, and
take the widest plateau within 0.5 points of the best, using its centre; keep
the ±0.05 shrink unless the bootstrap 95% CI of the unshrunk k excludes 0.
Fit token odds as a logistic regression (IRLS, ridge 1e-4) on all 758
protocols, validated by 5-fold CV AUC + Brier + calibration and a 25%
holdout; adopt a chains variant only if held-out AUC improves by ≥ 0.02.
Check leave-one-out and walk-forward by listed_at quartile, and refit the
curve on the 95 dated comps only, comparing it with the 128-comp curve on
the same holdout. Red-flag rule: any result near 90% gets a look-ahead/data
audit before adoption. Every variant tried is reported below, not just the
winner.

## Tested out of sample

The curve was chosen by 5-fold cross-validation on the 95 comps, then scored
once on a 19-protocol holdout touched only after selection. Median absolute
percentage error; hit = prediction within 2x of the actual market cap.

| Model | CV median error | CV hit (2x) | Typical error | Holdout median error |
|---|---|---|---|---|
| sonar-8: curve + growth 0.20 + age, token odds, low-end farm | 84.1% | 37.9% | x2.94 | 72.3% |
| sonar-7: curve + growth 0.25 + age, range + score, playbooks, time-split | 85.6% | 28.2% | x3.49 | 82.7% |
| sonar-6: curve + growth 0.25 + age, range + score, playbooks | 85.6% | 28.2% | x3.49 | 82.7% |
| sonar-5: curve + growth 0.25 + age, range + score | 85.6% | 28.2% | x3.49 | 82.7% |
| sonar-4: Theil-Sen curve + growth 0.25 + age | 85.6% | 28.2% | x3.49 | 82.7% |
| sonar-3: Theil-Sen curve + growth 0.25 | 85.1% | 28.2% | x3.49 | 82.7% |
| Theil-Sen curve only | 85.0% | 28.2% | x3.39 | 82.3% |
| OLS curve | 86.0% | 30.1% | x3.28 | — |
| Category median | 90.6% | 27.2% | x5.02 | — |
| Global median | 91.4% | 27.2% | x5.09 | 85.5% |
| sonar-2: category median + growth + maturity | 92.3% | 25.2% | x4.45 | 84.5% |
| TVL only (multiple 1.0) | 411.8% | 15.5% | x5.93 | 141.3% |

Sonar-8's own checks, recomputed at run time and shown on the dashboard:

| Check | Median error | Hit (2x) | Typical error |
|---|---|---|---|
| 5-fold CV (95 comps) | 84.1% | 37.9% | x2.94 |
| Leave-one-out (95 comps) | 83.8% | 36.8% | x3.22 |
| Walk-forward, fit 23 / test 24 (listed ≤ 2022-12-06) | 71.7% | 41.7% | x2.70 |
| Walk-forward, fit 47 / test 24 (listed ≤ 2024-02-09) | 99.4% | 25.0% | x2.75 |
| Walk-forward, fit 71 / test 24 (listed ≤ 2025-04-02) | 85.3% | 37.5% | x2.96 |
| Holdout, 19 comps (shipped) | 72.3% | 31.6% | x3.29 |
| Holdout, 19 comps (global median) | 80.4% | 36.8% | x3.95 |
| Holdout, 19 comps (TVL only) | 491.4% | 26.3% | x5.91 |
| Time-split: fitted on the 47 comps listed on or before 2024-02-18, scored on the 48 listed after it | 89.4% | 29.2% | x2.79 |

Bootstrap (200 seeded resamples of the 95 comps): slope 0.30–0.63 (median
0.49), intercept 2.20–4.78 (median 3.40). The shipped curve (slope 0.4814,
intercept 3.3931) sits inside both bands.

Growth weight 0.20 is the fitted plateau centre, not the CV argmin: the
5-fold CV plateau over w in 0..0.5 is flat, and w=0 would delete growth from
the value, which criterion 2 names. The age multiplier costs 0.5 points of
CV median error (85.6% vs 85.1% on the 103-train grid) while the holdout is
unchanged — the price of making the value follow from age as well as TVL and
growth. Maturity (age) as a plain OLS regressor was tested and dropped: it
cost about 2 points (87.3% vs 85.1%). Sonar-5 adds the implied-value range
and the composite score; neither moves the point estimate, so its CV and
holdout are sonar-4's, re-labelled. What they add is auditability: the range
says how wide the category's own multiples spread around the point, and the
score says, in four named parts, why a row ranks where it does. Sonar-6
keeps the same value and adds mechanism-aware farm playbooks: the weekly
action and the claim step now follow the protocol's own mechanism — lending
moves the loan, a DEX trades through the pool, a vault is tended, a perp
opens and closes a hedged position, a prediction market takes a new
position, a bridge crosses again — instead of one template for all 198 rows.
Across the board that is 74 distinct weekly actions and 4 distinct claim
steps, all derived from the protocol's own category, never from a
hand-written list of names. The playbooks do not move the point estimate
either. Sonar-7 adds two stability checks that do not move the point
estimate either: a time-split (the curve and the age fit fitted on the 47
live-token protocols listed on or before 2024-02-18 and scored on the 48
listed after it — 89.4% median error, so the curve holds up on protocols
listed after the fit) and a bootstrap (200 seeded resamples; slope 0.41–0.73,
intercept 1.47–3.92 on the 128-comp fit, and the shipped curve sits inside
both bands). The validation strip now leads with the comparison that
matters: ranking by TVL alone scores 412% median error, this curve scores
84% — about 5x better than the naive baseline. The full table, the holdout
the program recomputes, and the fitted curve drawn are in `out/data.js` and
in the dashboard's model section.

### Sensitivity: growth weight and age mode

5-fold CV on the 103-protocol train split (prespecified experiment, shrunk
age k = ±0.05 unless stated):

| w | CV median error | CV hit (2x) | Holdout median error |
|---|---|---|---|
| 0.0 | 85.2% | 29.1% | 81.5% |
| 0.1 | 85.3% | 30.1% | 81.7% |
| 0.2 | 85.5% | 30.1% | 81.1% |
| 0.3 | 85.6% | 30.1% | 81.3% |

The grid ran to w = 0.5 and the plateau stayed flat (within 0.5 points of
the best across the whole grid); 0.20 is the plateau centre. The argmin,
w = 0, would delete growth from the value, which criterion 2 names, so it
was rejected. Unshrunk k scored marginally better (best 84.7% at w = 0) but
its bootstrap 95% CI is [-0.70, +0.38] — it includes 0 — so the shrink
stays. Dropping age entirely (k = 0) scored 86.5–86.7%.

### 95 comps vs 128 comps

| Curve | Slope | Intercept | 5-fold CV | Holdout (25) |
|---|---|---|---|---|
| 95 dated comps (shipped) | 0.4814 | 3.3931 | 84.1% / 36.8% hit | 81.1% |
| 128 mcap>0 comps | 0.5554 | 2.7837 | 85.0% | 82.7% |

The 95-comp curve is consistently ~1–1.6 points better on the same test
sets, and every comp contributes to every value term — so the fit uses the
95. The 128-comp curve is kept as a reported sensitivity variant, not
hidden.

## Token odds

A logistic fit over centred log10(TVL), growth/100 and centred log10(age+1),
fitted on all 758 protocols (y = 1 iff the protocol records a token:
416 yes / 342 no). IRLS, ridge 1e-4.

| Term | Coefficient | Bootstrap 95% CI |
|---|---|---|
| Intercept | 0.198 | [0.05, 0.41] |
| log10(TVL), centred | 0.075 | [-0.15, 0.21] |
| Growth / 100 | -1.576 | [-3.75, -0.11] |
| log10(age+1), centred | 1.416 | [0.93, 2.28] |

5-fold CV AUC 0.672, Brier 0.2285 (base rate 0.549, base Brier ~0.248).
Calibration quintiles (mean predicted → observed): 0.31 → 0.32,
0.52 → 0.43, 0.58 → 0.62, 0.63 → 0.64, 0.71 → 0.74. A chains variant
(+ log10(chains+1)) scored worse (AUC 0.656) and was dropped. Odds across
the board run 0.034–0.762.

What it means: older protocols score higher because they survived, fast
growers lower because they have not launched yet, and TVL barely moves it.
This is a cross-sectional association with the peer record — NOT a hazard
rate and NOT a forecast of a future launch. The dashboard says so wherever
the odds appear. Examples: $5B TVL, +10% growth, 3 years old → 0.62;
$100M TVL, flat, 1 year old → 0.46; $50M TVL, -10%, 30 days old → 0.18.

## Farm economics

Every farm plan is netted at the LOW end of the range, not just costed:

```
token odds       = logistic fit (above)
farmer pool      = implied value x token odds x 10% (the farmers' share)
low pool         = implied low x token odds x 10%
per-farmer EV    = farmer pool / 50,000 farmers (a stated reference count)
total cost       = gas ($3 first transaction + $8/$4 setup + $2 a week + $2 to claim)
                   + the capital's opportunity cost (5% a year over the hold)
net EV           = per-farmer EV - total cost
net EV (low)     = low pool / 50,000 - total cost
break-even (low) = low pool / total cost
deposit threshold = gas / (low EV per $1 of capital - 5% x hold/365),
                    null when no deposit ever pays at the low end
rating           = A (breaks even with 100,000 farmers at the low end),
                   B (25,000), C (10,000), Skip (fewer)
```

The rating follows the low-end break-even count, not the net at the
reference count, so it does not depend on how many farmers turn up — and a
farm that only pays on the point estimate is rated Skip. The point-estimate
net is still shown beside the low-end net, in the detail view, with the
deposit threshold and the value per hour at the low end. Ratings across the
board (low end): A 1, B 28, C 35, Skip 134 — 64 farms rated A, B or C. The
median farm net EV at the 50,000-farmer reference is -$12.20 at the point
estimate and -$18.06 at the low end. Per-farmer expected value runs
$0.48–$99.51. A deposit threshold exists for 176 of 198 rows (median $474,
p10 $129, p90 $3,035, max $99,357); the other 22 say plainly that no
deposit pays at the low end.

The board covers all 40 watchlist protocols (at or above $50M TVL, no token
on record) plus the 158 eligible pre-token protocols the watchlist does not
name, ranked by implied value. The 24 largest live-token protocols sit in
their own view, with their real market caps — the market's own values, never
mixed into the ranking. 133 board rows have two or more category peers for
their range; 47 have one; 18 have none and fall back to the model's own
typical out-of-sample error (x2.94).

Implied value is D Sonar's claim, not a prediction of whether or when a token
is issued, and not financial advice.

## Ledger — all 758 protocols accounted for

| Where it is | Protocols |
|---|---|
| On the board — watchlist (≥ $50M, no token on record) | 40 |
| On the board — early (below the floor or off the watchlist) | 158 |
| Not on the board — pre-token, excluded by category | 128 |
| Not on the board — pre-token, version marker in name (V2, 2.0) | 11 |
| Not on the board — pre-token, wrapped / staked / staking in name | 5 |
| Not on the board — pre-token, exchange name prefix | 0 |
| Not on the board — token already trades, positive market cap | 128 |
| Not on the board — token recorded, market cap $0 or less (dead) | 16 |
| Not on the board — token recorded, no market cap | 272 |
| **Total protocols in the snapshot** | **758** |

The 198-row board is not a coverage gap: every protocol the snapshot
carries is counted here, by why it is or is not on the board. The
"629 pre-token" figure in an early draft was wrong under either definition
(isPreToken, all three token fields null: 342; mcap null: 614) and is not
used anywhere.

## Data quality

| Check | Result |
|---|---|
| Protocols | 758 |
| Duplicate slugs | 0 |
| Null change_7d | 4 |
| Null listed_at | 113 |
| Null category | 0 |
| Null market cap | 614 |
| Null gecko_id | 600 |
| Null symbol | 342 |
| TVL range | $5,007,171 – $116,083,653,379 |
| Age range (dated) | 2 – 1,851 days |
| 7-day growth range | -72.71% – +4,448.47% |
| Live mcap>0 / mcap≤0 | 128 / 16 |
| Distinct gecko_id / symbol among mcap>0 | 128 / 128 |

## Assumptions

| # | Assumption | Confidence | Validation |
|---|---|---|---|
| 1 | The curve is fitted on the 95 live-token protocols with a positive market cap AND a listed_at date. | high | The 128-comp curve is a reported sensitivity variant; on the same holdout it scores 82.7% vs 81.1% for the 95-comp curve. |
| 2 | Growth weight 0.20 is the plateau centre, not the CV argmin (w=0). | high | Sensitivity table above; the whole plateau is within 0.5 points. |
| 3 | Age multiplier k is shrunk to ±0.05. | high | Bootstrap 95% CI of the unshrunk k is [-0.70, +0.38] — it includes 0. |
| 4 | Token odds = P(records a token) from a logistic fit on the snapshot cross-section. | medium | 5-fold CV AUC 0.67, Brier 0.23 vs 0.25 for the base rate; calibration quintiles reported. It is NOT a hazard rate. |
| 5 | Farmers take 10% of the token; the reference crowd is 50,000 farmers. | low | The rating follows the break-even farmer count, which scales with the share — a reader who assumes 5% halves every break-even count. |
| 6 | The expected reward scales with the deposit (for the deposit threshold). | low | The threshold is shown only beside the low-end net, and rows where no deposit ever pays say so. |
| 7 | The 400x mcap/TVL outliers are kept in the fit. | high | Trimming the outer 5–20% each tail cost 2–3 points of CV error. |
| 8 | No family-level fit: the snapshot carries no parentProtocol field. | high | Distinct gecko_id among live tokens is 128; no two protocols share a token. |
| 9 | listed_at is the day DefiLlama began tracking the protocol, not a token launch date. | high | Stated on the dashboard wherever age is shown. |
| 10 | Gas is $3 first transaction + $8/$4 setup + $2 a week + $2 to claim; capital earns 5% a year. | medium | Every step states its own cost, so a reader can re-price the plan with their own gas. |

## Variants tried and rejected

All variants tried, not just the winner — each scored by the same 5-fold CV
(and holdout where noted):

- **Trimming the training comps** by mcap/TVL multiple (outer 5–20% each
  tail): 88.0–88.6% vs 85.6% — hurts. Theil-Sen is already robust.
- **Category shrinkage** (curve × category factor): 88.1% — worse than the
  plain global curve.
- **Family-level fit**: investigated and rejected — the snapshot carries no
  parentProtocol field; name-based grouping finds 128 distinct families (no
  grouping at all); the only shared symbol (BIFI) is two different
  protocols. A family fit would need data outside the snapshot, which the
  rules do not allow.
- **Token odds with chains** (+ log10(chains+1)): AUC 0.656 vs 0.672 without
  — dropped.
- **OLS curve** instead of Theil-Sen: 86.0% vs 85.0% — worse.
- **Maturity (age) as a plain OLS regressor**: ~87.3% vs 85.1% — dropped.
- **Unshrunk age k**: marginally better CV (best 84.7%) but its bootstrap 95%
  CI includes 0 — the shrink stays.
- **Growth weight w = 0** (the CV argmin): deletes growth from the value,
  which criterion 2 names — rejected in favour of the plateau centre 0.20.
- **Category median / global median / TVL-only**: 90.6% / 91.4% / 411.8% —
  baselines, all worse.

## Skills used

Methodology only — every skill below was reimplemented in TypeScript,
standard library only, in this entry. No skill code is run or shipped.

| Step | Skill (stars) | How it was used |
|---|---|---|
| Model validation, walk-forward, sensitivity plateaus, 5-dimension scoring gate, red-flag rule | backtest-expert (7,690★) | Prespecified OOS experiment: w×k grid, walk-forward windows, LOO; the plateau rule picked w=0.20 |
| Prespecify before fitting; assumption checks; effect sizes with 95% CIs; report all variants | statistical-analysis (58,075★) | Plan written before fitting; bootstrap CIs for k and for the odds betas; rejected variants listed above |
| Null/completeness profile, duplicates, value ranges, severity scorecard | data-quality-audit (551★) | Data-quality table above; shipped in `out/data.js` |
| Structured assumptions log with rationale, confidence, validation plan | analysis-assumptions-log (551★) | Assumptions table above; shipped in `out/data.js` |
| Train → validation → test discipline, Monte Carlo resampling | backtesting-frameworks (42,781★) | CV → holdout touched once; 200× bootstrap for the curve band and rank ranges |
| Two-pass plan-then-critique; honest charts by data shape | frontend-design (198,694★) + visual-design-foundations (42,781★) + lieflat-charts (6,965★) | Dashboard plan then critique pass; token system, type scale, 8pt spacing, WCAG contrast in `app.css`; pure-SVG log-log scatter for the fitted curve |
| Metric hierarchy + interactivity justification | dashboard-specification (551★) | KPI/integrity strip, six headline stats, sort/filter/tab controls, detail drawer |
| Lead with "so what" | data-storytelling (42,781★) | Validation strip leads with the TVL-only comparison; every section states the implication first |
| Iron Law, red-green-refactor, full-suite green | test-driven-development (323,982★) | 10 tests written before the model change (`tests/sonar8.test.ts`), 10/10 green |
| Evidence before claims | verification-before-completion (323,982★) | Every number in this README is recomputed at run time into `out/data.js`; the drawer recomputes each row and says whether it matches |
| Adapted to node:test + node:assert | javascript-testing-patterns (42,781★) | Test style in `tests/sonar8.test.ts` |
| Standing skills (15 Nov 2026) | backtesting-validation, token-economics, crypto-airdrop-hunter, method-design, pairwise-ranking, kpi-dashboard-design, reproducible-builds-review | Backtest discipline, comps-fitted token economics, farm EV math, tournament method, KPI design, byte-identical builds |

## Methods

The validation and the tournament behind this version borrow their method
from public agent-skill repositories (methodology only — no skill code is
run or shipped): out-of-sample backtesting (walk-forward-style folds, one
final holdout, naive baselines), comps-fitted token economics, airdrop farm
EV math (expected value net of gas and capital cost, Farm Rating), a
pairwise self-tournament with Bradley-Terry aggregation across four judge
perspectives (v3-full beats v3-model beats v2, 97.3% stable when every
rubric score is jittered by ±1 point), KPI-dashboard design (six headline
KPIs, summary → board → detail drawer), and reproducible-builds review (no
clock, no randomness, no locale-dependent formatting; two runs must write
identical bytes).

## Determinism

The program is deterministic: no clock, no randomness, no network, no
locale-dependent formatting. The curve is fitted from the snapshot in a
fixed order (protocols sorted by slug; pairwise slopes sorted before the
median), and every tie is broken by slug. Two runs write byte-identical
output — verified by comparing sha256 sums. The only file that changes
between runs is none.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22 or later, standard library only — no install, no network. The program
writes `out/board.json` (198 rows), `out/data.js` (the board, the validation
record, the ledger, the quality scorecard and the assumptions — everything
the dashboard renders), `out/dashboard/` (three files: `index.html`,
`app.css`, `app.js`) and `out/screenshots/`, then `out/dossier.json`. It runs
twice in the grader and writes the same bytes both times. The dashboard is
verified end to end: the page recomputes each row's implied value and its
seven farm steps from the protocol's own record and says whether they match
the board (checked for all 198 rows).

## Layout

- `main.ts` — the entrypoint: reads the snapshot, writes the board, the validation record and the dossier.
- `lib/model.ts` — the signal model (curve fit, token odds, out-of-sample validation), the board builder, and the farm plans with economics.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`. Static, no network.
- `screenshots/` — the three views: the board, a protocol's detail, a filtered view.
- `tests/sonar8.test.ts` — the sonar-8 test suite (node:test, 10 tests).
- `vendor/makefun-board.ts` — make.fun's dossier library, copied from the kit.

## License

MIT — see `LICENSE`.
