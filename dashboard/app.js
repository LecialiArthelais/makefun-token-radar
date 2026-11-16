// D Sonar's dashboard, sonar-5. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the KPI hero, the top-three spotlight,
// the filterable board, the live-token view, the model section with its
// out-of-sample validation, and a detail drawer for every protocol with the
// model's own inputs, the farm's economics, and the protocol's farm plan.
// No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var boardEl = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, watchlistOnly: false, selected: null };
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
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

  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic. The curve multiple and
  // the age multiplier are the row's stored figures; the growth multiplier is
  // recomputed here.
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

  /** One sub-score row: label, a bar scaled to 0-25, the value, and why. */
  function scoreRowEl(label, value, why) {
    return el('div', { class: 'score-row' },
      el('span', { class: 'score-label', text: label }),
      el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((value / 25) * 100)) + '%' })),
      el('b', { class: 'num', text: value.toFixed(1) }),
      el('span', { class: 'score-why', text: why })
    );
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category,
  // chains, TVL and age decide the action, the capital, the hold and every cost
  // and time. No name is special-cased. The drawer renders the board's own
  // step strings and says whether this derivation matches them.
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
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + capital + ' of USDC on ' + name + ' (' + chain + ') and leave the deposit earning.';
    if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0 || c.indexOf('swap') >= 0) return 'Swap $' + capital + ' through ' + name + ' on ' + chain + ', then add the same size to its main pool as liquidity.';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return 'Deposit $' + capital + " into " + name + "'s main vault on " + chain + ' and keep the receipt tokens.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC into ' + chain + ' through ' + name + ', then use the bridged funds inside its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and hold the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Post $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and take one position in a live market on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or hold $' + capital + ' of the stable asset ' + name + ' issues on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and use the app once a week.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Open a fresh wallet for this farm only, fund it with just the capital below, and store its seed phrase offline, never in a screenshot or a chat.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 200 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Return once a week and do one real action, a deposit, a swap, a borrow or a vote, so the wallet shows a pattern, not a single spike.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Keep the position for at least ' + hold + ' days, across more than one snapshot, instead of farming and leaving in a day.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "When a claim opens, use only the link on the protocol's own rewards page. A claim that asks you to pay, connect, or sign a blind approval is a scam.", cost: 'no fee to check', time: '10 minutes' },
      { text: 'Log the wallet, the dates, and every transaction hash in one note, so you can prove the activity or unwind it later.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }
  // The farm's economics, the same arithmetic main.ts writes to board.json:
  // the launch chance rises with TVL on a log scale; the farmers' pool is the
  // implied value times that chance times the farmers' 10% share; the cost is
  // the gas the plan states plus the capital's opportunity cost at 5% a year.
  // The rating follows the break-even farmer count, not an assumed crowd.
  function launchProbability(p) {
    var t = Math.log10(p.tvl_usd / 5e7) / 2;
    return round4(clamp(0.3 + 0.4 * t, 0.3, 0.7));
  }
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
    var probability = launchProbability(row);
    var pool = row.implied_value_usd * probability * f.farmer_allocation;
    var ev = pool / f.reference_farmers;
    var net = ev - cost;
    var breakEven = cost > 0 ? Math.round(pool / cost) : 0;
    var rating = breakEven >= m.rating_a_farmers ? 'A' : breakEven >= m.rating_b_farmers ? 'B' : breakEven >= m.rating_c_farmers ? 'C' : 'Skip';
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
      rating: rating
    };
  }
  function evStepText(e) {
    var net = e.net_ev_usd >= 0 ? '+$' + e.net_ev_usd.toFixed(2) : '-$' + Math.abs(e.net_ev_usd).toFixed(2);
    return 'Breaks even with up to ' + groupInt(e.break_even_farmers) + ' farmers; at the ' + groupInt(DATA.farm.reference_farmers) + '-farmer reference the net is ' + net + ' per farmer (farmer pool $' + groupInt(e.farmer_pool_usd) + ', total cost $' + e.cost_usd.toFixed(2) + '). Rating ' + e.rating + '.';
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('watchlist') === '1') state.watchlistOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.watchlistOnly) params.set('watchlist', '1');
    if (state.selected) params.set('p', state.selected);
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
      else if (key === 'farm') { av = farmEconomics(a).net_ev_usd; bv = farmEconomics(b).net_ev_usd; }
      else if (key === 'rating') { av = ratingRank(farmEconomics(a).rating); bv = ratingRank(farmEconomics(b).rating); }
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

  /** CSS class suffix for a rating. 'Skip' uses skip-r because .skip is the skip-to-content link (positioned off-screen). */
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
      host.textContent = '';
      host.appendChild(el('div', { class: 'stat' }, el('b', { text: covered + ' / ' + DATA.watchlist_size }), el('span', { text: 'Watchlist covered' })));
      host.appendChild(el('div', { class: 'stat' }, el('b', { text: shippedCv ? Math.round(shippedCv.mdape_pct) + '%' : 'n/a' }), el('span', { text: 'Out-of-sample median error (5-fold CV)' })));
      host.appendChild(el('div', { class: 'stat' }, el('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' }), el('span', { text: 'Top implied value' })));
      host.appendChild(el('div', { class: 'stat' }, el('b', { text: farmable + ' / ' + DATA.board_size }), el('span', { text: 'Farms rated A, B or C (worth farming)' })));
      host.appendChild(el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'Pre-token rows scored' })));
      host.appendChild(el('div', { class: 'stat' }, el('b', { text: at100m ? 'x' + at100m.multiple.toFixed(2) : 'n/a' }), el('span', { text: 'Curve multiple at $100M TVL' })));
    }
    var date = document.getElementById('meta-date');
    if (date) date.textContent = 'Snapshot ' + DATA.as_of;
    var model = document.getElementById('meta-model');
    if (model) model.textContent = DATA.model_version + ' model';
    var metaRows = document.getElementById('meta-rows');
    if (metaRows) metaRows.textContent = DATA.board_size + ' pre-token protocols';
    var footEarly = document.getElementById('foot-early');
    if (footEarly) footEarly.textContent = String(DATA.early_size);
  }

  function renderValidationStrip() {
    var host = document.getElementById('validation-strip');
    if (!host) return;
    var v = DATA.validation;
    var shippedCv = null;
    var medianCv = null;
    var tvlCv = null;
    v.cv.forEach(function (r) {
      if (r.model.indexOf(DATA.model_version) === 0) shippedCv = r;
      if (r.model === 'Global median') medianCv = r;
      if (r.model.indexOf('TVL only') === 0) tvlCv = r;
    });
    host.textContent = '';
    host.appendChild(el('span', { class: 'v-label', text: 'Tested out of sample' }));
    host.appendChild(document.createTextNode('The curve\u2019s median error is '));
    host.appendChild(el('b', { text: Math.round(shippedCv.mdape_pct) + '%' }));
    host.appendChild(document.createTextNode(' (5-fold CV, 103 protocols) and '));
    host.appendChild(el('b', { text: Math.round(v.holdout_shipped.mdape_pct) + '%' }));
    host.appendChild(document.createTextNode(' on a ' + v.holdout_n + '-protocol holdout. A global median scores '));
    host.appendChild(el('b', { text: Math.round(medianCv.mdape_pct) + '%' }));
    host.appendChild(document.createTextNode(' / '));
    host.appendChild(el('b', { text: Math.round(v.holdout_global_median.mdape_pct) + '%' }));
    host.appendChild(document.createTextNode('; TVL alone scores '));
    host.appendChild(el('b', { text: Math.round(tvlCv.mdape_pct) + '%' }));
    host.appendChild(document.createTextNode(' / '));
    host.appendChild(el('b', { text: Math.round(v.holdout_tvl_only.mdape_pct) + '%' }));
    host.appendChild(document.createTextNode('. The curve is fitted to the snapshot\u2019s own live-token protocols; growth is kept at quarter weight and age enters through a fitted multiplier.')); 
  }

  function renderSpotlight() {
    var host = document.getElementById('spotlight');
    if (!host) return;
    host.textContent = '';
    DATA.rows.slice(0, 3).forEach(function (r, i) {
      var card = el('button', { type: 'button', class: 'spot' + (i === 0 ? ' first' : ''), onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'spot-rank', text: 'Rank ' + r.rank }),
        el('span', { class: 'spot-name', text: r.name }),
        el('span', { class: 'spot-value', text: fmtUsd(r.implied_value_usd) + ' implied' }),
        el('span', { class: 'spot-sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
        el('span', { class: 'spot-meta', text: 'TVL ' + fmtUsd(r.tvl_usd) + '  ·  7d ' + fmtPct(r.change_7d) + '  ·  age ' + fmtAge(r.age_days) })
      );
      host.appendChild(card);
    });
  }

  function renderControls() {
    var host = document.getElementById('controls');
    if (!host) return;
    host.textContent = '';
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or category', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderBoard(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); renderBoard(); });
    var sort = el('select', { id: 'sort', 'aria-label': 'Sort the board' },
      [['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7-day growth'], ['age', 'Sort: age'], ['farm', 'Sort: farm net EV'], ['rating', 'Sort: farm rating'], ['name', 'Sort: name']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: o[0] === state.sort ? 'selected' : null });
      })
    );
    sort.addEventListener('change', function () { state.sort = sort.value; renderBoard(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); renderBoard(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); renderBoard(); } });
    var watch = el('button', { type: 'button', class: 'toggle', 'aria-pressed': state.watchlistOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watchlistOnly = !state.watchlistOnly; writeHash(); renderBoard(); } });
    host.appendChild(el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort' }), sort),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      watch,
      el('span', { class: 'count', id: 'count', text: '' })
    ));
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } renderBoard(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    var count = document.getElementById('count');
    if (count) count.textContent = list.length + ' rows shown';
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.watchlistOnly = false; writeHash(); renderBoard(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var econ = farmEconomics(r);
      var tr = el('tr', {
        class: r.rank <= 3 ? 'top3' : null,
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', null, el('span', { class: 'rank-dot', text: String(r.rank) })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
          el('span', { class: 'chip', text: r.category || 'Other' })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('div', { class: 'farm-cell' },
          el('span', { class: 'rating ' + ratingClass(econ.rating), text: econ.rating }),
          el('span', { class: 'num ' + (econ.net_ev_usd >= 0 ? 'pos' : 'neg'), text: fmtSignedUsd(econ.net_ev_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('farm', 'Farm'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var count = document.getElementById('count');
    if (count) count.textContent = DATA.live.length + ' live-token protocols';
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'rank-dot', text: 'live' })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
          el('span', { class: 'chip', text: r.category || 'Other' })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their market caps are what the curve is fitted to.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function oosTable(caption, rows) {
    var tbody = el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: r.model })),
        el('td', { class: 'num', text: r.mdape_pct.toFixed(1) + '%' }),
        el('td', { class: 'num', text: r.hit_pct.toFixed(1) + '%' }),
        el('td', { class: 'num', text: 'x' + r.typical_error_x.toFixed(2) })
      ));
    });
    return el('div', { class: 'mini-table' },
      el('table', null,
        el('caption', { class: 'sub', text: caption }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Model' }),
          el('th', { scope: 'col', class: 'num', text: 'Median error' }),
          el('th', { scope: 'col', class: 'num', text: 'Within 2x' }),
          el('th', { scope: 'col', class: 'num', text: 'Typical error' })
        )),
        tbody
      )
    );
  }

  function renderModel() {
    var m = DATA.model;
    var c = DATA.curve;
    var v = DATA.validation;
    var formula = document.getElementById('formula');
    if (formula) {
      formula.textContent = 'log10(market cap) = ' + c.intercept.toFixed(4) + ' + ' + c.slope.toFixed(4) + ' x log10(TVL), fitted to the snapshot\u2019s own ' + c.n_live + ' live-token protocols with a positive market cap (Theil-Sen: the median pairwise slope). '
        + 'curve multiple = curve(TVL) / TVL, clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']. '
        + 'implied = round( tvl_usd x curve multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x age multiplier ). '
        + 'age multiplier = 10 ^ (' + c.age.k.toFixed(4) + ' x (log10(age_days + 1) - ' + c.age.median_log_age.toFixed(4) + ')), fitted from the snapshot\u2019s own ' + c.age.n_with_age + ' live-token protocols that carry a listed_at date; 1 when a protocol carries no age. '
        + 'The range is the p25-p75 multiples of the protocol\u2019s nearest live-token peers in its own category (up to five, nearest in log TVL), carried through the same growth and age multipliers — or the model\u2019s typical out-of-sample error (x3.49) when fewer than two peers exist. The 0-100 score is four named sub-scores of 0-25 each (scale, momentum, maturity, confidence), all from the snapshot\u2019s own figures.';
    }
    var examples = document.getElementById('curve-examples');
    if (examples) {
      examples.textContent = '';
      var wrap = el('div', { class: 'mult-table' });
      c.examples.forEach(function (e) {
        wrap.appendChild(el('span', { class: 'mult' }, el('span', { text: 'TVL ' + fmtUsd(e.tvl_usd) }), el('b', { text: 'x' + e.multiple.toFixed(3) + '  ·  ' + fmtUsd(e.implied_usd) })));
      });
      examples.appendChild(wrap);
    }
    var vtable = document.getElementById('validation-table');
    if (vtable) {
      vtable.textContent = '';
      vtable.appendChild(oosTable('Cross-validation on 103 live-token protocols, 5 folds by slug order.', v.cv));
      vtable.appendChild(oosTable('Holdout on ' + v.holdout_n + ' live-token protocols, touched once after selection by CV.', [v.holdout_shipped, v.holdout_global_median, v.holdout_tvl_only]));
    }
    var vnote = document.getElementById('validation-note');
    if (vnote) vnote.textContent = v.protocol + ' ' + v.notes.join(' ');
    var lex = document.getElementById('live-examples');
    if (lex) {
      lex.textContent = '';
      var tbody = el('tbody');
      v.live_examples.forEach(function (e) {
        tbody.appendChild(el('tr', null,
          el('td', null, el('b', { text: e.name })),
          el('td', { class: 'num', text: fmtUsd(e.tvl_usd) }),
          el('td', { class: 'num', text: fmtUsd(e.mcap_usd) }),
          el('td', { class: 'num', text: fmtUsd(e.curve_implied_usd) }),
          el('td', { class: 'num', text: (e.curve_implied_usd / e.mcap_usd).toFixed(2) + 'x' })
        ));
      });
      lex.appendChild(el('div', { class: 'mini-table' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Eight live-token protocols, one per TVL octile, each the median-multiple protocol of its octile. The curve is within 2x on all eight.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'num', text: 'TVL' }),
            el('th', { scope: 'col', class: 'num', text: 'Actual market cap' }),
            el('th', { scope: 'col', class: 'num', text: 'Curve says' }),
            el('th', { scope: 'col', class: 'num', text: 'Ratio' })
          )),
          tbody
        )
      ));
    }
    var note = document.getElementById('model-note');
    if (note) {
      var f = DATA.farm;
      note.textContent = 'Age is the time since the protocol was first listed, the best record of how long it has run with no token; it enters the value through a fitted multiplier (a young protocol is worth more than the curve alone says, an old one slightly less) and it decides the farm hold. '
        + 'Farm: the farmers\u2019 share is ' + Math.round(f.farmer_allocation * 100) + '% of the implied value, the reference crowd is ' + groupInt(f.reference_farmers) + ' farmers, capital earns ' + Math.round(f.capital_apr * 100) + '% a year, claim gas is $' + f.claim_gas_usd + '. '
        + 'Rating A breaks even with ' + groupInt(m.rating_a_farmers) + ' farmers, B with ' + groupInt(m.rating_b_farmers) + ', C with ' + groupInt(m.rating_c_farmers) + '.';
    }
  }

  var dialog = document.getElementById('detail');
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var econ = farmEconomics(row);
    var recomputed = impliedOf(row, DATA.model);
    var recomputedSteps = farmSteps(row).concat([evStepText(econ)]);
    var stepsMatch = recomputedSteps.length === row.farm_steps.length;
    if (stepsMatch) {
      for (var i = 0; i < recomputedSteps.length; i++) {
        if (recomputedSteps[i] !== row.farm_steps[i]) { stepsMatch = false; break; }
      }
    }
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Curve multiple' }), el('b', { text: 'x' + row.curve_multiple.toFixed(3) })),
        el('div', null, el('span', { text: 'Curve-implied value' }), el('b', { text: fmtUsd(row.curve_implied) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { text: String(growthMultOf(row, DATA.model).toFixed(4)) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Age multiplier' }), el('b', { text: 'x' + (row.age_multiplier === null || row.age_multiplier === undefined ? 1 : row.age_multiplier).toFixed(4) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'match', text: 'The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ' — the same number the board carries.' : ' — which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Score' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Composite score (0-100)' }), el('b', { text: row.score.total.toFixed(1) + ' / 100' }))
      ),
      el('div', { class: 'score-rows' },
        scoreRowEl('Scale', row.score.scale, fmtUsd(row.tvl_usd) + ' in TVL'),
        scoreRowEl('Momentum', row.score.momentum, fmtPct(row.change_7d) + ' in 7 days'),
        scoreRowEl('Maturity', row.score.maturity, row.age_days === null ? 'no listed date' : fmtAge(row.age_days) + ' with no token'),
        scoreRowEl('Confidence', row.score.confidence, row.peers.length === 0 ? 'no category peers — the global curve only' : row.peers.length + ' category peer' + (row.peers.length === 1 ? '' : 's'))
      ),
      el('p', { class: 'match', text: 'Four named parts, each 0-25, all from the snapshot\u2019s own figures. The score presents the same figures the value already uses; it never changes the implied value.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value range' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Point estimate' }), el('b', { text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Range (p25-p75)' }), el('b', { text: fmtUsd(row.implied_low_usd) + ' – ' + fmtUsd(row.implied_high_usd) }))
      ),
      row.peers.length >= 2
        ? el('div', null,
            el('p', { class: 'match', text: 'From the p25-p75 multiples of its ' + row.peers.length + ' nearest live-token peers in ' + (row.category || 'its category') + ', carried through the same growth and age multipliers.' }),
            el('table', { class: 'peer-table' },
              el('thead', null, el('tr', null, el('th', { text: 'Peer' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'Multiple' }))),
              el('tbody', null, row.peers.map(function (p) {
                return el('tr', null,
                  el('td', { text: p.name }),
                  el('td', { text: fmtUsd(p.tvl_usd) }),
                  el('td', { text: fmtUsd(p.mcap_usd) }),
                  el('td', { text: 'x' + p.multiple.toFixed(3) }));
              }))
            )
          )
        : el('p', { class: 'match', text: row.peers.length === 1
            ? 'Only one live-token peer in ' + (row.category || 'its category') + ' (' + row.peers[0].name + ', x' + row.peers[0].multiple.toFixed(3) + '), so no spread to measure: the range is the model\u2019s own typical out-of-sample error (x3.49) around the point estimate.'
            : 'No live-token peer in ' + (row.category || 'its category') + ', so no spread to measure: the range is the model\u2019s own typical out-of-sample error (x3.49) around the point estimate.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm economics' }),
      el('div', { class: 'econ-head' },
        el('span', { class: 'rating ' + ratingClass(econ.rating), text: econ.rating }),
        el('div', null,
          el('b', { text: 'Farm rating ' + econ.rating }),
          el('span', { text: 'Breaks even with up to ' + groupInt(econ.break_even_farmers) + ' farmers' })
        )
      ),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Chance it launches and rewards farmers' }), el('b', { text: Math.round(econ.launch_probability * 100) + '%' })),
        el('div', null, el('span', { text: 'Farmer pool (10% of implied value)' }), el('b', { text: fmtUsd(econ.farmer_pool_usd) })),
        el('div', null, el('span', { text: 'Total cost (gas $' + econ.gas_usd.toFixed(2) + ' + opportunity $' + econ.opportunity_usd.toFixed(2) + ')' }), el('b', { text: '$' + econ.cost_usd.toFixed(2) })),
        el('div', null, el('span', { text: 'Expected value per farmer (50,000-farmer reference)' }), el('b', { text: '$' + econ.per_farmer_ev_usd.toFixed(2) })),
        el('div', null, el('span', { text: 'Net expected value per farmer' }), el('b', { text: fmtSignedUsd(econ.net_ev_usd) })),
        el('div', null, el('span', { text: 'Gas / expected value' }), el('b', { text: (econ.gas_to_ev * 100).toFixed(0) + '%' }))
      )
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { class: 'match', text: stepsMatch ? 'The page recomputes this plan from the protocol\u2019s own record and gets the same seven steps the board carries.' : 'The page recomputes this plan differently from the board: the data would be stale.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function renderBoard() {
    boardEl.textContent = '';
    boardEl.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    boardEl.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }

  function render() {
    renderStats();
    renderValidationStrip();
    renderSpotlight();
    renderControls();
    renderModel();
    renderBoard();
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();

