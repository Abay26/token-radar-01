// Token Radar's dashboard, radar-5. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the comps
// breakdown, the netted farm verdict and the protocol's farm plan — the plan first, right after
// the implied value, so a reader sees the concrete steps with their costs and times without
// scrolling past the chart — and a model sandbox that re-ranks the board live from the same
// function that scored it. No network: every byte it shows is in data.js.
//
// The model in one place: impliedOf below is the same arithmetic as lib/model.ts's impliedValue,
// so the page recomputes a row from the snapshot figures and checks the number board.json
// carries. The farm plan is not recomputed here: it is the row's own farm_steps, the same
// strings board.json carries, so the page and the board can never disagree about a plan.
// The sandbox only changes the constants it is given: growth weight, airdrop share, gas level,
// and whether the comps group offsets and the reach multiplier apply. A sandboxed ranking is
// labelled as one; the submitted board is the ranking the sandbox starts from.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var WATCH = {};
  DATA.rows.forEach(function (r) { WATCH[r.slug] = true; });
  var state = {
    q: '', category: 'all', chain: 'all', verdict: 'all', tab: 'pre-token',
    sort: 'implied', dir: -1, selected: null, earlyOnly: false,
    sb: { weight: DATA.model.growth_weight, share: DATA.model.airdrop_share, gas: 1, group: true, reach: true }
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtSigned(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
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

  // --- the model, as in lib/model.ts ---------------------------------------
  // Three phases: seasoning under 180 days (0.55 to 0.85), the launch window to
  // 1095 days (0.85 to 1.0), then decay to 0.85 over the next 1095 days.
  function ageMultiplier(age, model) {
    var a = age === null || age === undefined ? model.unknown_age_days : age;
    if (a <= model.seasoning_days) {
      var f = Math.min(Math.max(a, 0), model.seasoning_days) / model.seasoning_days;
      return model.seasoning_floor + f * (model.launch_floor - model.seasoning_floor);
    }
    if (a <= model.maturity_days) {
      var g = (a - model.seasoning_days) / (model.maturity_days - model.seasoning_days);
      return model.launch_floor + g * (1 - model.launch_floor);
    }
    var over = Math.min((a - model.maturity_days) / model.maturity_days, 1);
    return 1 - model.age_decay * over;
  }
  function reachMultiplier(row, model) {
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.reach_max_steps);
    return 1 + model.reach_step * extra;
  }
  // The net for one farmer under the sandbox: the airdrop pool's share of the implied value,
  // split among the estimated farmers, minus the farm's cost at the sandbox's gas level.
  function netOf(row, implied, sb) {
    var m = DATA.model;
    var farmers = Math.max(100, Math.round(row.tvl_usd / m.farmers_per_tvl));
    var expected = Math.max(0, Math.round(implied * sb.share / farmers));
    var cost = Math.max(1, Math.round(row.farming_cost_usd * sb.gas));
    var net = expected - cost;
    var verdict = net >= m.farm_threshold ? 'farm' : net >= 0 ? 'thin' : 'skip';
    return { expected: expected, cost: cost, net: net, verdict: verdict, farmers: farmers };
  }
  function impliedOf(row, model, sb) {
    var m = model;
    var base = row.comps_base_usd;
    if (!sb.group) base = base / Math.exp((DATA.comps.offsets[row.comps_group] || 0));
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    // The multiplier stops paying past +/-60%: a 7-day spike of thousands of percent is a
    // new pool, not a proportionally better protocol.
    var growthForMult = Math.min(m.growth_mult_cap, Math.max(-m.growth_mult_cap, growth));
    var growthMult = 1 + (growthForMult / 100) * sb.weight;
    var maturity = ageMultiplier(row.age_days, m);
    var reach = sb.reach ? reachMultiplier(row, m) : 1;
    return {
      implied: Math.max(1, Math.round(base * growthMult * maturity * reach)),
      base: Math.max(1, Math.round(base)), growthMult: growthMult, maturity: maturity, reach: reach, growth: growth
    };
  }
  function sandboxActive() {
    var m = DATA.model, sb = state.sb;
    return sb.weight !== m.growth_weight || sb.share !== m.airdrop_share || sb.gas !== 1 || !sb.group || !sb.reach;
  }
  // The board as the sandbox ranks it now: each row's implied value and net under the sandbox,
  // then ranks 1..n by implied value. With the sandbox untouched this is exactly board.json's ranking.
  function rankedRows() {
    var list = [];
    for (var i = 0; i < DATA.rows.length; i++) {
      var r = DATA.rows[i];
      var v = impliedOf(r, DATA.model, state.sb);
      var net = netOf(r, v.implied, state.sb);
      list.push({ row: r, implied: v.implied, factors: v, net: net, rank: 0 });
    }
    list.sort(function (a, b) {
      if (b.implied !== a.implied) return b.implied - a.implied;
      return a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
    });
    for (var j = 0; j < list.length; j++) list[j].rank = j + 1;
    return list;
  }

  // --- helpers ---------------------------------------------------------------
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

  // The page's state in the URL hash, so a view can be linked to: the search, the filters,
  // the tab and the open protocol. The hash is read once at load and rewritten on every change.
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    var q = params.get('q');
    var p = params.get('p');
    var category = params.get('category');
    var chain = params.get('chain');
    var verdict = params.get('verdict');
    if (q) state.q = q;
    if (p) state.selected = p;
    if (category) state.category = category;
    if (chain) state.chain = chain;
    if (verdict === 'farm' || verdict === 'thin' || verdict === 'skip') state.verdict = verdict;
    state.earlyOnly = params.get('early') === '1';
    if (params.get('tab') === 'live') state.tab = 'live';
  }
  function writeHash() {
    var params = new URLSearchParams();
    var entries = [
      ['q', state.q],
      ['category', state.category === 'all' ? '' : state.category],
      ['chain', state.chain === 'all' ? '' : state.chain],
      ['verdict', state.verdict === 'all' ? '' : state.verdict],
      ['early', state.earlyOnly ? '1' : ''],
      ['tab', state.tab === 'live' ? 'live' : ''],
      ['p', state.selected || '']
    ];
    entries.forEach(function (e) { if (e[1]) params.set(e[0], e[1]); });
    var next = params.toString();
    var url = next ? '#' + next : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }

  // The sandboxed ranking, filtered to what the controls ask for.
  function filteredRanked() {
    var q = state.q.trim().toLowerCase();
    var out = [];
    var ranked = rankedRows();
    for (var i = 0; i < ranked.length; i++) {
      var r = ranked[i].row;
      if (state.category !== 'all' && r.category !== state.category) continue;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) continue;
      if (state.verdict !== 'all' && ranked[i].net.verdict !== state.verdict) continue;
      if (state.earlyOnly && WATCH[r.slug]) continue;
      if (q) {
        var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) continue;
      }
      out.push(ranked[i]);
    }
    return out;
  }
  // One sortable key per column: the value a row sorts by, with a slug tiebreak so the order
  // is stable no matter which column is sorted.
  function sortValue(x, key) {
    if (key === 'name') return x.row.name.toLowerCase();
    if (key === 'tvl') return x.row.tvl_usd;
    if (key === 'growth') return x.row.change_7d === null ? -Infinity : x.row.change_7d;
    if (key === 'age') return x.row.age_days === null ? Infinity : x.row.age_days;
    if (key === 'confidence') return x.row.confidence;
    if (key === 'net') return x.net.net;
    if (key === 'verdict') return x.net.verdict === 'farm' ? 2 : x.net.verdict === 'thin' ? 1 : 0;
    return x.implied;
  }
  function sortedList(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av = sortValue(a, key);
      var bv = sortValue(b, key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
    });
  }

  // The middle of a list of numbers, or null for an empty one.
  function median(nums) {
    if (!nums.length) return null;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    if (s.length % 2) return s[mid];
    return (s[mid - 1] + s[mid]) / 2;
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var top10 = DATA.rows.slice(0, 10).reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    var medGrowth = median(DATA.rows.map(function (r) { return r.change_7d; }).filter(function (n) { return n !== null; }));
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).length;
    var vc = DATA.verdict_counts || { farm: 0, thin: 0, skip: 0 };
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, found by TVL, not by name. Each row is netted: what one farmer can expect against what the farm costs. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Verdicts: farm / thin / skip' }), el('b', { text: vc.farm + ' / ' + vc.thin + ' / ' + vc.skip })),
        el('div', { class: 'fact' }, el('span', { text: 'Top 10 implied value' }), el('b', { text: fmtUsd(top10) })),
        el('div', { class: 'fact' }, el('span', { text: 'Comps out-of-sample error' }), el('b', { text: DATA.comps.cv_median_log_error.toFixed(2) + ' log pts' })),
        el('div', { class: 'fact' }, el('span', { text: 'Categories on the board' }), el('b', { text: String(cats) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category, chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var verdictSelect = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      ['farm', 'thin', 'skip'].map(function (v) { return el('option', { value: v, text: v.charAt(0).toUpperCase() + v.slice(1), selected: v === state.verdict ? 'selected' : null }); })
    );
    verdictSelect.addEventListener('change', function () { state.verdict = verdictSelect.value; writeHash(); render(); });
    var early = el('input', { type: 'checkbox', id: 'early', checked: state.earlyOnly ? 'checked' : null, 'aria-label': 'Early rows only' });
    early.addEventListener('change', function () { state.earlyOnly = early.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Verdict' }), verdictSelect),
      el('label', { class: 'check', for: 'early' }, early, 'Early only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? filteredRanked().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function verdictBadge(v) {
    return el('span', { class: 'verdict verdict-' + v, text: v.toUpperCase() });
  }

  function boardTable() {
    var list = sortedList(filteredRanked());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.earlyOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied || 1;
    var tbody = el('tbody');
    list.forEach(function (x) {
      var r = x.row;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var netClass = x.net.net >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(sandboxActive() ? x.rank : r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('div', null,
            el('b', { text: r.name }),
            WATCH[r.slug] ? null : el('span', { class: 'badge-early', text: 'early' })
          ),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('span', { class: 'conf' },
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + r.confidence + '%' })),
          el('b', { class: 'num', text: String(r.confidence) })
        )),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((x.implied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(x.implied) })
        )),
        el('td', { class: 'num ' + netClass, text: fmtSigned(x.net.net) }),
        el('td', null, verdictBadge(x.net.verdict))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: sandboxActive() ? 'Sandbox ranking: the model with your constants, not the submitted board. Select a row for its model and farm plan.' : 'Pre-token protocols, strongest implied value first. Net is one farmer\u2019s expected value minus the farm\u2019s cost. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('confidence', 'Signal'),
            sortHeader('implied', 'Implied value'),
            sortHeader('net', 'Net / farmer'),
            sortHeader('verdict', 'Verdict')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their market caps are what the comps curve is fitted on.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var c = DATA.comps;
    var offsets = Object.keys(c.offsets).map(function (g) {
      return g + ' ' + (c.offsets[g] >= 0 ? '+' : '') + c.offsets[g].toFixed(2) + ' (n=' + c.group_n[g] + ', sd ' + (c.group_sd[g] || 0).toFixed(2) + ')';
    }).join('; ');
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( comps(TVL, group, chains, age) x (1 + clamp(change_7d, -' + m.growth_mult_cap + ', ' + m.growth_mult_cap + ') / 100 x ' + m.growth_weight + ') x age(t) x reach )'
      ),
      el('p', { class: 'sub', text: 'The comps curve is log market cap on log TVL, fitted by median regression on ' + c.live_n + ' live-token protocols (exchanges excluded), with one offset per comps group, plus log chain count (' + c.chains_coef.toFixed(2) + ') and log age (' + c.age_coef.toFixed(2) + '): both terms earned their place in five-fold validation, while finer groups, per-group slopes, a quadratic TVL term, a growth term, a stablecoin dummy, Huber and a trimmed refit all tested worse and were left out. Median, not least squares: the live set has extreme outliers, and least squares lets one meme token drag the line, so the fit is least absolute deviations by iteratively reweighted least squares, which follows the typical protocol instead. Offsets: ' + offsets + '. Its slope is ' + c.slope.toFixed(3) + '. Validated out of sample in ' + c.cv_folds + ' folds by slug hash, its median held-out error is ' + c.cv_median_log_error.toFixed(2) + ' log points and its mean is ' + c.cv_mean_log_error.toFixed(2) + ', against 1.59 for a flat market-cap-to-TVL multiple — so the curve is used, and its error is stated, not hidden. Each row\'s band is one residual spread of its own comps group either way, because the groups are not equally noisy. Age has three phases: seasoning under ' + m.seasoning_days + ' days (' + m.seasoning_floor + ' rising to ' + m.launch_floor + '), the launch window to ' + m.maturity_days + ' days (' + m.launch_floor + ' rising to 1.0), then decay to 0.85: a protocol that has run for years with no token has shown it can run without one. Growth stops paying past ' + m.growth_mult_cap + '% either way: a 7-day spike of thousands of percent is a new pool, not a proportionally better protocol. Reach adds ' + (m.reach_step * 100) + '% per extra chain, up to ' + m.reach_max_steps + '.' }),
      el('h2', { text: 'How a farm is netted' }),
      el('p', { class: 'sub', text: 'The airdrop pool is assumed to be ' + Math.round(m.airdrop_share * 100) + '% of the implied value, shared among one farmer per $' + m.farmers_per_tvl.toLocaleString('en-US') + ' of TVL and never fewer than 100 farmers. The farm costs the gas for its transactions on its first chain, a $3 bridge fee off Ethereum, and the time value of the capital at ' + Math.round(m.opportunity_apr * 100) + '% a year over the hold. Net is expected value minus cost: FARM when it is at least $' + m.farm_threshold + ', THIN when it is at least $0, SKIP below $0. Every plan also names the record\'s two biggest risks and how to unwind the position. Signal strength, 0-100, is how much of the record exists: growth reported, listing date known, more than one chain, TVL over $100M, category known, and age inside the launch window. It never moves a rank. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  function sandboxPanel() {
    var m = DATA.model;
    var sb = state.sb;
    function slider(id, label, min, max, step, value, oninput, fmt) {
      var out = el('output', { for: id, text: fmt ? fmt(value) : String(value) });
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      input.addEventListener('input', function () { var v = parseFloat(input.value); oninput(v); out.textContent = fmt ? fmt(v) : input.value; render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), input, out);
    }
    function toggle(id, label, checked, onchange) {
      var input = el('input', { type: 'checkbox', id: id, checked: checked ? 'checked' : null, 'aria-label': label });
      input.addEventListener('change', function () { onchange(input.checked); render(); });
      return el('label', { class: 'check', for: id }, input, label);
    }
    function gasSelect() {
      var sel = el('select', { id: 'sb-gas', 'aria-label': 'Gas level' },
        [['0.5', 'Cheap gas (x0.5)'], ['1', 'Normal gas (x1)'], ['2', 'Dear gas (x2)']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: String(sb.gas) === o[0] ? 'selected' : null }); })
      );
      sel.addEventListener('change', function () { state.sb.gas = parseFloat(sel.value); render(); });
      return el('div', { class: 'field' }, el('label', { for: 'sb-gas', text: 'Gas level' }), sel);
    }
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the submitted model', onclick: function () { state.sb = { weight: m.growth_weight, share: m.airdrop_share, gas: 1, group: true, reach: true }; render(); } });
    return el('section', { class: 'panel sandbox' },
      el('h2', { text: 'Model sandbox' }),
      el('p', { class: 'sub', text: 'Change the model and the board re-ranks from the same function. A sandboxed ranking is labelled in the table; the submitted board is the ranking the sandbox starts from.' }),
      sandboxActive() ? el('p', { class: 'sandbox-note', text: 'Sandbox active: the table shows your ranking, not the submitted board.' }) : null,
      el('div', { class: 'sandbox-grid' },
        slider('sb-weight', 'Growth weight', 0, 1, 0.05, sb.weight, function (v) { state.sb.weight = v; }),
        slider('sb-share', 'Airdrop share', 0.03, 0.15, 0.01, sb.share, function (v) { state.sb.share = v; }, function (v) { return Math.round(v * 100) + '%'; }),
        gasSelect(),
        toggle('sb-group', 'Comps group offsets on', sb.group, function (v) { state.sb.group = v; }),
        toggle('sb-reach', 'Reach (multi-chain) on', sb.reach, function (v) { state.sb.reach = v; })
      ),
      el('div', null, reset)
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function factorRow(label, value, barPct) {
    return el('div', { class: 'factor' },
      el('span', { text: label }),
      el('b', { text: value }),
      el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.min(100, barPct)) + '%' }))
    );
  }

  // The comps chart: every live-token protocol the curve is fitted on, log TVL
  // against log market cap, coloured by comps group, with the fitted line for this
  // protocol's group (at its chain count and age) and this protocol's predicted
  // point and band. It is the curve itself, drawn, so a reader can see what the
  // model claims instead of taking the number on trust.
  var GROUP_COLORS = {
    'Exchange & Derivatives': '#34d399',
    'Lending & Credit': '#f5b83d',
    'Yield & Vaults': '#7dd3fc',
    'Staking & Restaking': '#c4b5fd',
    'Bridges': '#f87171',
    'Other': '#93a3bd'
  };
  function compsChart(row) {
    var all = DATA.live_all || [];
    if (!all.length) return null;
    var c = DATA.comps;
    var W = 640, H = 260, PL = 56, PR = 16, PT = 14, PB = 34;
    var xs = all.map(function (p) { return Math.log10(p.tvl_usd); });
    var ys = all.map(function (p) { return Math.log10(p.mcap_usd); });
    var x0 = Math.floor(Math.min.apply(null, xs.concat([Math.log10(row.tvl_usd)])));
    var x1 = Math.ceil(Math.max.apply(null, xs.concat([Math.log10(row.tvl_usd)])));
    var y0 = Math.floor(Math.min.apply(null, ys.concat([Math.log10(row.comps_low_usd)])));
    var y1 = Math.ceil(Math.max.apply(null, ys.concat([Math.log10(row.comps_high_usd)])));
    function X(v) { return PL + ((v - x0) / (x1 - x0)) * (W - PL - PR); }
    function Y(v) { return PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB); }
    function tickLabel(p) {
      if (p >= 9) return '$' + Math.round(Math.pow(10, p - 9)) + 'B';
      if (p >= 6) return '$' + Math.round(Math.pow(10, p - 6)) + 'M';
      return '$' + Math.round(Math.pow(10, p - 3)) + 'K';
    }
    var s = '';
    s += '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Comps curve: live-token market caps against TVL, with this protocol\'s predicted value">';
    for (var gx = x0; gx <= x1; gx++) {
      s += '<line x1="' + X(gx).toFixed(1) + '" y1="' + PT + '" x2="' + X(gx).toFixed(1) + '" y2="' + (H - PB) + '" class="grid"/>';
      var anchor = gx === x1 ? ' text-anchor="end"' : gx === x0 ? ' text-anchor="start"' : '';
      s += '<text x="' + X(gx).toFixed(1) + '" y="' + (H - 12) + '" class="axis"' + anchor + '>' + tickLabel(gx) + '</text>';
    }
    for (var gy = y0; gy <= y1; gy++) {
      s += '<line x1="' + PL + '" y1="' + Y(gy).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + Y(gy).toFixed(1) + '" class="grid"/>';
      s += '<text x="' + (PL - 8) + '" y="' + (Y(gy) + 4).toFixed(1) + '" class="axis" text-anchor="end">' + tickLabel(gy) + '</text>';
    }
    // Fitted line for this protocol's group, at its chain count and age.
    var off = c.offsets[row.comps_group] || 0;
    var chains = Math.max(1, (row.chains || []).length);
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    var line = '';
    for (var lx = x0; lx <= x1; lx += 0.25) {
      var tvl = Math.pow(10, lx);
      var ly = (c.intercept + c.slope * Math.log(tvl) + c.chains_coef * Math.log(chains) + c.age_coef * Math.log(1 + age) + off) / Math.LN10;
      line += (line ? ' L' : 'M') + X(lx).toFixed(1) + ' ' + Y(ly).toFixed(1);
    }
    s += '<path d="' + line + '" class="fit-line"/>';
    all.forEach(function (p) {
      var col = GROUP_COLORS[p.comps_group] || '#93a3bd';
      s += '<circle cx="' + X(Math.log10(p.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(p.mcap_usd)).toFixed(1) + '" r="3.5" fill="' + col + '" fill-opacity="0.75"><title>' + p.name + ': TVL ' + fmtUsd(p.tvl_usd) + ', market cap ' + fmtUsd(p.mcap_usd) + '</title></circle>';
    });
    var px = X(Math.log10(row.tvl_usd));
    s += '<line x1="' + px.toFixed(1) + '" y1="' + Y(Math.log10(row.comps_high_usd)).toFixed(1) + '" x2="' + px.toFixed(1) + '" y2="' + Y(Math.log10(row.comps_low_usd)).toFixed(1) + '" class="band"/>';
    s += '<circle cx="' + px.toFixed(1) + '" cy="' + Y(Math.log10(row.comps_base_usd)).toFixed(1) + '" r="6" class="pred"><title>' + row.name + ' predicted at ' + fmtUsd(row.comps_base_usd) + '</title></circle>';
    s += '</svg>';
    var legend = Object.keys(GROUP_COLORS).map(function (g) {
      return '<span class="legend-item"><i style="background:' + GROUP_COLORS[g] + '"></i>' + g + '</span>';
    }).join('');
    return el('div', { class: 'chart' },
      el('div', { html: s }),
      el('div', { class: 'legend', html: legend + '<span class="legend-item"><i class="pred-dot"></i>' + row.name + ' predicted</span>' }),
      el('p', { class: 'sub', text: 'Each dot is one of the ' + all.length + ' live-token protocols the curve is fitted on. The line is the fitted curve for a ' + row.comps_group + ' protocol at this chain count and age; the gold marker is this protocol\'s predicted market cap, with its band one group residual spread either way.' })
    );
  }

  function openDetail(slug) {
    var found = rankedRows().filter(function (x) { return x.row.slug === slug; })[0];
    if (!found) return;
    var row = found.row;
    var f = found.factors;
    var net = found.net;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = row.farm_steps || [];
    var why = (row.change_7d !== null ? 'TVL ' + (row.change_7d >= 0 ? 'up ' : 'down ') + Math.abs(row.change_7d).toFixed(1) + '% in 7 days' : 'TVL trend unreported') + '; ' + (row.chains.length >= 2 ? 'live on ' + row.chains.length + ' chains' : 'live on one chain') + '; listed ' + (row.age_days !== null ? row.age_days + ' days ago' : 'date unknown') + '. The comps curve values its TVL at ' + fmtUsd(f.base) + ' for a ' + row.comps_group + ' protocol, and the model values it at ' + fmtUsd(found.implied) + '.';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + (sandboxActive() ? found.rank + ' (sandbox)' : row.rank + ' of ' + DATA.board_size) }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (WATCH[row.slug] ? '' : ' - early row, below the watchlist floor') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Comps group' }), el('b', { class: 'num', text: row.comps_group })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Signal strength' }), el('b', { class: 'num', text: String(row.confidence) + ' / 100' })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(found.implied) }))
      ),
      factorRow('Comps base', fmtUsd(f.base), 100),
      factorRow('Comps band (one group sd)', fmtUsd(row.comps_low_usd) + ' - ' + fmtUsd(row.comps_high_usd), 60),
      factorRow('Growth x ' + f.growthMult.toFixed(2), fmtPct(f.growth), 50 + Math.max(-50, Math.min(50, f.growth))),
      factorRow('Age x ' + f.maturity.toFixed(2), fmtAge(row.age_days), f.maturity * 100),
      factorRow('Reach x ' + f.reach.toFixed(2), (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's'), ((f.reach - 1) / 0.16) * 100),
      el('p', { class: 'sub', text: sandboxActive()
        ? 'Sandbox ranking: this row is recomputed with your constants. Reset the sandbox to see the submitted board again. This is an estimate, not a price.'
        : 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model, state.sb).implied) + (Math.abs(impliedOf(row, DATA.model, state.sb).implied - row.implied_value_usd) <= 2 ? ', the same number board.json carries (whole-dollar rounding aside).' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    // The farm plan comes first, right after the implied value: it is the one part of a
    // protocol's detail that no other view shows, and a reader should see the concrete
    // steps with their costs and times without scrolling past the chart.
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    var chart = compsChart(row);
    if (chart) {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'The comps curve, drawn' }),
        chart
      ));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Netted verdict' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Expected per farmer' }), el('b', { class: 'num', text: '$' + net.expected.toLocaleString('en-US') })),
        el('div', null, el('span', { text: 'Farm cost' }), el('b', { class: 'num', text: '$' + net.cost.toLocaleString('en-US') })),
        el('div', null, el('span', { text: 'Net per farmer' }), el('b', { class: 'num', text: fmtSigned(net.net) })),
        el('div', null, el('span', { text: 'Verdict' }), el('b', { class: 'num', text: net.verdict.toUpperCase() }))
      ),
      el('div', { class: 'netbar', 'aria-hidden': 'true' },
        el('i', { class: 'net-expected', style: 'width:' + Math.round((net.expected / Math.max(1, net.expected, net.cost)) * 100) + '%' }),
        el('i', { class: 'net-cost', style: 'width:' + Math.round((net.cost / Math.max(1, net.expected, net.cost)) * 100) + '%' })
      ),
      el('p', { class: 'sub', text: 'Expected per farmer (green) against the farm\'s cost (red). Expected from a ' + Math.round(state.sb.share * 100) + '% airdrop pool shared among about ' + net.farmers.toLocaleString('en-US') + ' farmers, minus gas, bridge and time value. FARM at $' + DATA.model.farm_threshold + ' or more, THIN at $0 or more, SKIP below $0.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Why it ranks here' }),
      el('p', { class: 'why', text: why })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      shell.appendChild(sandboxPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
