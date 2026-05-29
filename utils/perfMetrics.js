'use strict';

/**
 * perfMetrics.js  — 8-Phase Performance Analysis Framework
 *
 * Phase map:
 *   1. CHILD_SELECTION   — locate + tap child name
 *   2. CART_BUILD        — locate + tap each product/qty
 *   3. WALLET_SELECTION  — wallet button enable wait + tap
 *   4. PAYMENT           — pay button → screen returns to Name state
 *   5. FULL_CYCLE        — wall-clock from cycle start to cycle end
 *   6. OPM tracking      — rolling orders-per-minute logged each cycle
 *   7. RECOVERY          — in-session alert-dismiss + pause (soft recovery)
 *   8. RELAUNCH          — full session tear-down + app relaunch (hard recovery)
 *
 * DOES NOT modify any automation, recovery, watchdog, or session logic.
 */

const { log } = require('./logger');

// ─── Phase keys ──────────────────────────────────────────────────────────────
const PHASES = {
  CHILD_SELECTION:    'childSelection',
  // ── Child selection sub-breakdown (instrumentation only — not in phase class arrays) ──
  CHILD_LOCATE:       'childLocate',      // time from selectChild entry to element found
  CHILD_CLICK:        'childClick',       // duration of the safeClick call itself
  CHILD_TRANSITION:   'childTransition',  // post-click wait for screen to change (backend)
  CART_BUILD:         'cartBuild',
  // ── Cart build sub-breakdown (instrumentation only) ──
  PRODUCT_LOCATE:     'productLocate',
  PRODUCT_CLICK:      'productClick',
  CART_REFRESH:       'cartRefresh',
  WALLET_READY:       'walletReady',
  WALLET_SELECTION:   'walletSelection',
  PAYMENT:            'payment',
  FULL_CYCLE:         'fullCycle',
  RECOVERY:           'recovery',    // Phase 7: in-session soft recovery
  RELAUNCH:           'relaunch',    // Phase 8: full session hard recovery
};

// ─── Classification: which phases are "automation active" vs "backend wait" ──
//   Automation-active: child selection search, product locate, wallet click
//   Backend-wait:      wallet enable wait, pay completion wait
// Note: CART_BUILD is a hybrid — product tap is automation-active, but the trailing
// _waitWalletEnabled (majority of the phase) is backend-wait. Classified as backend-wait
// since it dominates. CHILD_SELECTION overlay-close wait is also MAUI backend animation.
const AUTOMATION_ACTIVE_PHASES  = [PHASES.CHILD_SELECTION];
const BACKEND_WAIT_PHASES       = [PHASES.CART_BUILD, PHASES.WALLET_SELECTION, PHASES.PAYMENT];

// ─── Configured pauses (for audit report) ────────────────────────────────────
// These are documented in config.json and reviewed manually.
const PAUSE_AUDIT = [
  { name: 'delayAfterChildMs',             classification: 'optional',   note: 'Buffer after child select; currently 0ms — overlay close already confirmed before returning' },
  { name: 'delayAfterProductMs',           classification: 'optional',   note: 'Buffer after cart build; currently 0ms — wallet-enabled already confirmed before returning' },
  { name: 'delayAfterWalletMs',            classification: 'optional',   note: 'Buffer after wallet click; currently 20ms — effectively zero' },
  { name: 'delayAfterPayMs',              classification: 'optional',   note: 'Buffer after pay; currently 20ms — effectively zero' },
  { name: 'delayBetweenQuantityClicksMs',  classification: 'required',   note: 'MAUI needs time between qty increment clicks for backend cart sync' },
];

// ─── State ────────────────────────────────────────────────────────────────────
const _cycles     = [];   // [{ childSelection, cartBuild, walletSelection, payment, fullCycle }]
const _recoveries = [];   // [ms] — each soft-recovery duration
const _relaunches = [];   // [ms] — each hard-relaunch duration
let   _current    = null; // the cycle being recorded right now
let   _runStart   = Date.now(); // for rolling OPM calculation
const _fastpathStats = {  // fast-path hit/miss counters
  childHits:          0,
  childSearches:      0,
  productHits:        0,
  productSearches:    0,
  // Screen-reuse optimisation counters (pre-overlay probe)
  childFastPathHits:  0,  // child visible on screen before Name/search opened
  childSearchFallbacks: 0, // child not visible → fell through to Name/search flow
};

