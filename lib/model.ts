// Token Radar's model, radar-4: one snapshot of the protocol universe in, one ranked board out.
//
// radar-4 replaces radar-3's curve with one that reads more of the record: log market cap is
// regressed on log TVL with one offset per comps group AND on how many chains a protocol runs
// on and how long it has been listed — both terms are snapshot figures, and both earn their
// place: five-fold validation by slug hash cuts the median held-out log error from 1.20 to
// 1.13 when they are added, while finer groups, per-group slopes and a quadratic TVL term all
// tested worse and were left out. The curve's band is honest per group now: each comps
// group's own residual spread sets its interval, because the groups are not equally noisy
// (Lending and Bridges spread 2.3 log points, Other only 1.4).
//
// The age curve has three phases now, because a protocol's age means three different things:
// seasoning (listed under 180 days: the record is thin, so the multiplier ramps 0.55 to
// 0.85), the launch window (180 to 1095 days: the prime farming age, 0.85 rising to 1.0) and
// the long tail (past 1095 days: it has shown it can run without a token, decaying to 0.85).
// Growth is winsorized to +/-60% for the multiplier: a 7-day spike of 4000% is a new pool,
// not a four-thousand-percent better protocol, and the multiplier stops paying past it.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and
// adds the pre-token protocols below the watchlist floor: the early rows the radar exists to
// find. A protocol is pre-token when its index entry records no token (no market cap, no
// CoinGecko id, no symbol); the snapshot's live-token protocols are kept apart and shown as
// the market's own values, never mixed into the ranked board. The wrapped, staked and
// bridged products above the floor (WBTC, exchange staking products, bridges) are not
// ranked: each is a product of a token that already trades, not a protocol waiting on a
// launch of its own.
//
// The net: an airdrop pool is assumed to be 10% of the implied value (stated in the
// dashboard, adjustable in its sandbox), shared among the active farmers, estimated at one
// farmer per $5,000 of TVL and never fewer than 100. The farm's cost is the gas for its
// transactions on its first chain, a $3 bridge fee when the chain is not Ethereum, and the
// time value of the capital at 5% a year over the hold. Net is expected value minus cost:
// farm when it is at least $50, thin when it is at least $0, skip when it is below $0.
// Every number in that arithmetic is on the row, so a reader can check the verdict instead
// of taking it on trust. Every farm plan also names the record's two biggest risks and how
// to unwind the position, so the plan says what can go wrong, not only what to do.
//
// Confidence is a second number, 0-100, from how much of the record exists at all: growth
// reported, age known and inside the launch window, more than one chain, TVL at or above
// $100M, category known. It never moves the rank; it says how much signal the rank rests
// on. No protocol name is ever special-cased: the same functions score every row.

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
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  growth_mult_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  seasoning_days: number;
  seasoning_floor: number;
  launch_floor: number;
  unknown_age_days: number;
  reach_step: number;
  reach_max_steps: number;
  age_decay: number;
  airdrop_share: number;
  farmers_per_tvl: number;
  opportunity_apr: number;
  farm_threshold: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 120,
  growth_mult_cap: 60,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  seasoning_days: 180,
  seasoning_floor: 0.55,
  launch_floor: 0.85,
  unknown_age_days: 365,
  reach_step: 0.04,
  reach_max_steps: 4,
  age_decay: 0.15,
  airdrop_share: 0.1,
  farmers_per_tvl: 5000,
  opportunity_apr: 0.05,
  farm_threshold: 50,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-4';

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

/** A farm verdict: whether the model pays for farming this protocol. */
export type Verdict = 'farm' | 'thin' | 'skip';

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
  comps_multiple: number;
  comps_base_usd: number;
  comps_low_usd: number;
  comps_high_usd: number;
  expected_value_usd: number;
  farming_cost_usd: number;
  net_value_usd: number;
  verdict: Verdict;
  model: {
    comps_group: string;
    comps_offset: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
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
  comps_base_usd: number;
  comps_low_usd: number;
  comps_high_usd: number;
  expected_value_usd: number;
  farming_cost_usd: number;
  net_value_usd: number;
  verdict: Verdict;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
  comps_group: string;
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
  comps_group: string;
}

