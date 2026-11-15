// Token Radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol
// is pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol);
// the snapshot's live-token protocols are kept apart and shown as the market's own values, never
// mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   base       = tvl_usd x BASE_MULTIPLE
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   ageMult    = 0.6 + min(age_days, 1095) / 1095 x 0.4 while the protocol is under 3 years old,
//                then 1.0 decaying to 0.85 by 6 years: a protocol that has run for years with no
//                token is less, not more, likely to launch one, so age stops paying after year 3
//   reachMult  = 1 + 0.04 x min(max(chains - 1, 0), 4): a protocol live on more chains reaches
//                more farmers, up to 1.16
//   catMult    = a stated prior on the protocol's category (see categoryMultiplier): where a token
//                is the product's core it pays more, where the product wraps or bridges someone
//                else's token it pays less; never a list of names, the same table scores every row
//   implied    = max(1, round(base x growthMult x ageMult x reachMult x catMult))
//
// Confidence is a second number, 0-100, from how much of the record exists at all: growth reported,
// age known, more than one chain, TVL at or above $100M, category known. It never moves the rank;
// it says how much signal the rank rests on. No protocol name is ever special-cased: the same
// functions score every row.

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

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  reach_step: number;
  reach_max_steps: number;
  age_decay: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  reach_step: 0.04,
  reach_max_steps: 4,
  age_decay: 0.15,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 260;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
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
  confidence: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    category_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
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
  confidence: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
  category_multiplier: number;
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

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
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

/** `value` when it is a finite number, `fallback` otherwise. */
function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Whole days from `listedAt` to `asOf`, never below zero; null when the listing date is
 * absent or unparsable, or the snapshot date is. Both dates are read as UTC midnights.
 */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const snapshotMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(snapshotMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((snapshotMs - listedMs) / DAY_MS));
}

/**
 * The age multiplier: 0.6 rising to 1.0 over the first `maturity_days` days, then decaying by
 * `age_decay` over the next `maturity_days` days to 0.85, and flat after that. A young protocol
 * earns its multiplier by surviving; an old one with no token after years has shown it can run
 * without one, so the multiplier stops paying.
 */
export function ageMultiplier(age: number | null, model: ModelConstants): number {
  const a = age ?? model.unknown_age_days;
  if (a <= model.maturity_days) {
    return model.maturity_floor + (Math.min(Math.max(a, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  }
  const over = Math.min((a - model.maturity_days) / model.maturity_days, 1);
  return 1 - model.age_decay * over;
}

/** The reach multiplier: 1 plus `reach_step` per extra chain, up to `reach_max_steps` extra chains. */
export function reachMultiplier(chains: string[], model: ModelConstants): number {
  const extra = Math.min(Math.max(chains.length - 1, 0), model.reach_max_steps);
  return 1 + model.reach_step * extra;
}

/**
 * The category prior: a token is the product itself for exchanges, lenders and derivatives
 * venues, so those pay 1.10; yield, real-world assets and prediction markets pay 1.05; a bridge
 * pays 1.00, a canonical bridge 0.90 and a liquid staking or restaking product 0.90, because
 * those wrap or move someone else's token rather than launch one of their own. Anything else
 * pays 1.00. The table reads the snapshot's category field only; no protocol name is in it.
 */
export function categoryMultiplier(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('lend') || c.includes('perpetual') || c.includes('derivative')) return 1.1;
  if (c.includes('yield') || c.includes('rwa') || c.includes('prediction')) return 1.05;
  if (c.includes('canonical bridge')) return 0.9;
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restaked')) return 0.9;
  return 1;
}

/**
 * Signal strength, 0-100: how much of the record exists at all. Growth reported is worth 30,
 * a known listing date 25, more than one chain 15, TVL at or above $100M 15 and a known
 * category 15. It never moves a rank; it says how much signal the rank rests on.
 */
export function confidenceOf(p: SnapshotProtocol): number {
  let score = 0;
  if (p.change_7d !== null) score += 30;
  if (p.listed_at !== null) score += 25;
  if (p.chains.length >= 2) score += 15;
  if (p.tvl_usd >= 100_000_000) score += 15;
  if (p.category !== null) score += 15;
  return score;
}

/** The five multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; reachMult: number; catMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, asNumber(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult = ageMultiplier(age, model);
  const reachMult = reachMultiplier(protocol.chains, model);
  const catMult = categoryMultiplier(protocol.category);
  const unrounded = protocol.tvl_usd * model.base_multiple * growthMult * maturityMult * reachMult * catMult;
  const implied = Math.max(1, Math.round(unrounded));
  return { implied, growthPct, growthMult, maturityMult, reachMult, catMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** An index of the snapshot's protocols, keyed by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const belowFloor = snapshot.protocols.filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd);
  belowFloor.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of belowFloor.slice(0, EARLY_ROWS)) chosen.set(p.slug, p);

  const scored: Array<ReturnType<typeof impliedValue> & { p: SnapshotProtocol; confidence: number }> = [];
  for (const p of chosen.values()) {
    const v = impliedValue(p, snapshot.as_of, model);
    scored.push({ p, ...v, confidence: confidenceOf(p) });
  }
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    confidence: s.confidence,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      reach_multiplier: round4(s.reachMult),
      category_multiplier: s.catMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A number rounded to four decimals, for the multipliers the board carries. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
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
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What the gas on the protocol's first chain costs, from the chain's own name. */
function gasNote(p: SnapshotProtocol): string {
  const chain = chainOf(p);
  const cheap = ['base', 'arbitrum', 'optimism', 'solana', 'polygon', 'bsc', 'bnb', 'avalanche', 'blast', 'linea', 'scroll', 'zksync', 'mode', 'fantom', 'gnosis', 'berachain', 'sei', 'sui', 'aptos'];
  if (chain.toLowerCase() === 'ethereum') return 'Ethereum mainnet gas is usually a few dollars a transaction: batch your actions into as few transactions as you can';
  if (cheap.some((c) => chain.toLowerCase().includes(c))) return `gas on ${chain} is usually a few cents a transaction`;
  return `gas on ${chain} is usually under a dollar a transaction`;
}

/** One line of evidence for the farm plan, from the protocol's own figures. */
function evidenceFor(p: SnapshotProtocol, age: number | null): string {
  const parts: string[] = [];
  if (p.change_7d !== null) parts.push(`TVL ${p.change_7d >= 0 ? 'up' : 'down'} ${Math.abs(p.change_7d).toFixed(1)}% in 7 days`);
  else parts.push('TVL trend unreported');
  parts.push(p.chains.length >= 2 ? `live on ${p.chains.length} chains` : 'live on one chain');
  parts.push(age !== null ? `listed ${age} days ago` : 'listing date unknown');
  return parts.join('; ');
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age, growth), never from a hand-written
 * list of names. The first action carries the evidence for farming this protocol at all.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `${action} The evidence for farming it: ${evidenceFor(p, age)}.`,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote. ${gasNote(p)}.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const trading = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  trading.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return trading.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
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
    confidence: row.confidence,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    reach_multiplier: row.model.reach_multiplier,
    category_multiplier: row.model.category_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  let early = 0;
  for (const r of board) if (!snapshot.watchlist.includes(r.slug)) early++;
  const rows: RadarRow[] = [];
  for (const r of board) rows.push(radarRow(r));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows,
    live,
  };
  return { board, radar };
}

