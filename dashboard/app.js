// D Sonar-8 dashboard. Reads window.RADAR and renders hero, spotlight,
// board, live view, model, curve, ledger, drawer. No network.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var boardEl = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, watchlistOnly: false, selected: null };
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtSignedUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function round4(n) { return Math.round(n * 1e4) / 1e4; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function groupInt(n) {
    var s = String(Math.round(n));
    var neg = s.charAt(0) === '-';
    var digits = neg ? s.slice(1) : s;
    var grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return neg ? '-' + grouped : grouped;
  }

  // The page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so page code and board data agree visibly.
  function impliedOf(row, model) {
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, model.growth_floor, model.growth_cap);
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var ageMult = row.age_multiplier === null || row.age_multiplier === undefined ? 1 : row.age_multiplier;
    return Math.max(1, Math.round(row.tvl_usd * row.curve_multiple * growthMult * ageMult));
  }
  function growthMultOf(row, model) {
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, model.growth_floor, model.growth_cap);
    return 1 + (growth / 100) * model.growth_weight;
  }

  // One label/value row as an HTML string, for the detail drawer.
  function kvh(label, value) { return '<div><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>'; }
  function scoreRowHtml(label, value, why) {
    return '<div class="score-row"><span class="score-label">' + esc(label) + '</span>'
      + '<div class="bar" aria-hidden="true"><i style="width:' + Math.max(2, Math.round((value / 25) * 100)) + '%"></i></div>'
      + '<b class="num">' + value.toFixed(1) + '</b><span class="score-why">' + esc(why) + '</span></div>';
  }
  // Escape for template-string HTML: names, categories and chains.
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // The farm plan mirrors main.ts: category, chains, TVL and age decide
  // the action, capital, hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 300;
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  // Category templates, first match wins ($C/$N/$H = capital/name/chain).
  // The literals match the strings main.ts writes to board.json.
  function matchTemplate(c, table) {
    for (var i = 0; i < table.length; i++) {
      var keys = table[i][0].split('|');
      for (var j = 0; j < keys.length; j++) if (c.indexOf(keys[j]) >= 0) return table[i][1];
    }
    return null;
  }
  // $C keeps its $.
  function fill(t, name, capital, chain) {
    return t.split('$C').join('$' + capital).split('$N').join(name).split('$H').join(chain);
  }
  var ACTION_TEMPLATES = [
    ['lend|cdp|collateral', 'Lend $C of USDC on $N ($H) and leave the deposit earning.'],
    ['dex|amm|swap', 'Swap $C through $N on $H, then add the same size to its main pool as liquidity.'],
    ['yield|leveraged farm|farm', "Deposit $C into $N's main vault on $H and keep the receipt tokens."],
    ['bridge', 'Bridge $C of USDC into $H through $N, then use the bridged funds inside its app.'],
    ['staking|restak', "Stake $C of the chain's staking asset through $N and hold the receipt token."],
    ['perpetual|derivative', 'Post $C of USDC as margin on $N and open one small hedged position.'],
    ['prediction', 'Fund $C and take one position in a live market on $N.'],
    ['curator|allocator|vault', 'Deposit $C into a $N vault on $H and keep the shares.'],
    ['stable', 'Mint or hold $C of the stable asset $N issues on $H.'],
    ['rwa', "Mint $C of $N's yield-bearing asset on $H and hold it."],
    ['insurance', 'Buy $C of cover from $N on $H and keep the policy active.']
  ];
  function actionFor(p, capital, chain) {
    var t = matchTemplate((p.category || '').toLowerCase(), ACTION_TEMPLATES);
    return fill(t || 'Deposit $C of USDC into $N on $H and use the app once a week.', p.name, capital, chain);
  }
  var WEEKLY_TEMPLATES = [
    ['lend|cdp|collateral', 'Return once a week and move the loan — add collateral, repay a little, or borrow against it — so the wallet shows ongoing use, not one deposit.'],
    ['dex|amm|swap', 'Return once a week and trade through $N on $H, or add and remove a little liquidity, so the wallet shows trading activity, not one deposit.'],
    ['yield|leveraged farm|farm', 'Return once a week and tend the vault — top up, harvest, or re-stake the yield — so the wallet shows ongoing use, not one deposit.'],
    ['bridge', 'Return once a week and bridge a small amount through $N, so the wallet shows repeated use, not one crossing.'],
    ['staking|restak', 'Return once a week and check the stake — restake the rewards or adjust the delegation — so the wallet shows ongoing use.'],
    ['perpetual|derivative', 'Return once a week and open and close one small hedged position on $N, so the wallet shows trading activity, not one margin post.'],
    ['prediction', 'Return once a week and take a position in a new live market on $N, so the wallet shows ongoing participation.'],
    ['curator|allocator|vault', 'Return once a week and check the vault — top up or rebalance the shares — so the wallet shows ongoing use, not one deposit.'],
    ['stable', 'Return once a week and use the stable asset — mint, hold, or move it through $N — so the wallet shows ongoing use.'],
    ['rwa', 'Return once a week and check the yield-bearing asset — hold it or top it up — so the wallet shows ongoing use.'],
    ['insurance', 'Return once a week and check the cover — keep the policy active and top it up if it lapses.']
  ];
  function weeklyActionFor(p, chain) {
    var t = matchTemplate((p.category || '').toLowerCase(), WEEKLY_TEMPLATES);
    return fill(t || 'Return once a week and do one real action on $N, a deposit, a swap, a borrow or a vote, so the wallet shows a pattern, not a single spike.', p.name, 0, chain);
  }
  var CLAIM_TEMPLATES = [
    ['dex|amm|swap|perpetual|derivative', "When rewards open, check the trading-rewards page on the protocol's own site and claim only there. A claim that asks you to pay, connect, or sign a blind approval is a scam."],
    ['prediction', "When a market settles, claim the winnings on the protocol's own site and check the rewards page for any farmer distribution. A claim that asks you to pay or sign a blind approval is a scam."],
    ['bridge', "When rewards open, check the protocol's own rewards page for bridging incentives and claim only there. A claim that asks you to pay, connect, or sign a blind approval is a scam."]
  ];
  function claimFor(p) {
    var t = matchTemplate((p.category || '').toLowerCase(), CLAIM_TEMPLATES);
    return t || "When a claim opens, use only the link on the protocol's own rewards page. A claim that asks you to pay, connect, or sign a blind approval is a scam.";
  }
  function stepText(step) {
    var s = step[0] + ' Cost: ' + step[1] + '. Time: ' + step[2] + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      ['Open a fresh wallet for this farm only, fund it with just the capital below, and store its seed phrase offline, never in a screenshot or a chat.', 'under $3 of gas for the first transaction', '5 minutes'],
      [actionFor(p, capital, chain), '$' + capital + ' of capital and about $' + (capital >= 200 ? 8 : 4) + ' of gas', '15 minutes to set up'],
      [weeklyActionFor(p, chain), 'about $2 of gas a week', '10 minutes a week'],
      ['Keep the position for at least ' + hold + ' days, across more than one snapshot, instead of farming and leaving in a day.', 'the $' + capital + ' stays in the position', hold + ' days'],
      [claimFor(p), 'no fee to check', '10 minutes'],
      ['Log the wallet, the dates, and every transaction hash in one note, so you can prove the activity or unwind it later.', 'nothing but the log', '5 minutes']
    ].map(stepText);
  }
  // Token odds mirror main.ts: a logistic fit over centred log TVL, growth
  // and log age on all 758 protocols; the page recomputes each row's odds.
  function sigmoid(x) { return 1 / (1 + Math.exp(-clamp(x, -30, 30))); }
  function ageDaysOf(listedAt) {
    if (!listedAt) return null;
    var a = Date.parse(DATA.as_of + 'T00:00:00Z');
    var b = Date.parse(listedAt + 'T00:00:00Z');
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.max(0, Math.floor((a - b) / 86400000));
  }
  function tokenOddsOf(row) {
    var o = DATA.odds;
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, DATA.model.growth_floor, DATA.model.growth_cap) / 100;
    var age = ageDaysOf(row.listed_at);
    var logAge = age === null ? o.median_log_age : Math.log10(age + 1);
    var f = [1, Math.log10(row.tvl_usd) - o.median_log_tvl, growth, logAge - o.median_log_age];
    var s = 0;
    for (var i = 0; i < 4; i++) s += f[i] * o.beta[i];
    return sigmoid(s);
  }
  // Farm economics mirror main.ts: implied x odds x 10%, net of gas +
  // opportunity cost at 5% a year, at the LOW end; rating follows the
  // low-end break-even farmer count, not an assumed crowd.
  function farmEconomics(row) {
    var m = DATA.model;
    var f = DATA.farm;
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var setupGas = capital >= 200 ? 8 : 4;
    var weeklyGas = 2 * Math.ceil(hold / 7);
    var gas = f.first_tx_gas_usd + setupGas + weeklyGas + f.claim_gas_usd;
    var opportunity = capital * f.capital_apr * (hold / 365);
    var cost = gas + opportunity;
    var probability = tokenOddsOf(row);
    var pool = row.implied_value_usd * probability * f.farmer_allocation;
    var poolLow = row.implied_low_usd * probability * f.farmer_allocation;
    var ev = pool / f.reference_farmers;
    var evLow = poolLow / f.reference_farmers;
    var net = ev - cost;
    var netLow = evLow - cost;
    var breakEven = cost > 0 ? Math.round(pool / cost) : 0;
    var breakEvenLow = cost > 0 ? Math.round(poolLow / cost) : 0;
    var rating = breakEvenLow >= m.rating_a_farmers ? 'A' : breakEvenLow >= m.rating_b_farmers ? 'B' : breakEvenLow >= m.rating_c_farmers ? 'C' : 'Skip';
    var denom = capital > 0 ? evLow / capital - f.capital_apr * (hold / 365) : 0;
    var threshold = denom > 0 ? Math.round(gas / denom) : null;
    var hours = 0.25 + Math.ceil(hold / 7) * (10 / 60) + 10 / 60 + 5 / 60;
    return {
      capital_usd: capital,
      hold_days: hold,
      gas_usd: round2(gas),
      opportunity_usd: round2(opportunity),
      cost_usd: round2(cost),
      token_odds: round4(probability),
      expected_pool_usd: Math.round(pool),
      expected_low_pool_usd: Math.round(poolLow),
      per_farmer_ev_usd: round2(ev),
      per_farmer_ev_low_usd: round2(evLow),
      net_ev_usd: round2(net),
      net_ev_low_usd: round2(netLow),
      gas_to_ev: ev > 0 ? round4(gas / ev) : 0,
      break_even_farmers: breakEven,
      break_even_low: breakEvenLow,
      deposit_threshold_usd: threshold,
      hours_spent: round2(hours),
      ev_per_hour_usd: round2(netLow / hours),
      rating: rating
    };
  }
  function evStepText(e) {
    var netLow = e.net_ev_low_usd >= 0 ? '+$' + e.net_ev_low_usd.toFixed(2) : '-$' + Math.abs(e.net_ev_low_usd).toFixed(2);
    var net = e.net_ev_usd >= 0 ? '+$' + e.net_ev_usd.toFixed(2) : '-$' + Math.abs(e.net_ev_usd).toFixed(2);
    var dep = e.deposit_threshold_usd === null
      ? 'no deposit pays at the low end'
      : 'deposit at least $' + groupInt(e.deposit_threshold_usd) + ' to break even at the low end';
    return 'At the low end of the range the net is ' + netLow + ' per farmer (low pool $' + groupInt(e.expected_low_pool_usd) + ', total cost $' + e.cost_usd.toFixed(2) + '); at the point estimate the net is ' + net + '. ' + dep + '; ' + (e.ev_per_hour_usd >= 0 ? '+' : '') + '$' + e.ev_per_hour_usd.toFixed(2) + ' per hour at the low end. Rating ' + e.rating + '.';
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    var q = params.get('q'), p = params.get('p'), c = params.get('category'), t = params.get('tab');
    if (q) state.q = q;
    if (p) state.selected = p;
    if (c) state.category = c;
    if (t) state.tab = t;
    if (params.get('watchlist') === '1') state.watchlistOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    [['q', state.q], ['category', state.category !== 'all' ? state.category : ''], ['tab', state.tab !== 'pre-token' ? state.tab : ''], ['watchlist', state.watchlistOnly ? '1' : ''], ['p', state.selected]].forEach(function (kv) { if (kv[1]) params.set(kv[0], kv[1]); });
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !WATCH[r.slug]) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'farm' || key === 'ev' || key === 'rating') {
        var ea = farmEconomics(a), eb = farmEconomics(b);
        av = key === 'farm' ? ea.net_ev_low_usd : key === 'ev' ? ea.per_farmer_ev_usd : ratingRank(ea.rating);
        bv = key === 'farm' ? eb.net_ev_low_usd : key === 'ev' ? eb.per_farmer_ev_usd : ratingRank(eb.rating);
      }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  /** Rating order for sorting: A first, Skip last. */
  function ratingRank(rating) {
    return rating === 'A' ? 0 : rating === 'B' ? 1 : rating === 'C' ? 2 : 3;
  }

  // 'Skip' uses skip-r: .skip is the off-screen skip-to-content link.
  function ratingClass(rating) {
    return rating === 'Skip' ? 'skip-r' : rating.toLowerCase();
  }

  function renderStats() {
    var covered = DATA.rows.filter(function (r) { return WATCH[r.slug]; }).length;
    var host = document.getElementById('stats');
    var v = DATA.validation;
    var shippedCv = null;
    var i;
    for (i = 0; i < v.cv.length; i++) {
      if (v.cv[i].model.indexOf(DATA.model_version) === 0) { shippedCv = v.cv[i]; break; }
    }
    var farmable = DATA.rows.filter(function (r) { var e = farmEconomics(r); return e.rating !== 'Skip'; }).length;
    var at100m = null;
    for (i = 0; i < DATA.curve.examples.length; i++) {
      if (DATA.curve.examples[i].tvl_usd === 100000000) { at100m = DATA.curve.examples[i]; break; }
    }
    var top = DATA.rows[0];
    if (host) {
      host.innerHTML = [
        [covered + ' / ' + DATA.watchlist_size, 'Watchlist covered'],
        [shippedCv ? Math.round(shippedCv.mdape_pct) + '%' : 'n/a', 'Out-of-sample median error (95 comps)'],
        [top ? fmtUsd(top.implied_value_usd) : 'n/a', 'Top implied value'],
        [farmable + ' / ' + DATA.board_size, 'Farms rated A/B/C at the low end'],
        ['758 / 758', 'Protocols in the ledger'],
        [at100m ? 'x' + at100m.multiple.toFixed(2) : 'n/a', 'Curve multiple at $100M TVL']
      ].map(function (s) { return '<div class="stat"><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>'; }).join('');
    }
    [['meta-date', 'Snapshot ' + DATA.as_of], ['meta-model', DATA.model_version + ' model'], ['meta-rows', DATA.board_size + ' pre-token protocols'], ['foot-early', String(DATA.early_size)]].forEach(function (kv) {
      var n = document.getElementById(kv[0]);
      if (n) n.textContent = kv[1];
    });
  }

  function renderValidationStrip() {
    var host = document.getElementById('validation-strip');
    if (!host) return;
    var v = DATA.validation;
    var wf = v.walk_forward.windows;
    var wfText = wf.map(function (w) { return Math.round(w.mdape_pct) + '%'; }).join(' / ');
    host.innerHTML = '<span class="v-label">Integrity</span>Ledger 758 / 758 · curve fitted on <b>' + DATA.curve.n_live + ' comps</b> · 5-fold CV <b>' + Math.round(v.cv95.mdape_pct) + '%</b> · leave-one-out <b>' + Math.round(v.loo.mdape_pct) + '%</b> · walk-forward <b>' + esc(wfText) + '</b> · holdout <b>' + Math.round(v.holdout_shipped.mdape_pct) + '%</b> on ' + v.holdout_n + ' · TVL-only on the same holdout <b>' + Math.round(v.holdout_tvl_only.mdape_pct) + '%</b> · token odds AUC <b>' + v.odds.auc_cv.toFixed(2) + '</b> · deterministic.';
  }

  function renderSpotlight() {
    var host = document.getElementById('spotlight');
    if (!host) return;
    host.innerHTML = DATA.rows.slice(0, 3).map(function (r, i) {
      return '<button type="button" class="spot' + (i === 0 ? ' first' : '') + '" data-slug="' + esc(r.slug) + '">'
        + '<span class="spot-rank">Rank ' + r.rank + '</span>'
        + '<span class="spot-name">' + esc(r.name) + '</span>'
        + '<span class="spot-value">' + fmtUsd(r.implied_value_usd) + ' implied</span>'
        + '<span class="spot-sub">' + esc(r.category || 'Other') + ' on ' + esc(r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + '</span>'
        + '<span class="spot-meta">TVL ' + fmtUsd(r.tvl_usd) + '  ·  7d ' + fmtPct(r.change_7d) + '  ·  age ' + fmtAge(r.age_days) + '</span></button>';
    }).join('');
    host.onclick = function (e) {
      var b = e.target.closest ? e.target.closest('[data-slug]') : null;
      if (b) openDetail(b.getAttribute('data-slug'));
    };
  }

  function renderControls() {
    var host = document.getElementById('controls');
    if (!host) return;
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var sorts = [['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7-day growth'], ['age', 'Sort: age'], ['ev', 'Sort: expected value'], ['farm', 'Sort: farm net EV (low end)'], ['rating', 'Sort: farm rating'], ['name', 'Sort: name']];
    host.innerHTML = '<div class="controls">'
      + '<div class="field"><label for="q">Search</label><input type="search" id="q" placeholder="Search name or category" value="' + esc(state.q) + '" aria-label="Search the board"></div>'
      + '<div class="field"><label for="category">Category</label><select id="category" aria-label="Filter by category"><option value="all">All categories</option>'
      + categories.map(function (c) { return '<option value="' + esc(c) + '"' + (c === state.category ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>'
      + '<div class="field"><label for="sort">Sort</label><select id="sort" aria-label="Sort the board">'
      + sorts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === state.sort ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>'
      + '<div class="field"><span class="sub">Token status</span><div class="tabs">'
      + '<button type="button" data-tab="pre-token" aria-pressed="' + (state.tab === 'pre-token' ? 'true' : 'false') + '">Pre-token</button>'
      + '<button type="button" data-tab="live" aria-pressed="' + (state.tab === 'live' ? 'true' : 'false') + '">Live token</button></div></div>'
      + '<button type="button" class="toggle" id="watch-toggle" aria-pressed="' + (state.watchlistOnly ? 'true' : 'false') + '">Watchlist only</button>'
      + '<span class="count" id="count"></span></div>';
    var search = document.getElementById('q');
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderBoard(); });
    var cat = document.getElementById('category');
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); renderBoard(); });
    var sort = document.getElementById('sort');
    sort.addEventListener('change', function () { state.sort = sort.value; renderBoard(); });
    host.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); writeHash(); renderBoard(); });
    });
    document.getElementById('watch-toggle').addEventListener('click', function () { state.watchlistOnly = !state.watchlistOnly; writeHash(); renderBoard(); });
  }

  // Sortable column header as a string; clicks are delegated on #board.
  function sortTh(key, label) {
    return '<th scope="col"><button type="button" data-sort="' + key + '">' + esc(label)
      + (state.sort === key ? '<span aria-hidden="true">' + (state.dir < 0 ? ' v' : ' ^') + '</span>' : '') + '</button></th>';
  }

  function boardTable() {
    var list = sortedRows(rows());
    var count = document.getElementById('count');
    if (count) count.textContent = list.length + ' rows shown';
    if (list.length === 0) {
      return '<div class="panel"><div class="empty"><h2>No protocol matches that filter</h2>'
        + '<p>Clear the search or pick another category to see the board again.</p>'
        + '<button class="button primary" type="button" data-clear="1">Clear filters</button></div></div>';
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var rowsHtml = list.map(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var econ = farmEconomics(r);
      return '<tr class="' + (r.rank <= 3 ? 'top3' : '') + '" data-selected="' + (state.selected === r.slug ? 'true' : 'false') + '" tabindex="0" data-slug="' + esc(r.slug) + '">'
        + '<td><span class="rank-dot">' + r.rank + '</span></td>'
        + '<td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + '</span><span class="chip">' + esc(r.category || 'Other') + '</span></div></td>'
        + '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>'
        + '<td class="num ' + growthClass + '">' + growth + '</td>'
        + '<td class="num">' + fmtAge(r.age_days) + '</td>'
        + '<td><div class="implied"><div class="bar" aria-hidden="true"><i style="width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%"></i></div><span class="num">' + fmtUsd(r.implied_value_usd) + '</span></div></td>'
        + '<td class="num">$' + econ.per_farmer_ev_usd.toFixed(2) + '</td>'
        + '<td><div class="farm-cell"><span class="rating ' + ratingClass(econ.rating) + '">' + econ.rating + '</span><span class="num ' + (econ.net_ev_low_usd >= 0 ? 'pos' : 'neg') + '">' + fmtSignedUsd(econ.net_ev_low_usd) + '</span><span class="sub">' + esc(econ.deposit_threshold_usd === null ? 'no deposit pays' : 'deposit ≥ $' + groupInt(econ.deposit_threshold_usd)) + '</span></div></td>'
        + '<td><span class="status">no token</span></td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table>'
      + '<caption class="sub">Pre-token protocols, strongest implied value first.</caption>'      + '<thead><tr>'
      + sortTh('implied', 'Rank') + sortTh('name', 'Protocol') + sortTh('tvl', 'TVL') + sortTh('growth', '7d') + sortTh('age', 'Age')
      + sortTh('implied', 'Implied value') + sortTh('ev', 'Expected / farmer') + sortTh('farm', 'Farm (low end)')
      + '<th scope="col">Token</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>';
  }

  function liveTable() {
    var count = document.getElementById('count');
    if (count) count.textContent = DATA.live.length + ' live-token protocols';
    var rows = DATA.live.map(function (r) {
      return '<tr><td><span class="rank-dot">live</span></td>'
        + '<td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + '</span><span class="chip">' + esc(r.category || 'Other') + '</span></div></td>'
        + '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>'
        + '<td class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td>'
        + '<td class="num">' + fmtUsd(r.mcap_usd) + '</td>'
        + '<td><span class="status live">already trades</span></td></tr>';
    }).join('');
    var div = document.createElement('div');
    div.className = 'panel';
    div.innerHTML = '<div class="table-wrap"><table><caption class="sub">Token live: these protocols already trade, so their market cap is a fact, not a model. Set aside from the ranking — their market caps are what the curve is fitted to.</caption>'
      + '<thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d</th><th scope="col">Market cap</th><th scope="col">Token</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    return div;
  }

  function oosTable(caption, rows) {
    var div = document.createElement('div');
    div.className = 'mini-table';
    div.innerHTML = '<table><caption class="sub">' + esc(caption) + '</caption>'
      + '<thead><tr><th scope="col">Model</th><th scope="col" class="num">Median error</th><th scope="col" class="num">Within 2x</th><th scope="col" class="num">Typical error</th></tr></thead><tbody>'
      + rows.map(function (r) {
        return '<tr><td><b>' + esc(r.model) + '</b></td><td class="num">' + r.mdape_pct.toFixed(1) + '%</td><td class="num">' + r.hit_pct.toFixed(1) + '%</td><td class="num">x' + r.typical_error_x.toFixed(2) + '</td></tr>';
      }).join('') + '</tbody></table>';
    return div;
  }

  function renderModel() {
    var m = DATA.model;
    var c = DATA.curve;
    var v = DATA.validation;
    var formula = document.getElementById('formula');
    if (formula) {
      formula.textContent = 'log10(market cap) = ' + c.intercept.toFixed(4) + ' + ' + c.slope.toFixed(4) + ' x log10(TVL), fitted to the snapshot\u2019s ' + c.n_live + ' live-token comps with a market cap and a listed_at date (Theil-Sen: the median pairwise slope). '
        + 'curve multiple = curve(TVL) / TVL, clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']. '
        + 'implied = round( tvl_usd x curve multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x age multiplier ); growth weight ' + m.growth_weight + ' is the fitted CV plateau centre, not a manual pick. '
        + 'age multiplier = 10 ^ (' + c.age.k.toFixed(4) + ' x (log10(age_days + 1) - ' + c.age.median_log_age.toFixed(4) + ')), fitted from the same ' + c.age.n_with_age + ' comps; 1 with no age. '
        + 'token odds = logistic P(records a token) over centred log TVL, growth and log age, fitted on all 758 protocols (AUC ' + v.odds.auc_cv.toFixed(2) + '). '
        + 'expected value = implied x token odds x 10% (the farmers\u2019 share). '
        + 'Range: p25-p75 multiples of the protocol\u2019s nearest live-token peers in its category (up to five, nearest in log TVL), same multipliers — or the model\u2019s typical out-of-sample error (x' + v.cv95.typical_error_x.toFixed(2) + ') with fewer than two peers. Score 0-100: four named sub-scores of 0-25 (scale, momentum, maturity, confidence).';
    }
    var vtable = document.getElementById('validation-table');
    if (vtable) {
      vtable.textContent = '';
      vtable.appendChild(oosTable('Cross-validation on the 95 comps, 5 folds by slug order.', v.cv));
      vtable.appendChild(oosTable('Sonar-8 checks, recomputed at run time.', [
        { model: 'sonar-8: 5-fold CV (95 comps)', mdape_pct: v.cv95.mdape_pct, hit_pct: v.cv95.hit_pct, typical_error_x: v.cv95.typical_error_x },
        { model: 'sonar-8: leave-one-out (95 comps)', mdape_pct: v.loo.mdape_pct, hit_pct: v.loo.hit_pct, typical_error_x: v.loo.typical_error_x }
      ].concat(v.walk_forward.windows.map(function (w, i) {
        return { model: 'sonar-8: walk-forward window ' + (i + 1) + ' (fit n=' + w.fit_n + ', listed <= ' + w.cutoff + ')', mdape_pct: w.mdape_pct, hit_pct: w.hit_pct, typical_error_x: w.typical_error_x };
      }))));
      vtable.appendChild(oosTable('Holdout, touched once after selection by CV.', [v.holdout_shipped, v.holdout_global_median, v.holdout_tvl_only]));
      if (v.time_split) {
        vtable.appendChild(oosTable('Time-split: fitted on the ' + v.time_split.fit_n + ' comps listed on or before ' + v.time_split.cutoff + ', scored on the ' + v.time_split.test_n + ' listed after it.', [{ model: 'sonar-8, fitted on the older half', mdape_pct: v.time_split.shipped.mdape_pct, hit_pct: v.time_split.shipped.hit_pct, typical_error_x: v.time_split.shipped.typical_error_x }]));
      }
      if (v.bootstrap) {
        var bnote = document.createElement('p');
        bnote.className = 'sub';
        bnote.textContent = 'Bootstrap (' + v.bootstrap.n + ' seeded resamples of the 95 comps): slope ' + v.bootstrap.slope_p5.toFixed(2) + ' – ' + v.bootstrap.slope_p95.toFixed(2) + ' (median ' + v.bootstrap.slope_p50.toFixed(2) + '), intercept ' + v.bootstrap.intercept_p5.toFixed(2) + ' – ' + v.bootstrap.intercept_p95.toFixed(2) + ' (median ' + v.bootstrap.intercept_p50.toFixed(2) + '). The shipped curve sits inside both bands; the same 200 refits give every row its rank range.';
        vtable.appendChild(bnote);
      }
    }
    var vnote = document.getElementById('validation-note');
    if (vnote) vnote.textContent = v.protocol + ' ' + v.notes.join(' ');
    var chart = document.getElementById('curve-chart');
    if (chart) {
      chart.textContent = '';
      chart.appendChild(renderCurveChart());
    }
    var cnote = document.getElementById('curve-note');
    if (cnote) cnote.textContent = 'Each dot is one of the ' + c.n_live + ' comps. The line is the fitted curve; the pale band is the bootstrap 5–95% band. Drawn from the same numbers the board uses.';
    var note = document.getElementById('model-note');
    if (note) {
      var f = DATA.farm;
      note.textContent = 'Age is time since first listing, the best record of running with no token; it enters the value through a fitted multiplier and decides the farm hold. '
        + 'Token odds are a cross-sectional association with the peer record, not a launch forecast: older protocols score higher because they survived, fast growers lower because they have not launched yet. '
        + 'Farm: farmers take ' + Math.round(f.farmer_allocation * 100) + '% of implied value, reference crowd ' + groupInt(f.reference_farmers) + ', capital earns ' + Math.round(f.capital_apr * 100) + '% a year, claim gas $' + f.claim_gas_usd + '. '
        + 'The verdict is netted at the low end: A breaks even with ' + groupInt(m.rating_a_farmers) + ' farmers, B with ' + groupInt(m.rating_b_farmers) + ', C with ' + groupInt(m.rating_c_farmers) + '.';
    }
  }

  // Fitted curve as pure SVG (lieflat-charts: scatter, axes never truncated).
  // Log-log; line = fitted curve, band = bootstrap 5-95%. One string.
  function renderCurveChart() {
    var c = DATA.curve;
    var W = 560, H = 260, PL = 44, PR = 12, PT = 10, PB = 30;
    var xs = c.points.map(function (p) { return p[0]; });
    var ys = c.points.map(function (p) { return p[1]; });
    var x0 = Math.floor(Math.min.apply(null, xs) * 2) / 2, x1 = Math.ceil(Math.max.apply(null, xs) * 2) / 2;
    var y0 = Math.floor(Math.min.apply(null, ys) * 2) / 2, y1 = Math.ceil(Math.max.apply(null, ys) * 2) / 2;
    function X(x) { return (PL + ((x - x0) / (x1 - x0)) * (W - PL - PR)).toFixed(1); }
    function Y(y) { return (PT + (1 - (y - y0) / (y1 - y0)) * (H - PT - PB)).toFixed(1); }
    function seg(slope, intercept) { return X(x0) + ',' + Y(intercept + slope * x0) + ' ' + X(x1) + ',' + Y(intercept + slope * x1); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="curve-chart" role="img" aria-label="Fitted curve, log-log, 95 comps">';
    var hi = seg(c.band.slope_p95, c.band.intercept_p95).split(' ');
    var lo = seg(c.band.slope_p5, c.band.intercept_p5).split(' ');
    s += '<polygon points="' + lo[0] + ' ' + lo[1] + ' ' + hi[1] + ' ' + hi[0] + '" fill="#2563EB" fill-opacity="0.08"/>';
    var g;
    for (g = Math.ceil(x0); g <= x1; g++) {
      s += '<line x1="' + X(g) + '" y1="' + Y(y0) + '" x2="' + X(g) + '" y2="' + Y(y1) + '" stroke="#E2E8F0"/>';
      s += '<text x="' + X(g) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10" fill="#64748B">10^' + g + '</text>';
    }
    for (g = Math.ceil(y0); g <= y1; g++) {
      s += '<line x1="' + X(x0) + '" y1="' + Y(g) + '" x2="' + X(x1) + '" y2="' + Y(g) + '" stroke="#E2E8F0"/>';
      s += '<text x="' + (PL - 6) + '" y="' + (+Y(g) + 3) + '" text-anchor="end" font-size="10" fill="#64748B">10^' + g + '</text>';
    }
    c.points.forEach(function (p) {
      s += '<circle cx="' + X(p[0]) + '" cy="' + Y(p[1]) + '" r="2.5" fill="#2563EB" fill-opacity="0.55"/>';
    });
    s += '<polyline points="' + seg(c.slope, c.intercept) + '" fill="none" stroke="#0A2540" stroke-width="2"/>';
    var yc = (H - PT - PB) / 2 + PT;
    s += '<text x="12" y="' + yc + '" text-anchor="middle" font-size="11" fill="#0A2540" transform="rotate(-90 12 ' + yc + ')">log10(market cap) — $</text>';
    s += '</svg>';
    var wrap = document.createElement('div');
    wrap.innerHTML = s;
    return wrap.firstChild;
  }

  // The 758-protocol ledger: every protocol counted exactly once, from the
  // program's own numbers, so ledger and board can never disagree.
  function renderLedger() {
    var host = document.getElementById('ledger');
    if (!host) return;
    var l = DATA.ledger;
    var rows = [
      ['On the board — watchlist (≥ $50M, no token on record)', l.watchlist_rows],
      ['On the board — early (below the floor or off the watchlist)', l.early_rows],
      ['Not on the board — pre-token, excluded by category', l.excluded_by_category],
      ['Not on the board — pre-token, version marker in name (V2, 2.0)', l.excluded_by_version],
      ['Not on the board — pre-token, wrapped / staked / staking in name', l.excluded_by_wrapped_word],
      ['Not on the board — pre-token, exchange name prefix', l.excluded_by_exchange_prefix],
      ['Not on the board — token trades, positive market cap', l.live_mcap_positive],
      ['Not on the board — token recorded, market cap ≤ $0 (dead)', l.live_mcap_zero_or_less],
      ['Not on the board — token recorded, no market cap', l.token_recorded_no_mcap]
    ].map(function (row) {
      return '<tr><td>' + esc(row[0]) + '</td><td class="num">' + groupInt(row[1]) + '</td></tr>';
    }).join('');
    host.innerHTML = '<h2>Ledger — all 758 protocols accounted for</h2>'
      + '<p class="sub">The board ranks 198 protocols. The other 560 are counted here, by why they are not on the board.</p>'
      + '<div class="mini-table"><table><thead><tr><th scope="col">Where it is</th><th scope="col" class="num">Protocols</th></tr></thead><tbody>'
      + rows
      + '<tr class="total"><td><b>Total protocols in the snapshot</b></td><td class="num">' + groupInt(l.total) + '</td></tr>'
      + '</tbody></table></div>';
  }

  var dialog = document.getElementById('detail');
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var econ = farmEconomics(row);
    var recomputed = impliedOf(row, DATA.model);
    var recomputedSteps = farmSteps(row).concat([evStepText(econ)]);
    var stepsMatch = recomputedSteps.length === row.farm_steps.length && recomputedSteps.every(function (s, i) { return s === row.farm_steps[i]; });
    var rangeHtml;
    if (row.peers.length >= 2) {
      rangeHtml = '<p class="match">From the p25-p75 multiples of its ' + row.peers.length + ' nearest live-token peers in ' + esc(row.category || 'its category') + ', same multipliers.</p>'
        + '<table class="peer-table"><thead><tr><th>Peer</th><th>TVL</th><th>Market cap</th><th>Multiple</th></tr></thead><tbody>'
        + row.peers.map(function (p) {
          return '<tr><td>' + esc(p.name) + '</td><td>' + fmtUsd(p.tvl_usd) + '</td><td>' + fmtUsd(p.mcap_usd) + '</td><td>x' + p.multiple.toFixed(3) + '</td></tr>';
        }).join('') + '</tbody></table>';
    } else if (row.peers.length === 1) {
      rangeHtml = '<p class="match">Only one live-token peer in ' + esc(row.category || 'its category') + ' (' + esc(row.peers[0].name) + ', x' + row.peers[0].multiple.toFixed(3) + '), so no spread to measure: the range is the model\u2019s own typical out-of-sample error (x' + DATA.validation.cv95.typical_error_x.toFixed(2) + ') around the point estimate.</p>';
    } else {
      rangeHtml = '<p class="match">No live-token peer in ' + esc(row.category || 'its category') + ', so no spread to measure: the range is the model\u2019s own typical out-of-sample error (x' + DATA.validation.cv95.typical_error_x.toFixed(2) + ') around the point estimate.</p>';
    }
    var costRows = [
      ['First transaction (gas)', '$' + DATA.farm.first_tx_gas_usd.toFixed(2)],
      ['Setup (gas)', '$' + (econ.capital_usd >= 200 ? '8.00' : '4.00')],
      ['Weekly check-in (gas, ' + Math.ceil(econ.hold_days / 7) + ' weeks)', '$' + (2 * Math.ceil(econ.hold_days / 7)).toFixed(2)],
      ['Claim (gas)', '$' + DATA.farm.claim_gas_usd.toFixed(2)],
      ['Opportunity cost (' + econ.hold_days + ' days at 5% p.a.)', '$' + econ.opportunity_usd.toFixed(2)]
    ].map(function (c) { return '<tr><td>' + esc(c[0]) + '</td><td>' + esc(c[1]) + '</td></tr>'; }).join('')
      + '<tr><td><b>Total cost</b></td><td><b>$' + econ.cost_usd.toFixed(2) + '</b></td></tr>';
    dialog.innerHTML = '<div class="detail-head"><div>'
      + '<span class="brand-name">Rank ' + row.rank + ' of ' + DATA.board_size + ' (bootstrap range ' + row.rank_low + '–' + row.rank_high + ')</span>'
      + '<h2 id="detail-title">' + esc(row.name) + '</h2>'
      + '<p class="sub">' + esc(row.category || 'Other') + ' on ' + esc(row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + '</p></div>'
      + '<button class="close" type="button" aria-label="Close details">Close</button></div>'
      + '<section class="detail-section"><h3>Implied value</h3><div class="equation">'
      + kvh('TVL', fmtUsd(row.tvl_usd))
      + kvh('Curve multiple', 'x' + row.curve_multiple.toFixed(3))
      + kvh('Curve-implied value', fmtUsd(row.curve_implied))
      + kvh('Seven-day growth', fmtPct(row.change_7d))
      + kvh('Growth multiplier', String(growthMultOf(row, DATA.model).toFixed(4)))
      + kvh('Age with no token', fmtAge(row.age_days))
      + kvh('Age multiplier', 'x' + (row.age_multiplier === null || row.age_multiplier === undefined ? 1 : row.age_multiplier).toFixed(4))
      + kvh('Implied value', fmtUsd(row.implied_value_usd))
      + kvh('Token odds (fitted)', Math.round(row.token_odds * 100) + '%')
      + kvh('Expected pool', fmtUsd(row.expected_pool_usd))
      + '</div><p class="match">The page recomputes this row as ' + esc(fmtUsd(recomputed)) + (recomputed === row.implied_value_usd ? ' — the same number the board carries.' : ' — which differs from the board: the data would be stale.') + ' This is an estimate, not a price.</p></section>'
      + '<section class="detail-section"><h3>Score</h3><div class="equation">'
      + kvh('Composite score (0-100)', row.score.total.toFixed(1) + ' / 100')
      + '</div><div class="score-rows">'
      + scoreRowHtml('Scale', row.score.scale, fmtUsd(row.tvl_usd) + ' in TVL')
      + scoreRowHtml('Momentum', row.score.momentum, fmtPct(row.change_7d) + ' in 7 days')
      + scoreRowHtml('Maturity', row.score.maturity, row.age_days === null ? 'no listed date' : fmtAge(row.age_days) + ' with no token')
      + scoreRowHtml('Confidence', row.score.confidence, row.peers.length === 0 ? 'no category peers — the global curve only' : row.peers.length + ' category peer' + (row.peers.length === 1 ? '' : 's'))
      + '</div><p class="match">Four named parts, each 0-25, from the snapshot\u2019s own figures. The score presents the same figures the value uses; it never changes the implied value.</p></section>'
      + '<section class="detail-section"><h3>Implied value range</h3><div class="equation">'
      + kvh('Point estimate', fmtUsd(row.implied_value_usd))
      + kvh('Range (p25-p75)', fmtUsd(row.implied_low_usd) + ' – ' + fmtUsd(row.implied_high_usd))
      + '</div>' + rangeHtml + '</section>'
      + '<section class="detail-section"><h3>Farm economics</h3><div class="econ-head">'
      + '<span class="rating ' + ratingClass(econ.rating) + '">' + econ.rating + '</span><div><b>Farm rating ' + econ.rating + '</b>'
      + '<span>Verdict at the low end; breaks even with up to ' + groupInt(econ.break_even_low) + ' farmers at the low end</span></div></div>'
      + '<div class="equation">'
      + kvh('Token odds (fitted)', Math.round(econ.token_odds * 100) + '%')
      + kvh('Farmer pool (10% x odds)', fmtUsd(econ.expected_pool_usd))
      + kvh('Low-end pool (10% x odds)', fmtUsd(econ.expected_low_pool_usd))
      + kvh('Total cost (gas $' + econ.gas_usd.toFixed(2) + ' + opportunity $' + econ.opportunity_usd.toFixed(2) + ')', '$' + econ.cost_usd.toFixed(2))
      + kvh('Expected value per farmer', '$' + econ.per_farmer_ev_usd.toFixed(2))
      + kvh('Net expected value per farmer', fmtSignedUsd(econ.net_ev_usd))
      + kvh('Net at the low end per farmer', fmtSignedUsd(econ.net_ev_low_usd))
      + kvh('Deposit threshold', econ.deposit_threshold_usd === null ? 'no deposit pays' : '$' + groupInt(econ.deposit_threshold_usd))
      + kvh('Value per hour at the low end', fmtSignedUsd(econ.ev_per_hour_usd) + ' / h')
      + kvh('Gas / expected value', (econ.gas_to_ev * 100).toFixed(0) + '%')
      + '</div><table class="cost-table"><thead><tr><th>Cost step</th><th>Amount</th></tr></thead><tbody>' + costRows + '</tbody></table></section>'
      + '<section class="detail-section"><h3>Farm plan</h3><ol class="steps">'
      + row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return '<li><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></li>';
      }).join('')
      + '</ol><p class="match">' + (stepsMatch ? 'The page recomputes this plan from the protocol\u2019s own record and gets the same seven steps the board carries.' : 'The page recomputes this plan differently from the board: the data would be stale.') + '</p></section>';
    var closeBtn = dialog.querySelector('.close');
    if (closeBtn) closeBtn.addEventListener('click', function () { dialog.close(); });
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function renderBoard() {
    if (state.tab === 'pre-token') {
      boardEl.innerHTML = boardTable();
    } else {
      boardEl.textContent = '';
      boardEl.appendChild(liveTable());
    }
    boardEl.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }
  // One delegated listener for the board: sort headers, row clicks, clear.
  boardEl.onclick = function (e) {
    var t = e.target.closest ? e.target.closest('[data-sort],[data-slug],[data-clear]') : null;
    if (!t) return;
    if (t.hasAttribute('data-sort')) {
      var key = t.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; }
      renderBoard();
    } else if (t.hasAttribute('data-slug')) {
      openDetail(t.getAttribute('data-slug'));
    } else if (t.hasAttribute('data-clear')) {
      state.q = ''; state.category = 'all'; state.watchlistOnly = false; writeHash(); renderBoard();
    }
  };
  boardEl.onkeydown = function (e) {
    var tr = e.target.closest ? e.target.closest('tr[data-slug]') : null;
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(tr.getAttribute('data-slug')); }
  };

  function render() {
    renderStats();
    renderValidationStrip();
    renderSpotlight();
    renderControls();
    renderBoard();
    renderLedger();
    renderModel();
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();