/** The fitted comps curve, with its out-of-sample validation, for the dashboard. */
export interface CompsFit {
  intercept: number;
  slope: number;
  chains_coef: number;
  age_coef: number;
  offsets: Record<string, number>;
  group_n: Record<string, number>;
  group_sd: Record<string, number>;
  residual_sd: number;
  r_squared: number;
  cv_median_log_error: number;
  cv_folds: number;
  live_n: number;
}

/** Everything the dashboard needs: the board, the live set, the comps fit and the model it runs. */
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
  comps: CompsFit;
  verdict_counts: Record<Verdict, number>;
  rows: RadarRow[];
  live: LiveRow[];
  live_all: LiveRow[];
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
 * The age multiplier, in three phases. Seasoning: a protocol listed under
 * `seasoning_days` days has a thin record, so the multiplier ramps from
 * `seasoning_floor` to `launch_floor`. Launch window: from seasoning to
 * `maturity_days` days it rises from `launch_floor` to 1.0 — the prime farming age, old
 * enough to have a record and young enough that a token is still plausible. Long tail:
 * past `maturity_days` it decays by `age_decay` to 0.85 over the next `maturity_days`
 * days and stays there: a protocol that has run for years with no token has shown it can
 * run without one, so the multiplier stops paying.
 */
export function ageMultiplier(age: number | null, model: ModelConstants): number {
  const a = age ?? model.unknown_age_days;
  if (a <= model.seasoning_days) {
    const f = Math.min(Math.max(a, 0), model.seasoning_days) / model.seasoning_days;
    return model.seasoning_floor + f * (model.launch_floor - model.seasoning_floor);
  }
  if (a <= model.maturity_days) {
    const f = (a - model.seasoning_days) / (model.maturity_days - model.seasoning_days);
    return model.launch_floor + f * (1 - model.launch_floor);
  }
  const over = Math.min((a - model.maturity_days) / model.maturity_days, 1);
  return 1 - model.age_decay * over;
}

/** The reach multiplier: 1 plus `reach_step` per extra chain, up to `reach_max_steps` extra chains. */
export function reachMultiplier(chains: string[], model: ModelConstants): number {
  const extra = Math.min(Math.max(chains.length - 1, 0), model.reach_max_steps);
  return 1 + model.reach_step * extra;
}

/** The six comps groups, in the order the regression takes its dummies from. */
export const COMPS_GROUPS = [
  'Exchange & Derivatives',
  'Lending & Credit',
  'Yield & Vaults',
  'Staking & Restaking',
  'Bridges',
  'Other',
] as const;

/**
 * A category's comps group, by keyword: exchanges, lenders and derivatives venues trade on
 * their own token; yield vaults and curators on the flows they route; staking products wrap
 * someone else's stake; bridges move value between chains. Anything else is Other. The table
 * reads the snapshot's category field only; no protocol name is in it.
 */
export function compsGroup(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual') || c.includes('option') || c.includes('basis trad') || c.includes('prediction')) return COMPS_GROUPS[0];
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return COMPS_GROUPS[1];
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager') || c.includes('capital allocator') || c.includes('risk curat') || c.includes('launchpad') || c.includes('governance')) return COMPS_GROUPS[2];
  if (c.includes('staking') || c.includes('restak')) return COMPS_GROUPS[3];
  if (c.includes('bridge')) return COMPS_GROUPS[4];
  return COMPS_GROUPS[5];
}

/** A deterministic 32-bit hash of a string, for the validation folds: no randomness anywhere. */
export function fnvHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Solve a small linear system by Gaussian elimination with partial pivoting, or null when singular. */
function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = m[col]!;
      m[col] = m[pivot]!;
      m[pivot] = tmp;
    }
    for (let r = col + 1; r < n; r++) {
      const factor = m[r]![col]! / m[col]![col]!;
      for (let k = col; k <= n; k++) m[r]![k]! -= factor * m[col]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r]![n]!;
    for (let k = r + 1; k < n; k++) sum -= m[r]![k]! * x[k]!;
    x[r] = sum / m[r]![r]!;
  }
  return x;
}

/** One design row: intercept, log TVL, log chain count, log age, and one dummy per comps group after the first. */
function compsDesignRow(p: SnapshotProtocol, asOf: string): number[] {
  const row = [1, Math.log(p.tvl_usd), Math.log(Math.max(1, p.chains.length)), Math.log(1 + (ageDays(asOf, p.listed_at) ?? 365))];
  const g = compsGroup(p.category);
  for (let i = 1; i < COMPS_GROUPS.length; i++) row.push(g === COMPS_GROUPS[i] ? 1 : 0);
  return row;
}