// ─── Child locate breakdown accumulator ──────────────────────────────────────
// Tracks per-call timing across all locate strategies to expose where ~1451ms goes.
// 'immediate' = screen-reuse or fast-path direct hit (element found without retry/scroll)
// 'search'    = search/scroll path used (findElementContainsFast + swipe loop)
const _locateBreakdown = {
  immediateHits:   0,   // cycles where element was found on first probe
  searchUsage:     0,   // cycles that fell through to search/scroll
  totalLookupMs:   0,   // sum of locate times for immediate hits (pure find cost)
  totalSearchMs:   0,   // sum of locate times for search path
};

// ─── Public API ───────────────────────────────────────────────────────────────

/** Call at the start of a transaction cycle. */
function startCycle() {
  _current = {};
}

/**
 * Record a completed phase duration (ms).
 * Also handles out-of-cycle phases: RECOVERY and RELAUNCH are stored directly
 * in their dedicated arrays and do not need an active cycle.
 * @param {string} phase  One of the PHASES values
 * @param {number} ms     Elapsed milliseconds
 */
function record(phase, ms) {
  if (phase === PHASES.RECOVERY) {
    _recoveries.push(ms);
    log('TIMING', `Recovery (soft): ${ms}ms`);
    return;
  }
  if (phase === PHASES.RELAUNCH) {
    _relaunches.push(ms);
    log('TIMING', `Relaunch (hard): ${ms}ms`);
    return;
  }
  if (!_current) return;
  _current[phase] = ms;
  log('TIMING', `${_phaseLabel(phase)}: ${ms}ms`);
}

/** Call at the end of a successful transaction cycle (after pay completes). */
function endCycle(totalMs) {
  if (!_current) return;
  _current[PHASES.FULL_CYCLE] = totalMs;
  log('TIMING', `Full cycle: ${totalMs}ms`);
  _cycles.push(_current);
  _current = null;
}

/** Discard in-progress cycle data (called on cycle failure/watchdog). */
function cancelCycle() {
  _current = null;
}

/**
 * Log rolling OPM after each successful cycle.
 * @param {number} cycleNum  Number of cycles completed so far (1-based)
 */
function logRollingOPM(cycleNum) {
  if (cycleNum <= 0) return;
  const elapsedMin = (Date.now() - _runStart) / 60000;
  const opm = elapsedMin > 0 ? (cycleNum / elapsedMin).toFixed(1) : '—';
  log('OPM', `Cycle #${cycleNum} | Rolling OPM: ${opm} | Elapsed: ${elapsedMin.toFixed(1)}min`);
}

/**
 * Record a fast-path hit or search fallback for child or product selection.
 * @param {'child'|'product'} type   Which element was probed
 * @param {boolean}           isHit  true = found directly, false = search/scroll used
 */
function recordFastpath(type, isHit) {
  if (type === 'child') {
    if (isHit) _fastpathStats.childHits++;           else _fastpathStats.childSearches++;
  } else if (type === 'product') {
    if (isHit) _fastpathStats.productHits++;         else _fastpathStats.productSearches++;
  } else if (type === 'childScreen') {
    // Screen-reuse optimisation: child visible before any Name/search interaction
    if (isHit) _fastpathStats.childFastPathHits++;   else _fastpathStats.childSearchFallbacks++;
  }
}

/**
 * Record child locate breakdown data for the CHILD LOCATE BREAKDOWN summary.
 * Call at every site that records CHILD_LOCATE.
 * @param {'immediate'|'search'} kind  How the element was found
 * @param {number} ms                  Duration of the locate phase (ms)
 */