/** A field that must be a string, or null when it is anything else. */
function optString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** A field that must be a finite number, or null when it is anything else. */
function optNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** One protocol entry out of a raw JSON value, refused unless it carries a slug, a name and a TVL. */
function parseProtocol(value: unknown, i: number): SnapshotProtocol {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
  }
  const p = value as Record<string, unknown>;
  const slug = optString(p.slug);
  const name = optString(p.name);
  const tvl = optNumber(p.tvl_usd);
  if (slug === null || name === null || tvl === null) {
    throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
  }
  const chains: string[] = [];
  if (Array.isArray(p.chains)) {
    for (const c of p.chains) if (typeof c === 'string') chains.push(c);
  }
  return {
    slug,
    name,
    category: optString(p.category),
    chains,
    tvl_usd: tvl,
    change_7d: optNumber(p.change_7d),
    mcap_usd: optNumber(p.mcap_usd),
    listed_at: optString(p.listed_at),
    gecko_id: optString(p.gecko_id),
    symbol: optString(p.symbol),
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  const asOf = optString(o.as_of);
  if (asOf === null || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new SnapshotError('snapshot.json has no as_of date');
  const source = optString(o.source);
  if (source === null) throw new SnapshotError('snapshot.json has no source');
  const floor = optNumber(o.floor_usd);
  if (floor === null || !Number.isSafeInteger(floor) || floor <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist)) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const watchlist: string[] = [];
  for (const s of o.watchlist) {
    if (typeof s !== 'string') throw new SnapshotError('snapshot.json has no watchlist of slugs');
    watchlist.push(s);
  }
  const protocols: SnapshotProtocol[] = [];
  for (let i = 0; i < o.protocols.length; i++) protocols.push(parseProtocol(o.protocols[i], i));
  return { as_of: asOf, source, floor_usd: floor, protocols, watchlist };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const covered = new Set<string>();
  for (const r of board) covered.add(r.slug);
  const missing: string[] = [];
  for (const s of snapshot.watchlist) if (!covered.has(s)) missing.push(s);
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2) {
    const first = board[0]!.implied_value_usd;
    const last = board[board.length - 1]!.implied_value_usd;
    if (first === last) return `all ${board.length} rows share the same implied value $${first}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