/** Ordinary least squares for log market cap on log TVL, log chains, log age, plus comps-group dummies. */
function fitOls(rows: SnapshotProtocol[], asOf: string): number[] | null {
  const p = COMPS_GROUPS.length + 3;
  const ata: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const atb = new Array<number>(p).fill(0);
  for (const protocol of rows) {
    const x = compsDesignRow(protocol, asOf);
    const y = Math.log(protocol.mcap_usd!);
    for (let i = 0; i < p; i++) {
      atb[i] += x[i]! * y;
      for (let j = 0; j < p; j++) ata[i]![j]! += x[i]! * x[j]!;
    }
  }
  return solveLinear(ata, atb);
}

/** A fitted curve's prediction of log market cap for one protocol. */
function predictLog(beta: number[], p: SnapshotProtocol, asOf: string): number {
  const x = compsDesignRow(p, asOf);
  let sum = 0;
  for (let i = 0; i < beta.length; i++) sum += beta[i]! * x[i]!;
  return sum;
}

/** The median of a list of numbers, or null for an empty one. */
function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * The comps curve fitted on the snapshot's live-token protocols, with its out-of-sample
 * validation: five folds by slug hash, each fold predicted from a fit on the other four.
 * Live-token protocols are those with a market cap and a TVL, exchanges excluded: a CEX's
 * token is a company, not a protocol launch. The band is per group: each group's own
 * residual spread sets its interval, because the groups are not equally noisy.
 */
export function fitComps(snapshot: Snapshot): CompsFit {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
  const beta = fitOls(live, snapshot.as_of);
  if (beta === null) throw new SnapshotError('the comps fit is singular: the live-token set cannot fit a curve');
  const residuals: number[] = [];
  let ssRes = 0;
  let ssTot = 0;
  const meanY = live.reduce((s, p) => s + Math.log(p.mcap_usd!), 0) / live.length;
  for (const p of live) {
    const r = Math.log(p.mcap_usd!) - predictLog(beta, p, snapshot.as_of);
    residuals.push(r);
    ssRes += r * r;
    ssTot += (Math.log(p.mcap_usd!) - meanY) ** 2;
  }
  const heldOut: number[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const train = live.filter((p) => fnvHash(p.slug) % 5 !== fold);
    const test = live.filter((p) => fnvHash(p.slug) % 5 === fold);
    const foldBeta = fitOls(train, snapshot.as_of);
    if (foldBeta === null) continue;
    for (const p of test) heldOut.push(Math.abs(Math.log(p.mcap_usd!) - predictLog(foldBeta, p, snapshot.as_of)));
  }
  const offsets: Record<string, number> = {};
  const groupN: Record<string, number> = {};
  const groupSd: Record<string, number> = {};
  for (const g of COMPS_GROUPS) {
    const members = live.filter((p) => compsGroup(p.category) === g);
    groupN[g] = members.length;
    offsets[g] = 0;
    const ss = members.reduce((s, p) => {
      const r = Math.log(p.mcap_usd!) - predictLog(beta, p, snapshot.as_of);
      return s + r * r;
    }, 0);
    groupSd[g] = members.length > 1 ? Math.sqrt(ss / (members.length - 1)) : Math.sqrt(ssRes / Math.max(1, live.length - beta.length));
  }
  for (let i = 1; i < COMPS_GROUPS.length; i++) offsets[COMPS_GROUPS[i]!] = beta[i + 3]!;
  return {
    intercept: beta[0]!,
    slope: beta[1]!,
    chains_coef: beta[2]!,
    age_coef: beta[3]!,
    offsets,
    group_n: groupN,
    group_sd: groupSd,
    residual_sd: Math.sqrt(ssRes / Math.max(1, live.length - beta.length)),
    r_squared: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    cv_median_log_error: median(heldOut) ?? 0,
    cv_folds: 5,
    live_n: live.length,
  };
}