function recordLocateBreakdown(kind, ms) {
  if (kind === 'immediate') {
    _locateBreakdown.immediateHits++;
    _locateBreakdown.totalLookupMs += ms;
  } else if (kind === 'search') {
    _locateBreakdown.searchUsage++;
    _locateBreakdown.totalSearchMs += ms;
  }
}

/**
 * Print the full performance summary report.
 * Call once at end of run, before session teardown.
 */
function printSummary() {
  const n = _cycles.length;
  if (n === 0) {
    log('PERF', 'No completed cycles to analyse.');
    return;
  }

  const avg   = (phase) => _avg(_cycles.map(c => c[phase]).filter(v => v != null));
  const pct   = (val, total) => total > 0 ? ((val / total) * 100).toFixed(1) + '%' : 'N/A';

  const avgChild   = avg(PHASES.CHILD_SELECTION);
  const avgChildLocate     = avg(PHASES.CHILD_LOCATE);
  const avgChildClick      = avg(PHASES.CHILD_CLICK);
  const avgChildTransition = avg(PHASES.CHILD_TRANSITION);
  const avgCart    = avg(PHASES.CART_BUILD);
  const avgProductLocate = avg(PHASES.PRODUCT_LOCATE);
  const avgProductClick  = avg(PHASES.PRODUCT_CLICK);
  const avgCartRefresh   = avg(PHASES.CART_REFRESH);
  const avgWalletReady   = avg(PHASES.WALLET_READY);
  const avgWallet  = avg(PHASES.WALLET_SELECTION);
  const avgPayment = avg(PHASES.PAYMENT);
  const avgCycle   = avg(PHASES.FULL_CYCLE);

  // Active vs wait breakdown
  const avgActive  = _avgSum(_cycles, AUTOMATION_ACTIVE_PHASES);
  const avgWait    = _avgSum(_cycles, BACKEND_WAIT_PHASES);
  const avgOther   = avgCycle - avgActive - avgWait;   // config pauses + overhead

  // Orders per minute estimate
  const cyclesPerMin = avgCycle > 0 ? (60000 / avgCycle).toFixed(1) : 'N/A';

  // Bottleneck ranking (exclude fullCycle itself)
  const phaseAvgs = [
    { label: 'Child Selection',  val: avgChild  },
    { label: 'Cart Build',       val: avgCart   },
    { label: 'Wallet Selection', val: avgWallet },
    { label: 'Payment',          val: avgPayment},
  ].filter(p => p.val != null).sort((a, b) => b.val - a.val);

  _separator();
  log('PERF', '=== PERFORMANCE SUMMARY ===');
  log('PERF', `Completed cycles analysed : ${n}`);
  log('PERF', `Estimated orders/minute   : ${cyclesPerMin}`);
  _separator();

  log('PERF', `Average Full Cycle        : ${_fmt(avgCycle)}`);
  log('PERF', '');
  log('PERF', '--- Phase Breakdown ---');
  log('PERF', `  Child Selection         : ${_fmt(avgChild)}   (${pct(avgChild,  avgCycle)} of cycle)`);
  log('PERF', `  Cart Build              : ${_fmt(avgCart)}    (${pct(avgCart,   avgCycle)} of cycle)`);
  log('PERF', `  Wallet Selection        : ${_fmt(avgWallet)}  (${pct(avgWallet, avgCycle)} of cycle)`);
  log('PERF', `  Payment Processing      : ${_fmt(avgPayment)} (${pct(avgPayment,avgCycle)} of cycle)`);
  _separator();

  // Child selection sub-breakdown (only shown when sub-phase data exists)
  const childSubAvailable = avgChildLocate > 0 || avgChildClick > 0 || avgChildTransition > 0;
  if (childSubAvailable) {
    log('PERF', '--- Child Selection Sub-Breakdown ---');
    log('PERF', `  Locate  (find element)   : ${_fmt(avgChildLocate)}     (${pct(avgChildLocate,     avgChild)} of child phase)`);
    log('PERF', `  Click   (safeClick call) : ${_fmt(avgChildClick)}      (${pct(avgChildClick,      avgChild)} of child phase)`);
    log('PERF', `  Transition (screen change): ${_fmt(avgChildTransition)} (${pct(avgChildTransition, avgChild)} of child phase)  ← backend wait`);
    const childSubSum = avgChildLocate + avgChildClick + avgChildTransition;
    const childSubDelta = avgChild - childSubSum;
    log('PERF', `  Sub-phase sum            : ${_fmt(childSubSum)}  (delta from aggregate: ${childSubDelta >= 0 ? '+' : ''}${childSubDelta}ms)`);
    if (avgChildTransition > avgChild * 0.5) {
      log('PERF', `  ⚠  Transition is >50% of Child Selection — this is backend/MAUI navigation, not automation overhead.`);
    }
    _separator();
  }

  // Cart build sub-breakdown (only shown when sub-phase data exists)
  const cartSubAvailable = avgProductLocate > 0 || avgProductClick > 0 || avgCartRefresh > 0 || avgWalletReady > 0;
  if (cartSubAvailable) {
    log('PERF', '--- Cart Build Sub-Breakdown ---');
    log('PERF', `  Product Locate           : ${_fmt(avgProductLocate)} (${pct(avgProductLocate, avgCart)} of cart build)`);
    log('PERF', `  Product Click            : ${_fmt(avgProductClick)} (${pct(avgProductClick, avgCart)} of cart build)`);
    log('PERF', `  Cart Refresh             : ${_fmt(avgCartRefresh)} (${pct(avgCartRefresh, avgCart)} of cart build)  ← MAUI/cart settle pauses`);
    log('PERF', `  Wallet Ready             : ${_fmt(avgWalletReady)} (${pct(avgWalletReady, avgCart)} of cart build)  ← backend enable transition`);
    const cartSubSum = avgProductLocate + avgProductClick + avgCartRefresh + avgWalletReady;
    const cartSubDelta = avgCart - cartSubSum;
    log('PERF', `  Sub-phase sum            : ${_fmt(cartSubSum)}  (delta from aggregate: ${cartSubDelta >= 0 ? '+' : ''}${cartSubDelta}ms)`);
    if (avgWalletReady > avgCart * 0.4) {
      log('PERF', `  ⚠  Wallet Ready dominates cart build — backend/cart synchronization is the bottleneck.`);
    }
    _separator();
  }

  log('PERF', '--- Automation Active vs Backend Wait ---');
  log('PERF', `  Automation Active Time  : ${_fmt(avgActive)}  (${pct(avgActive, avgCycle)} of cycle)`);
  log('PERF', `  Backend/UI Wait Time    : ${_fmt(avgWait)}    (${pct(avgWait,   avgCycle)} of cycle)`);
  log('PERF', `  Config Pauses + Overhead: ${_fmt(avgOther)}   (${pct(avgOther,  avgCycle)} of cycle)`);
  if (childSubAvailable && avgChildTransition > 0) {
    const adjActive = avgActive - avgChildTransition;
    const adjWait   = avgWait   + avgChildTransition;
    log('PERF', `  NOTE: Child Selection is classified as Automation-Active above, but sub-breakdown`);
    log('PERF', `        shows ${_fmt(avgChildTransition)} (${pct(avgChildTransition, avgCycle)} of cycle) is backend screen transition.`);
    log('PERF', `  Adjusted Active (excl. child transition): ${_fmt(adjActive)}  (${pct(adjActive, avgCycle)} of cycle)`);
    log('PERF', `  Adjusted Backend (incl. child transition): ${_fmt(adjWait)}   (${pct(adjWait,  avgCycle)} of cycle)`);
  }
  _separator();

  log('PERF', '--- Top Bottlenecks ---');
  phaseAvgs.forEach((p, i) => {
    log('PERF', `  #${i + 1} ${p.label.padEnd(20)} ${_fmt(p.val)}`);
  });
  _separator();

  log('PERF', '--- Configured Pause Audit ---');
  for (const p of PAUSE_AUDIT) {
    log('PERF', `  [${p.classification.toUpperCase().padEnd(8)}] ${p.name.padEnd(32)} — ${p.note}`);
  }
  _separator();

  _printRecommendations(avgChild, avgCart, avgWallet, avgPayment, avgCycle, avgWait, avgActive);
  _separator();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _avg(arr) {
  if (!arr || arr.length === 0) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function _avgSum(cycles, phases) {
  return _avg(cycles.map(c => phases.reduce((sum, ph) => sum + (c[ph] || 0), 0)));
}

function _fmt(ms) {
  if (ms == null || ms === 0) return '  N/A      ';
  return `${(ms / 1000).toFixed(2)}s (${ms}ms)`;
}

function _phaseLabel(phase) {
  const map = {
    [PHASES.CHILD_SELECTION]:  'Child selection',
    [PHASES.CHILD_LOCATE]:     'Child locate',
    [PHASES.CHILD_CLICK]:      'Child click',
    [PHASES.CHILD_TRANSITION]: 'Child transition (backend)',
    [PHASES.CART_BUILD]:       'Cart build (product selection)',
    [PHASES.PRODUCT_LOCATE]:   'Product locate',
    [PHASES.PRODUCT_CLICK]:    'Product click',
    [PHASES.CART_REFRESH]:     'Cart refresh',
    [PHASES.WALLET_READY]:     'Wallet ready',
    [PHASES.WALLET_SELECTION]: 'Wallet selection',
    [PHASES.PAYMENT]:          'Payment processing',
    [PHASES.FULL_CYCLE]:       'Full cycle',
  };
  return map[phase] || phase;
}

function _separator() {
  log('PERF', '─'.repeat(60));
}

function _printRecommendations(avgChild, avgCart, avgWallet, avgPayment, avgCycle, avgWait, avgActive) {
  log('PERF', '--- Prioritised Optimisation Recommendations ---');
  log('PERF', '');

  const recs = [];

  // HIGH: backend/UI wait dominates
  const waitPct = avgCycle > 0 ? (avgWait / avgCycle) * 100 : 0;
  if (waitPct > 60) {
    recs.push({
      priority: 'HIGH IMPACT',
      title:    'Backend/UI latency is the primary bottleneck',
      detail:   `${waitPct.toFixed(0)}% of cycle time is spent waiting for backend/screen transitions. Automation speed-ups will have limited effect until app/network latency is reduced.`,
      gain:     'Marginal from automation side',
      risk:     'N/A — app/network change needed',
      effort:   'High (requires backend or network improvement)',
    });
  }

  // HIGH: child selection slow
  if (avgChild > 3000) {
    recs.push({
      priority: 'HIGH IMPACT',
      title:    'Child selection is slow (>3s average)',
      detail:   `Average child selection: ${_fmt(avgChild)}. Check Child Sub-Breakdown above — if Transition time dominates (>50%), this is backend/MAUI navigation latency, not an automation issue. If Locate time dominates, the child is not immediately visible and scroll/retry paths are activating.`,
      gain:     '10–20% reduction in child phase time',
      risk:     'Low — additive optimisation',
      effort:   'Medium',
    });
  }

  // HIGH: payment slow
  if (avgPayment > 10000) {
    recs.push({
      priority: 'HIGH IMPACT',
      title:    'Payment processing is slow (>10s average)',
      detail:   `Average payment: ${_fmt(avgPayment)}. This is likely backend transaction time, not automation delay. Confirm with network logs.`,
      gain:     'Cannot be reduced by automation alone',
      risk:     'N/A — backend dependent',
      effort:   'High (backend investigation required)',
    });
  }

  // MEDIUM: wallet slow (should be <1s normally)
  if (avgWallet > 2000) {
    recs.push({
      priority: 'MEDIUM IMPACT',
      title:    'Wallet selection taking >2s',
      detail:   `Average wallet selection: ${_fmt(avgWallet)}. Wallet button enable wait may be delayed by cart recalculation. Monitor whether this correlates with larger carts.`,
      gain:     '5–10% if enablement wait can be reduced',
      risk:     'Medium — may cause premature click on slow networks',
      effort:   'Low',
    });
  }

  // MEDIUM: cart build slow
  if (avgCart > 2000) {
    recs.push({
      priority: 'MEDIUM IMPACT',
      title:    'Cart build taking >2s',
      detail:   `Average cart build: ${_fmt(avgCart)}. Product is not found on first fast-path probe — fallback scroll search is activating. Consider scrolling product list to top before searching.`,
      gain:     '5–15% if product is consistently visible without scrolling',
      risk:     'Low',
      effort:   'Low',
    });
  }

  // LOW: textContains locators
  recs.push({
    priority: 'LOW IMPACT',
    title:    'Replace textContains locators with exact text where product names are known',
    detail:   'textContains adds overhead when multiple elements partially match. Exact text matching is faster. Safe only when product names are exact and stable.',
    gain:     '1–3% per search',
    risk:     'Low if product names are exactly known',
    effort:   'Low',
  });

  // LOW: delayBetweenQuantityClicksMs
  recs.push({
    priority: 'LOW IMPACT',
    title:    'Reduce delayBetweenQuantityClicksMs from 1000ms if MAUI cart updates fast',
    detail:   'Currently 1000ms between repeated product clicks for qty increment. Try 700ms in a test run and verify cart registers correctly. Reduces time for qty > 1 orders.',
    gain:     '300ms saved per extra qty click',
    risk:     'Medium — MAUI cart sync may miss clicks if too fast',
    effort:   'Trivial — config change only',
  });

  // Print recommendations grouped by priority
  for (const priority of ['HIGH IMPACT', 'MEDIUM IMPACT', 'LOW IMPACT']) {
    const group = recs.filter(r => r.priority === priority);
    if (group.length === 0) continue;
    log('PERF', `[${priority}]`);
    for (const r of group) {
      log('PERF', `  • ${r.title}`);
      log('PERF', `    ${r.detail}`);
      log('PERF', `    Expected gain : ${r.gain}`);
      log('PERF', `    Risk          : ${r.risk}`);
      log('PERF', `    Effort        : ${r.effort}`);
      log('PERF', '');
    }
  }

  // Fastpath stats
  const childTotal   = _fastpathStats.childHits   + _fastpathStats.childSearches;
  const productTotal = _fastpathStats.productHits  + _fastpathStats.productSearches;
  const screenTotal  = _fastpathStats.childFastPathHits + _fastpathStats.childSearchFallbacks;
  const childHitPct   = childTotal   > 0 ? (((_fastpathStats.childHits   / childTotal)   * 100).toFixed(0) + '%') : 'N/A';
  const productHitPct = productTotal > 0 ? (((_fastpathStats.productHits / productTotal) * 100).toFixed(0) + '%') : 'N/A';
  const screenHitPct  = screenTotal  > 0 ? (((_fastpathStats.childFastPathHits / screenTotal) * 100).toFixed(0) + '%') : 'N/A';

  _separator();
  log('PERF', '=== FASTPATH STATS ===');
  log('PERF', `Screen Reuse Hits     : ${_fastpathStats.childFastPathHits.toString().padStart(4)}  /  ${screenTotal.toString().padStart(4)} cycles  (${screenHitPct} hit rate)  [childFastPathHits]`);
  log('PERF', `Search Fallbacks      : ${_fastpathStats.childSearchFallbacks.toString().padStart(4)}  /  ${screenTotal.toString().padStart(4)} cycles  [childSearchFallbacks]`);
  log('PERF', `Child   Direct Hits   : ${_fastpathStats.childHits.toString().padStart(4)}  /  ${childTotal.toString().padStart(4)} cycles  (${childHitPct} hit rate)  [within-overlay]`);
  log('PERF', `Child   Search Fallback: ${_fastpathStats.childSearches.toString().padStart(4)}  /  ${childTotal.toString().padStart(4)} cycles`);
  log('PERF', `Product Direct Hits   : ${_fastpathStats.productHits.toString().padStart(4)}  /  ${productTotal.toString().padStart(4)} item-clicks  (${productHitPct} hit rate)`);
  log('PERF', `Product Search Fallback: ${_fastpathStats.productSearches.toString().padStart(4)}  /  ${productTotal.toString().padStart(4)} item-clicks`);
  if (screenHitPct !== 'N/A' && parseInt(screenHitPct) < 50) {
    log('PERF', '  ⚠️  Low screen-reuse hit rate. Child may not be visible before opening Name/search — this is expected on cycle 1 and when child changes.');
  }
  if (childHitPct !== 'N/A' && parseInt(childHitPct) < 50) {
    log('PERF', '  ⚠️  Low child fast-path hit rate. Child position in list may vary — consider scrolling to top after payment before re-selecting.');
  }
  if (productHitPct !== 'N/A' && parseInt(productHitPct) < 50) {
    log('PERF', '  ⚠️  Low product fast-path hit rate. Products may not be consistently visible without scrolling.');
  }
  _separator();

  // ─── Child Locate Breakdown ────────────────────────────────────────────────
  const _lbTotal = _locateBreakdown.immediateHits + _locateBreakdown.searchUsage;
  if (_lbTotal > 0) {
    const avgImmediateLookup = _locateBreakdown.immediateHits > 0
      ? Math.round(_locateBreakdown.totalLookupMs / _locateBreakdown.immediateHits) : 0;
    const avgSearchCost = _locateBreakdown.searchUsage > 0
      ? Math.round(_locateBreakdown.totalSearchMs / _locateBreakdown.searchUsage) : 0;

    log('PERF', '=== CHILD LOCATE BREAKDOWN ===');
    log('PERF', `Immediate Hits  : ${_locateBreakdown.immediateHits.toString().padStart(4)}  /  ${_lbTotal.toString().padStart(4)} cycles  (screen-reuse or fast-path direct find)`);
    log('PERF', `Search Fallbacks: ${_locateBreakdown.searchUsage.toString().padStart(4)}  /  ${_lbTotal.toString().padStart(4)} cycles  (findElementContainsFast + scroll path)`);
    log('PERF', '');
    log('PERF', `Average Initial Lookup : ${avgImmediateLookup.toString().padStart(5)} ms  ← pure Appium query cost (no retries, no scroll)`);
    log('PERF', `Average Search Cost    : ${avgSearchCost.toString().padStart(5)} ms  ← includes retries + scroll + settle delays`);
    log('PERF', '');
    if (avgImmediateLookup > 500) {
      log('PERF', `  ⚠  Average immediate lookup is ${avgImmediateLookup}ms — each Appium $$/isDisplayed() call is costly.`);
      log('PERF', `     On WiFi, 2–4 sequential driver calls × 200–500ms each = 400–2000ms per locate.`);
      log('PERF', `     Note: pre-locate overlay check (closePre) adds a further ~400–1000ms BEFORE the locate timer starts.`);
      log('PERF', `     Realistic floor for immediate locate is ~2 driver calls × WiFi RTT — not reducible without USB or element caching.`);
    }
    _separator();
  }

  // Human vs automation conclusion
  const ordersPerMin = avgCycle > 0 ? (60000 / avgCycle) : 0;
  log('PERF', '--- Human vs Automation Speed Assessment ---');
  if (ordersPerMin >= 8) {
    log('PERF', `  ✅ Automation at ${ordersPerMin.toFixed(1)} orders/min. Matches or exceeds typical diner staff throughput (8–10/min).`);
  } else if (ordersPerMin >= 5) {
    log('PERF', `  ⚠️  Automation at ${ordersPerMin.toFixed(1)} orders/min. Slower than target (8–10/min). Bottleneck is likely backend latency — see HIGH IMPACT items.`);
  } else {
    log('PERF', `  ❌ Automation at ${ordersPerMin.toFixed(1)} orders/min. Well below target. Investigate backend/network latency first before tuning automation delays.`);
  }
}

module.exports = { PHASES, startCycle, record, endCycle, cancelCycle, printSummary, logRollingOPM, recordFastpath, recordLocateBreakdown };
