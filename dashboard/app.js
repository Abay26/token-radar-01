// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the model's
// own inputs and the protocol's farm plan, and a model sandbox that re-ranks the board live from
// the same function that scored it. No network: every byte it shows is in data.js.
//
// The model in one place: impliedOf below is the same arithmetic as lib/model.ts's impliedValue,
// so the page recomputes a row from the snapshot figures and checks the number board.json carries.
// The sandbox only changes the constants it is given: base multiple, growth weight, and whether
// the reach and category priors apply. A sandboxed ranking is labelled as one; the submitted board
// is the ranking the sandbox starts from.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var WATCH = {};
  DATA.rows.forEach(function (r) { WATCH[r.slug] = true; });
  var state = {
    q: '', category: 'all', chain: 'all', tab: 'pre-token',
    sort: 'implied', dir: -1, selected: null, earlyOnly: false,
    sb: { base: DATA.model.base_multiple, weight: DATA.model.growth_weight, cat: true, reach: true }
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
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
  function ageMultiplier(age, model) {
    var a = age === null || age === undefined ? model.unknown_age_days : age;
    if (a <= model.maturity_days) {
      return model.maturity_floor + (Math.min(Math.max(a, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    }
    var over = Math.min((a - model.maturity_days) / model.maturity_days, 1);
    return 1 - model.age_decay * over;
  }
  function reachMultiplier(row, model) {
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.reach_max_steps);
    return 1 + model.reach_step * extra;
  }
  function categoryMultiplier(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('dex') >= 0 || c.indexOf('lend') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 1.1;
    if (c.indexOf('yield') >= 0 || c.indexOf('rwa') >= 0 || c.indexOf('prediction') >= 0) return 1.05;
    if (c.indexOf('canonical bridge') >= 0) return 0.9;
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('liquid restaking') >= 0 || c.indexOf('restaked') >= 0) return 0.9;
    return 1;
  }
  function impliedOf(row, model, sb) {
    var m = model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * sb.weight;
    var maturity = ageMultiplier(row.age_days, m);
    var reach = sb.reach ? reachMultiplier(row, m) : 1;
    var cat = sb.cat ? categoryMultiplier(row.category) : 1;
    return {
      implied: Math.max(1, Math.round(row.tvl_usd * sb.base * growthMult * maturity * reach * cat)),
      growthMult: growthMult, maturity: maturity, reach: reach, cat: cat, growth: growth
    };
  }
  function sandboxActive() {
    var m = DATA.model, sb = state.sb;
    return sb.base !== m.base_multiple || sb.weight !== m.growth_weight || !sb.cat || !sb.reach;
  }
  // The board as the sandbox ranks it now: each row's implied value under the sandbox, then
  // ranks 1..n by it. With the sandbox untouched this is exactly board.json's ranking.
  function rankedRows() {
    var list = [];
    for (var i = 0; i < DATA.rows.length; i++) {
      var r = DATA.rows[i];
      var v = impliedOf(r, DATA.model, state.sb);
      list.push({ row: r, implied: v.implied, factors: v, rank: 0 });
    }
    list.sort(function (a, b) {
      if (b.implied !== a.implied) return b.implied - a.implied;
      return a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
    });
    for (var j = 0; j < list.length; j++) list[j].rank = j + 1;
    return list;
  }

  // --- the farm plan, as in lib/model.ts ------------------------------------
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasNote(p) {
    var chain = chainOf(p);
    var cheap = ['base', 'arbitrum', 'optimism', 'solana', 'polygon', 'bsc', 'bnb', 'avalanche', 'blast', 'linea', 'scroll', 'zksync', 'mode', 'fantom', 'gnosis', 'berachain', 'sei', 'sui', 'aptos'];
    if (chain.toLowerCase() === 'ethereum') return 'Ethereum mainnet gas is usually a few dollars a transaction: batch your actions into as few transactions as you can';
    for (var i = 0; i < cheap.length; i++) if (chain.toLowerCase().indexOf(cheap[i]) >= 0) return 'gas on ' + chain + ' is usually a few cents a transaction';
    return 'gas on ' + chain + ' is usually under a dollar a transaction';
  }
  function evidenceFor(p, age) {
    var parts = [];
    if (p.change_7d !== null && p.change_7d !== undefined) parts.push('TVL ' + (p.change_7d >= 0 ? 'up' : 'down') + ' ' + Math.abs(p.change_7d).toFixed(1) + '% in 7 days');
    else parts.push('TVL trend unreported');
    parts.push((p.chains || []).length >= 2 ? 'live on ' + p.chains.length + ' chains' : 'live on one chain');
    parts.push(age !== null && age !== undefined ? 'listed ' + age + ' days ago' : 'listing date unknown');
    return parts.join('; ');
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
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
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain) + ' The evidence for farming it: ' + evidenceFor(p, p.age_days) + '.', cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote. ' + gasNote(p) + '.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
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
    if (q) state.q = q;
    if (p) state.selected = p;
    if (category) state.category = category;
    if (chain) state.chain = chain;
    state.earlyOnly = params.get('early') === '1';
    if (params.get('tab') === 'live') state.tab = 'live';
  }
  function writeHash() {
    var params = new URLSearchParams();
    var entries = [
      ['q', state.q],
      ['category', state.category === 'all' ? '' : state.category],
      ['chain', state.chain === 'all' ? '' : state.chain],
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
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, found by TVL, not by name. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Top 10 implied value' }), el('b', { text: fmtUsd(top10) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median 7-day growth' }), el('b', { text: fmtPct(medGrowth) })),
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
    var early = el('input', { type: 'checkbox', id: 'early', checked: state.earlyOnly ? 'checked' : null, 'aria-label': 'Early rows only' });
    early.addEventListener('change', function () { state.earlyOnly = early.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
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

  function boardTable() {
    var list = sortedList(filteredRanked());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.earlyOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied || 1;
    var tbody = el('tbody');
    list.forEach(function (x) {
      var r = x.row;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
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
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: sandboxActive() ? 'Sandbox ranking: the model with your constants, not the submitted board. Select a row for its model and farm plan.' : 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('confidence', 'Signal'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
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
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x age(t) x reach x category )'
      ),
      el('p', { class: 'sub', text: 'Age rises from 0.6 to 1.0 over the first ' + m.maturity_days + ' days, then decays to 0.85: a protocol that has run for years with no token has shown it can run without one. Reach adds ' + (m.reach_step * 100) + '% per extra chain, up to ' + m.reach_max_steps + '. The category prior pays 1.10 where a token is the product (exchanges, lending, derivatives), 1.05 for yield, real-world assets and prediction markets, 0.90 for canonical bridges and liquid staking products, and 1.00 otherwise. Signal strength, 0-100, is how much of the record exists: growth reported, listing date known, more than one chain, TVL over $100M, category known. It never moves a rank. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  function sandboxPanel() {
    var m = DATA.model;
    var sb = state.sb;
    function slider(id, label, min, max, step, value, oninput) {
      var out = el('output', { for: id, text: String(value) });
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      input.addEventListener('input', function () { oninput(parseFloat(input.value)); out.textContent = input.value; render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), input, out);
    }
    function toggle(id, label, checked, onchange) {
      var input = el('input', { type: 'checkbox', id: id, checked: checked ? 'checked' : null, 'aria-label': label });
      input.addEventListener('change', function () { onchange(input.checked); render(); });
      return el('label', { class: 'check', for: id }, input, label);
    }
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the submitted model', onclick: function () { state.sb = { base: m.base_multiple, weight: m.growth_weight, cat: true, reach: true }; render(); } });
    return el('section', { class: 'panel sandbox' },
      el('h2', { text: 'Model sandbox' }),
      el('p', { class: 'sub', text: 'Change the model and the board re-ranks from the same function. A sandboxed ranking is labelled in the table; the submitted board is the ranking the sandbox starts from.' }),
      sandboxActive() ? el('p', { class: 'sandbox-note', text: 'Sandbox active: the table shows your ranking, not the submitted board.' }) : null,
      el('div', { class: 'sandbox-grid' },
        slider('sb-base', 'Base multiple (TVL x)', 0.1, 0.5, 0.01, sb.base, function (v) { state.sb.base = v; }),
        slider('sb-weight', 'Growth weight', 0, 1, 0.05, sb.weight, function (v) { state.sb.weight = v; }),
        toggle('sb-cat', 'Category prior on', sb.cat, function (v) { state.sb.cat = v; }),
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

  function openDetail(slug) {
    var found = rankedRows().filter(function (x) { return x.row.slug === slug; })[0];
    if (!found) return;
    var row = found.row;
    var f = found.factors;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var why = 'Why it ranks here: ' + evidenceFor(row, row.age_days) + ', and the model values it at ' + fmtUsd(found.implied) + ' from $' + Math.round(row.tvl_usd * DATA.model.base_multiple).toLocaleString('en-US') + ' of base value.';
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
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Signal strength' }), el('b', { class: 'num', text: String(row.confidence) + ' / 100' })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(found.implied) }))
      ),
      factorRow('Base: TVL x ' + state.sb.base, fmtUsd(row.tvl_usd * state.sb.base), 100),
      factorRow('Growth x ' + f.growthMult.toFixed(2), fmtPct(f.growth), 50 + Math.max(-50, Math.min(50, f.growth))),
      factorRow('Age x ' + f.maturity.toFixed(2), fmtAge(row.age_days), f.maturity * 100),
      factorRow('Reach x ' + f.reach.toFixed(2), (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's'), ((f.reach - 1) / 0.16) * 100),
      factorRow('Category x ' + f.cat.toFixed(2), row.category || 'unknown', ((f.cat - 0.9) / 0.2) * 100),
      el('p', { class: 'sub', text: sandboxActive()
        ? 'Sandbox ranking: this row is recomputed with your constants. Reset the sandbox to see the submitted board again. This is an estimate, not a price.'
        : 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model, state.sb).implied) + (impliedOf(row, DATA.model, state.sb).implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Why it ranks here' }),
      el('p', { class: 'why', text: why })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
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