/** A protocol's comps base: the curve's predicted market cap for its TVL, chains, age and group. */
export function compsBase(p: SnapshotProtocol, fit: CompsFit, asOf: string): number {
  const g = compsGroup(p.category);
  const age = ageDays(asOf, p.listed_at) ?? 365;
  const logBase =
    fit.intercept +
    fit.slope * Math.log(p.tvl_usd) +
    fit.chains_coef * Math.log(Math.max(1, p.chains.length)) +
    fit.age_coef * Math.log(1 + age) +
    (fit.offsets[g] ?? 0);
  return Math.exp(logBase);
}

/**
 * Signal strength, 0-100: how much of the record exists at all. Growth reported is worth
 * 25, a known listing date 20, more than one chain 15, TVL at or above $100M 15, a known
 * category 10, and an age inside the launch window (180 to 1095 days) 15. It never moves a
 * rank; it says how much signal the rank rests on.
 */
export function confidenceOf(p: SnapshotProtocol, asOf: string): number {
  let score = 0;
  if (p.change_7d !== null) score += 25;
  if (p.listed_at !== null) score += 20;
  if (p.chains.length >= 2) score += 15;
  if (p.tvl_usd >= 100_000_000) score += 15;
  if (p.category !== null) score += 10;
  const age = ageDays(asOf, p.listed_at);
  if (age !== null && age >= 180 && age <= 1095) score += 15;
  return score;
}

/** The five multipliers and the implied value one protocol gets under `model` and `fit`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  fit: CompsFit,
): { implied: number; base: number; growthPct: number; growthMult: number; maturityMult: number; reachMult: number; group: string; offset: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, asNumber(protocol.change_7d, 0)));
  // The multiplier stops paying past +/-60%: a 7-day spike of thousands of percent is a new
  // pool, not a proportionally better protocol.
  const growthForMult = Math.min(model.growth_mult_cap, Math.max(-model.growth_mult_cap, growthPct));
  const growthMult = 1 + (growthForMult / 100) * model.growth_weight;
  const maturityMult = ageMultiplier(age, model);
  const reachMult = reachMultiplier(protocol.chains, model);
  const group = compsGroup(protocol.category);
  const offset = fit.offsets[group] ?? 0;
  const base = compsBase(protocol, fit, asOf);
  const unrounded = base * growthMult * maturityMult * reachMult;
  const implied = Math.max(1, Math.round(unrounded));
  return { implied, base, growthPct, growthMult, maturityMult, reachMult, group, offset, age };
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

/** What one transaction costs on a chain, in dollars: Ethereum is dear, L2s are cents, Solana is cheapest. */
export function gasPerTx(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 4;
  if (c === 'solana') return 0.02;
  const cheap = ['base', 'arbitrum', 'optimism', 'zksync', 'scroll', 'linea', 'blast', 'mode', 'polygon', 'bsc', 'bnb', 'avalanche', 'gnosis', 'berachain', 'sei', 'sui', 'aptos', 'fantom'];
  if (cheap.some((k) => c.includes(k))) return 0.15;
  return 0.5;
}

/** What the gas on the protocol's first chain costs, from the chain's own name. */
function gasNote(p: SnapshotProtocol): string {
  const chain = chainOf(p);
  const gas = gasPerTx(chain);
  if (gas >= 4) return 'Ethereum mainnet gas is usually a few dollars a transaction: batch your actions into as few transactions as you can';
  if (gas <= 0.02) return `gas on ${chain} is usually a fraction of a cent a transaction`;
  if (gas <= 0.15) return `gas on ${chain} is usually a few cents a transaction`;
  return `gas on ${chain} is usually under a dollar a transaction`;
}

/** The whole cost of one farm: gas for its transactions, a bridge fee off Ethereum, and the time value of the capital. */
export function farmingCost(p: SnapshotProtocol, age: number | null, model: ModelConstants): { total: number; gas: number; bridge: number; opportunity: number; capital: number; hold: number; txs: number } {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weekly = Math.ceil(hold / 7);
  const txs = 2 + weekly + 2;
  const gas = gasPerTx(chain) * txs;
  const bridge = chain.toLowerCase() === 'ethereum' ? 0 : 3;
  const opportunity = (capital * model.opportunity_apr * hold) / 365;
  const total = Math.max(1, Math.round(gas + bridge + opportunity));
  return { total, gas: Math.round(gas * 100) / 100, bridge, opportunity: Math.round(opportunity * 100) / 100, capital, hold, txs };
}

/** What one farmer can expect: the airdrop pool's share of the implied value, split among the estimated farmers. */
export function expectedValue(implied: number, tvl: number, model: ModelConstants): { expected: number; farmers: number } {
  const farmers = Math.max(100, Math.round(tvl / model.farmers_per_tvl));
  const expected = Math.max(0, Math.round((implied * model.airdrop_share) / farmers));
  return { expected, farmers };
}

/** The verdict from the net: farm when it clears the threshold, thin when it clears zero, skip below zero. */
export function verdictOf(net: number, model: ModelConstants): Verdict {
  if (net >= model.farm_threshold) return 'farm';
  if (net >= 0) return 'thin';
  return 'skip';
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

/** The category's weekly action: what a farmer does every week to stay eligible. */
function recurringFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap $25 of USDC for the pool's asset on ${name} and add it to the position.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $10 of USDC against the supply and repay it the same week, so the position shows both sides.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Open one small hedge on ${name} and close it the same week, keeping the margin position live.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim the staking rewards from ${name} and restake them.`;
  if (c.includes('bridge')) return `Bridge $10 of USDC to ${chain} through ${name} and back, keeping the route active.`;
  if (c.includes('prediction')) return `Place one small market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Top up the ${name} vault by $10 and leave the shares in place.`;
  return `Make one qualifying action on ${name}: a deposit, a borrow, a swap or a vote.`;
}

/** The record's two biggest risks, in plain words, for the farm plan's risk step. */
export function risksFor(p: SnapshotProtocol, age: number | null, net: number): string[] {
  const risks: string[] = [];
  if (p.change_7d === null) risks.push('its TVL trend is unreported, so the farm rests on a level with no direction');
  else if (p.change_7d < -20) risks.push(`its TVL fell ${Math.abs(p.change_7d).toFixed(0)}% in 7 days, so the farm is catching a falling protocol`);
  else if (p.change_7d > 200) risks.push(`its TVL spiked ${p.change_7d.toFixed(0)}% in 7 days, so the level may be a new pool, not a trend`);
  if (p.chains.length < 2) risks.push('it lives on one chain, so one chain outage or exploit ends the farm');
  if (age === null) risks.push('its listing date is unknown, so there is no age to judge the launch window by');
  else if (age < 180) risks.push(`it was listed only ${age} days ago, so the record is thin and the points program may not exist yet`);
  else if (age > 1460) risks.push(`it has run ${Math.round(age / 365)} years with no token, so it may never issue one`);
  if (p.category === null) risks.push('its category is unreported, so the comps group is a guess');
  if (net < 0) risks.push('the model nets this farm below zero, so it pays only if the airdrop pool is larger than assumed');
  if (risks.length === 0) risks.push('the record is complete, so the main risk is the airdrop itself: the pool may be smaller than assumed');
  if (risks.length === 1) risks.push('the airdrop pool is an assumption, never a promise: it may be smaller than the model assumes');
  return risks.slice(0, 2);
}

/**
 * A protocol's farm plan: nine steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age, growth), never from a
 * hand-written list of names. Two of the steps are new in radar-4: the risks step names what
 * can go wrong, from the same record, and the exit step says how to unwind. The last step
 * nets the plan: the expected value against the cost, and the verdict that follows from it.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, net: { expected: number; cost: number; net: number; verdict: Verdict }, model: ModelConstants): FarmStep[] {
  const chain = chainOf(p);
  const cost = farmingCost(p, age, model);
  const action = actionFor(p, cost.capital, chain);
  const verdictLine =
    net.verdict === 'farm'
      ? 'the model pays for this farm'
      : net.verdict === 'thin'
        ? 'the model barely pays: farm only with capital already on this chain'
        : 'the model does not pay for this farm';
  const risks = risksFor(p, age, net.net);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and bridge $${cost.capital} of USDC to ${chain}. Keep the seed phrase offline.`,
      cost: `about $${3 + cost.bridge} to bridge, plus gas`,
      time: '10 minutes',
    },
    {
      text: `${action} The evidence for farming it: ${evidenceFor(p, age)}.`,
      cost: `$${cost.capital} of capital and about $${Math.max(1, Math.round(gasPerTx(chain) * 2))} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `${recurringFor(p, chain)} ${gasNote(p)}.`,
      cost: `about $${Math.max(1, Math.round(gasPerTx(chain) * 2))} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${cost.hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${cost.capital} stays in the position`,
      time: `${cost.hold} days`,
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
    {
      text: `Risks, from the record itself: ${risks[0]}; ${risks[1]}. Size the farm so losing it does not hurt.`,
      cost: 'no fee: the risk is the position itself',
      time: '5 minutes to check',
    },
    {
      text: `To exit, withdraw the position back to USDC on ${chain}, bridge it home, and stop the weekly actions. Do not leave dust in a wallet you stop watching.`,
      cost: `about $${Math.max(1, Math.round(gasPerTx(chain) * 2))} of gas to unwind`,
      time: '15 minutes to unwind',
    },
    {
      text: `Net for one farmer: $${net.expected} expected from a ${Math.round(model.airdrop_share * 100)}% airdrop pool, minus $${net.cost} of gas and time value, leaves $${net.net}: ${net.verdict.toUpperCase()} — ${verdictLine}.`,
      cost: `$${net.cost} in all, over ${cost.hold} days`,
      time: 'the whole farm',
    },
  ];
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, fit?: CompsFit): BoardRow[] {
  const comps = fit ?? fitComps(snapshot);
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
    const v = impliedValue(p, snapshot.as_of, model, comps);
    scored.push({ p, ...v, confidence: confidenceOf(p, snapshot.as_of) });
  }
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const cost = farmingCost(s.p, s.age, model);
    const exp = expectedValue(s.implied, s.p.tvl_usd, model);
    const net = exp.expected - cost.total;
    const verdict = verdictOf(net, model);
    // The band uses the row's own comps group's residual spread, not the pooled one: the
    // groups are not equally noisy, so a tight group's band is narrower than a noisy one's.
    const sd = comps.group_sd[s.group] ?? comps.residual_sd;
    const low = Math.max(1, Math.round(s.base * Math.exp(-sd)));
    const high = Math.round(s.base * Math.exp(sd));
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
      confidence: s.confidence,
      comps_multiple: Math.round((s.implied / s.p.tvl_usd) * 1000) / 1000,
      comps_base_usd: Math.max(1, Math.round(s.base)),
      comps_low_usd: low,
      comps_high_usd: high,
      expected_value_usd: exp.expected,
      farming_cost_usd: cost.total,
      net_value_usd: net,
      verdict,
      model: {
        comps_group: s.group,
        comps_offset: round4(s.offset),
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        reach_multiplier: round4(s.reachMult),
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age, { expected: exp.expected, cost: cost.total, net, verdict }, model).map(stepText),
    };
  });
}

/** A number rounded to four decimals, for the multipliers the board carries. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
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
    comps_group: compsGroup(p.category),
  }));
}

/** Every live-token protocol the curve is fitted on, by market cap, for the comps chart. */
export function liveAllRows(snapshot: Snapshot): LiveRow[] {
  const trading = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
  trading.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return trading.map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
    comps_group: compsGroup(p.category),
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
    comps_base_usd: row.comps_base_usd,
    comps_low_usd: row.comps_low_usd,
    comps_high_usd: row.comps_high_usd,
    expected_value_usd: row.expected_value_usd,
    farming_cost_usd: row.farming_cost_usd,
    net_value_usd: row.net_value_usd,
    verdict: row.verdict,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    reach_multiplier: row.model.reach_multiplier,
    comps_group: row.model.comps_group,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fit = fitComps(snapshot);
  const board = buildBoard(snapshot, model, fit);
  const live = liveRows(snapshot);
  const liveAll = liveAllRows(snapshot);
  let early = 0;
  const verdictCounts: Record<Verdict, number> = { farm: 0, thin: 0, skip: 0 };
  for (const r of board) {
    if (!snapshot.watchlist.includes(r.slug)) early++;
    verdictCounts[r.verdict]++;
  }
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
    comps: fit,
    verdict_counts: verdictCounts,
    rows,
    live,
    live_all: liveAll,
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
    if (r.verdict !== 'farm' && r.verdict !== 'thin' && r.verdict !== 'skip') return `${r.slug} has no farm verdict`;
    if (!Number.isFinite(r.net_value_usd) || !Number.isFinite(r.comps_base_usd) || r.comps_base_usd <= 0) {
      return `${r.slug} has no comps value`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
