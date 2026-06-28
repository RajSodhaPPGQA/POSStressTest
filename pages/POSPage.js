const BasePage = require('./BasePage');
const locators = require('../locators.json');
const config   = require('../config.json');
const { log }  = require('../utils/logger');
const perf     = require('../utils/perfMetrics');

// ─── Fast-path state flags ────────────────────────────────────────────────────
// These are set to true after the first successful navigation to each screen.
// They allow direct-visibility probes on subsequent cycles before falling back
// to scroll/search. Flags survive within a run; crash/relaunch keeps them true
// because the fast-path probe always falls back gracefully if not visible.
const _state = {
  childListLoaded: false,  // set after first successful child selection
  menuLoaded:      false,  // set after first successful product click
};

class POSPage {
  static lastSelectedChild = null;
  static _productCache = new Map();

  static _isFatalDriverError(err) {
    const msg = ((err && err.message) || '').toLowerCase();
    return msg.includes('instrumentation process is not running') ||
      msg.includes('instrumentation') ||
      msg.includes('cannot be proxied') ||
      msg.includes('socket') ||
      msg.includes('session') ||
      msg.includes('refused') ||
      msg.includes('connection');
  }

  static async _waitWalletEnabled(driver, timeoutMs = 3500, intervalMs = 30) {
    const selector = `android=new UiSelector().text("${locators.selectWalletButton}")`;
    const start = Date.now();
    let pollCount = 0;
    const walletEl = await driver.$(selector);

    while ((Date.now() - start) < timeoutMs) {
      pollCount++;
      try {
        const enabled = await walletEl.isEnabled().catch(() => false);
        if (enabled) {
          log("TIMING", `Wallet Ready Polls = ${pollCount}`);
          return walletEl;
        }
      } catch (err) {
        if (this._isFatalDriverError(err)) {
          throw new Error(`INSTRUMENTATION_CRASH_DETECTED: ${err.message}`);
        }
      }

      await driver.pause(intervalMs);
    }

    throw new Error(`Select Wallet button not enabled within ${timeoutMs}ms`);
  }

  static async swipeChildList(driver, direction = 'up', percent = 0.75) {
    if (direction === 'down') {
      await BasePage.swipeDown(driver, percent, 'childList');
      return;
    }
    await BasePage.swipeUp(driver, percent, 'childList');
  }

  static async isMenuDisplayed(driver) {
    try {
      return await driver.$(`android=new UiSelector().text("${locators.menuOption}")`).isDisplayed().catch(() => false);
    } catch (e) {
      return false;
    }
  }

  static async isPOSMainDisplayed(driver) {
    try {
      return await driver.$(`android=new UiSelector().text("${locators.nameButton}")`).isDisplayed().catch(() => false);
    } catch (e) {
      return false;
    }
  }

  static async isSearchChildDisplayed(driver) {
    try {
      return await driver.$(`android=new UiSelector().text("${locators.closeButton}")`).isDisplayed().catch(() => false);
    } catch (e) {
      return false;
    }
  }

  static async isProductPageWithSelectedProduct(driver) {
    const selectWalletBtn = await driver.$(`android=new UiSelector().text("${locators.selectWalletButton}")`);
    try {
      return await selectWalletBtn.isDisplayed() && await selectWalletBtn.isEnabled();
    } catch (e) {
      return false;
    }
  }

  static async clickMenuOption(driver) {
    log("POS_MENU", `Clicking menu option: "${locators.menuOption}"...`);
    const targetSelector = `android=new UiSelector().text("${locators.nameButton}")`;
    const nameBtn = await driver.$(targetSelector);

    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        // Pre-check: if already transitioned to POS page, skip menu option click retry (only on attempt > 1)
        if (attempt > 1 && await nameBtn.isExisting() && await nameBtn.isDisplayed().catch(() => false)) {
          log("POS_MENU", `Already transitioned to POS page, skipping menu option click retry.`);
          return;
        }
        log("POS_MENU", `Clicking menu option attempt ${attempt}/4...`);
        const menuBtn = await BasePage.findElementFast(driver, locators.menuOption);
        await BasePage.safeClick(driver, menuBtn);
        
        // Wait up to 10 seconds for transition before retrying click
        let transitioned = false;
        const start = Date.now();
        while ((Date.now() - start) < 10000) {
          // Proactively clear any network failure or server error alerts that block loading
          try {
            await BasePage.checkForAlertsAndDismiss(driver);
          } catch (e) {}

          if (await nameBtn.isExisting() && await nameBtn.isDisplayed().catch(() => false)) {
            transitioned = true;
            break;
          }
          await driver.pause(500);
        }
        
        if (transitioned) {
          log("POS_MENU", `Successfully transitioned to POS page after clicking "${locators.menuOption}"`);
          return;
        }
        log("POS_MENU_WARNING", `Click on "${locators.menuOption}" did not transition within 10s. Retrying click...`);
      } catch (err) {
        log("POS_MENU_WARNING", `Error during menu option click attempt ${attempt}: ${err.message}`);
        await driver.pause(1000);
      }
    }
    
    // Final wait/fallback to monitor transition
    await BasePage.monitorTransition(driver, async () => {
      return await nameBtn.isExisting() && await nameBtn.isDisplayed();
    }, 60000, 1000);
  }

  static async clickName(driver) {
    log("POS", "Clicking 'Name' button to open Search Child...");
    const nameBtn = await BasePage.findElementFast(driver, locators.nameButton);
    await BasePage.safeClick(driver, nameBtn);
    
    // Monitor transition to Search Child overlay for up to 30 seconds
    const closeSelector = `android=new UiSelector().text("${locators.closeButton}")`;
    await BasePage.monitorTransition(driver, async () => {
      const closeMatches = await driver.$$(closeSelector);
      return closeMatches.length > 0 && await closeMatches[0].isDisplayed().catch(() => false);
    }, 30000, 60);
  }

  static async selectChild(driver, childName) {
    log("POS", `Searching and selecting child: "${childName}"...`);

    const executionMode = process.env.EXECUTION_MODE || config.executionMode || 'standard';
    const isRapid = executionMode === 'rapid';

    // ── RAPID MODE CHILD CONTEXT REUSE ──────────────────────────────────────────
    if (isRapid && childName === POSPage.lastSelectedChild) {
      log("CHILD_FASTPATH", `Rapid mode: reusing child context for "${childName}". Attempting rapid select.`);
      const _rapidStart = Date.now();
      try {
        const targetEl = await driver.$(`android=new UiSelector().textContains("${childName}")`);
        if (await targetEl.isDisplayed().catch(() => false)) {
          const _rapidLocate = Date.now() - _rapidStart;
          const _clickStart = Date.now();
          await BasePage.safeClick(driver, targetEl);
          const _rapidClick = Date.now() - _clickStart;
          
          log("POS", `Child "${childName}" selected rapidly`);
          perf.recordLocateBreakdown('immediate', _rapidLocate);
          perf.record(perf.PHASES.CHILD_LOCATE,     _rapidLocate);
          perf.record(perf.PHASES.CHILD_CLICK,      _rapidClick);
          perf.record(perf.PHASES.CHILD_TRANSITION, 0); // Skip transition wait in rapid mode
          POSPage.lastSelectedChild = childName;
          _state.childListLoaded = true;
          return;
        }
      } catch (e) {
        log("CHILD_FASTPATH_WARN", `Rapid child selection failed: ${e.message}. Falling back to normal flow.`);
      }
    }

    // ── SCREEN REUSE FAST PATH ────────────────────────────────────────────────
    // After payment the app returns to the child list screen scrolled to the
    // last selected child. If the target child is already visible without
    // opening the Name/search overlay, click it directly and skip both the
    // Name button tap and the search interaction.
    //
    // Works for two scenarios:
    //   a) Overlay already open (State_D) — child visible in overlay list.
    //   b) Main POS screen (State_C) — child visible directly in the list.
    //
    // On probe failure or unsuccessful click verification, falls through to
    // the existing Name/search flow unchanged.
    try {
      // Single non-retrying probe for child on the current screen
      let screenTarget = null;
      const _srLocateStart = Date.now();

      if (isRapid) {
        // In rapid mode, skip exact match probe and go straight to textContains to save RTT
        const srContainsEl = await driver.$(`android=new UiSelector().textContains("${childName}")`);
        const srContainsVisible = await srContainsEl.isDisplayed().catch(() => false);
        if (srContainsVisible) {
          screenTarget = srContainsEl;
          log("CHILD_FASTPATH", `Element found immediately (contains match, rapid)`);
        }
      } else {
        const _t1 = Date.now();
        const srExactEl = await driver.$(`android=new UiSelector().text("${childName}")`);
        const _exactQueryMs = Date.now() - _t1;
        const _t2 = Date.now();
        const srExactVisible = await srExactEl.isDisplayed().catch(() => false);
        const _exactVisMs = Date.now() - _t2;

        if (srExactVisible) {
          screenTarget = srExactEl;
          log("CHILD_FASTPATH", `Element found immediately (exact match) | exact_query=${_exactQueryMs}ms | vis_check=${_exactVisMs}ms`);
        } else {
          const _t3 = Date.now();
          const srContainsEl = await driver.$(`android=new UiSelector().textContains("${childName}")`);
          const _containsQueryMs = Date.now() - _t3;
          const _t4 = Date.now();
          const srContainsVisible = await srContainsEl.isDisplayed().catch(() => false);
          const _containsVisMs = Date.now() - _t4;
          if (srContainsVisible) {
            screenTarget = srContainsEl;
            log("CHILD_FASTPATH", `Element found immediately (contains match) | exact_query=${_exactQueryMs}ms | exact_vis=${_exactVisMs}ms | contains_query=${_containsQueryMs}ms | contains_vis=${_containsVisMs}ms`);
          } else {
            log("CHILD_FASTPATH", `Element not visible on screen | exact_query=${_exactQueryMs}ms | exact_vis=${_exactVisMs}ms | contains_query=${_containsQueryMs}ms | contains_vis=${_containsVisMs}ms`);
          }
        }
      }
      const _srLocateMs = Date.now() - _srLocateStart;

      if (screenTarget) {
        log("FASTPATH", `Child "${childName}" already visible on screen — clicking directly (skipping Name/search)`);
        const _srClickStart = Date.now();
        await BasePage.safeClick(driver, screenTarget);
        const _srClickMs = Date.now() - _srClickStart;
        const _srTransStart = Date.now();

        // Verify the click produced the expected screen transition to POS Product page (State H)
        const walletSelector = `android=new UiSelector().text("${locators.selectWalletButton}")`;
        await driver.waitUntil(
          async () => await driver.$(walletSelector).isDisplayed().catch(() => false),
          { timeout: 5000, interval: 50 }
        ).catch(() => {});
        const srSucceeded = await driver.$(walletSelector).isDisplayed().catch(() => false);

        if (srSucceeded) {
          log("POS", `Child "${childName}" selected via screen reuse fast path`);
          const _srTransMs = Date.now() - _srTransStart;
          log("TIMING", `Child Locate = ${_srLocateMs}ms`);
          log("TIMING", `Child Click = ${_srClickMs}ms`);
          log("TIMING", `Child Transition = ${_srTransMs}ms`);
          perf.recordLocateBreakdown('immediate', _srLocateMs);
          perf.record(perf.PHASES.CHILD_LOCATE,     _srLocateMs);
          perf.record(perf.PHASES.CHILD_CLICK,      _srClickMs);
          perf.record(perf.PHASES.CHILD_TRANSITION, _srTransMs);
          perf.recordFastpath('childScreen', true);
          _state.childListLoaded = true;
          POSPage.lastSelectedChild = childName;
          return;
        }
        // Click registered but transition did not complete — fall through to Name/search
        log("POS_WARNING", "Screen reuse click did not produce expected transition, falling back to Name/search...");
        perf.recordFastpath('childScreen', false);
      } else {
        log("FALLBACK", `Child "${childName}" not visible on screen — using Name/search flow`);
        perf.recordFastpath('childScreen', false);
      }
    } catch (srErr) {
      log("POS_WARNING", `Screen reuse probe failed (${srErr.message}), proceeding with Name/search`);
      perf.recordFastpath('childScreen', false);
    }

    // ── FAST PATH ─────────────────────────────────────────────────────────────
    // After the first successful cycle the child list overlay position is known.
    // Attempt a single direct-visibility probe before triggering scroll/search.
    if (_state.childListLoaded) {
      try {
        // Check CLOSE overlay open state AND child visibility in one batch of parallel-ish probes.
        // If overlay is not open, click Name and wait. If already open, skip clickName entirely.
        const closeSelector = `android=new UiSelector().text("${locators.closeButton}")`;
        const _fpLocateStart = Date.now();
        log("CHILD_FASTPATH", `Immediate lookup started`);
        const closePre = await driver.$(closeSelector);
        const overlayAlreadyOpen = await closePre.isDisplayed().catch(() => false);
        const _fpOverheadMs = Date.now() - _fpLocateStart;
        if (!overlayAlreadyOpen) {
          log("CHILD_FASTPATH", `Overlay not open — calling clickName | overlay_check=${_fpOverheadMs}ms`);
          await this.clickName(driver);
        } else {
          log("CHILD_FASTPATH", `Overlay already open | overlay_check=${_fpOverheadMs}ms`);
        }
        // Single non-retrying probe — no scrolling, no waiting
        // _fpProbeStart marks the pure element-find time (after any overlay-open overhead)
        const _fpProbeStart = Date.now();
        let fastTarget = null;
        const fastExactEl = await driver.$(`android=new UiSelector().text("${childName}")`);
        const fastExactVisible = await fastExactEl.isDisplayed().catch(() => false);
        if (fastExactVisible) {
          fastTarget = fastExactEl;
        } else {
          const fastContainsEl = await driver.$(`android=new UiSelector().textContains("${childName}")`);
          const fastContainsVisible = await fastContainsEl.isDisplayed().catch(() => false);
          if (fastContainsVisible) {
            fastTarget = fastContainsEl;
          }
        }
        const _fpProbeMs = Date.now() - _fpProbeStart;
        const _fpLocateMs = Date.now() - _fpLocateStart;
        // _fpLocateMs includes overlay check + optional clickName (screen navigation) + probe.
        // _fpProbeMs is the pure element-find time only.

        if (fastTarget) {
          log("CHILD_FASTPATH", `Element found immediately | probe=${_fpProbeMs}ms | total_locate=${_fpLocateMs}ms${!overlayAlreadyOpen ? ' (includes clickName overhead — not pure locate)' : ''}`);
          log("FASTPATH", `Child visible, skipping search`);
          perf.recordFastpath('child', true);
          const _fpClickStart = Date.now();
          await BasePage.safeClick(driver, fastTarget);
          const _fpClickMs = Date.now() - _fpClickStart;
          const _fpTransStart = Date.now();

          const walletSelector = `android=new UiSelector().text("${locators.selectWalletButton}")`;
          await driver.waitUntil(
            async () => await driver.$(walletSelector).isDisplayed().catch(() => false),
            { timeout: 5000, interval: 50 }
          ).catch(() => {});
          const transitioned = await driver.$(walletSelector).isDisplayed().catch(() => false);
          if (transitioned) {
            log("POS", `Child "${childName}" selected via direct fast path`);
            const _fpTransMs = Date.now() - _fpTransStart;
            log("TIMING", `Child Locate = ${_fpLocateMs}ms`);
            log("TIMING", `Child Click = ${_fpClickMs}ms`);
            log("TIMING", `Child Transition = ${_fpTransMs}ms`);
            perf.recordLocateBreakdown('immediate', _fpProbeMs);
            perf.record(perf.PHASES.CHILD_LOCATE,     _fpLocateMs);
            perf.record(perf.PHASES.CHILD_CLICK,      _fpClickMs);
            perf.record(perf.PHASES.CHILD_TRANSITION, _fpTransMs);
            POSPage.lastSelectedChild = childName;
            return; // ✅ fast-path success
          }
          // Click registered but overlay still showing — fall through to search
          log("POS_WARNING", "Fast path click did not close overlay, falling back to search...");
        } else {
          log("CHILD_FASTPATH", `Retry loop entered — element not visible after single probe | probe=${_fpProbeMs}ms`);
          log("SEARCH", `Child not visible, using search`);
        }
      } catch (fastErr) {
        log("POS_WARNING", `Fast path probe failed (${fastErr.message}), falling back to search...`);
      }
      perf.recordFastpath('child', false);
    } else {
      log("SEARCH", `Child not visible, using search`);
      perf.recordFastpath('child', false);
    }

    // ── SEARCH PATH ───────────────────────────────────────────────────────────
    // Existing scroll + retry logic — unchanged.
    let childSelected = false;
    const _spLoopStart = Date.now();
    let _spClickStart = 0, _spTransStart = 0;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        // Pre-check: if already transitioned to POS Product page (wallet selection visible), skip search/click retry (only on attempt > 1)
        if (attempt > 1) {
          const walletSelector = `android=new UiSelector().text("${locators.selectWalletButton}")`;
          if (await driver.$(walletSelector).isDisplayed().catch(() => false)) {
            log("POS", `Child "${childName}" already selected (Product screen loaded), skipping search retry.`);
            childSelected = true;
            break;
          }
        }
        log("POS", `Selecting child "${childName}" - Attempt ${attempt}/5...`);
        if (!(await this.isSearchChildDisplayed(driver))) {
          log("POS", "Search Child overlay not visible. Re-opening Name search...");
          await this.clickName(driver);
        }

        let childElement = null;
        const exactEl = await driver.$(`android=new UiSelector().text("${childName}")`);
        const exactVisible = await exactEl.isDisplayed().catch(() => false);
        if (exactVisible) {
          childElement = exactEl;
        }

        if (!exactVisible) {
          childElement = await BasePage.findElementContainsFast(driver, childName, 'childList');
        }
        
        // Use safeClick with dual native click & gesture support for bubble-up clicks in RecyclerView
        _spClickStart = Date.now();
        await BasePage.safeClick(driver, childElement);
        _spTransStart = Date.now();
        
        // Verify the click produced the expected screen transition to POS Product page (State H)
        await driver.waitUntil(
          async () => await driver.$(walletSelector).isDisplayed().catch(() => false),
          { timeout: 5000, interval: 50 }
        ).catch(() => {});
        const transitionSuccess = await driver.$(walletSelector).isDisplayed().catch(() => false);
        
        if (transitionSuccess) {
          log("POS", `🎉 Child "${childName}" successfully selected (Product screen loaded)`);
          const _spLocateMs = _spClickStart - _spLoopStart;
          const _spClickMs  = _spTransStart - _spClickStart;
          const _spTransMs  = Date.now() - _spTransStart;
          log("TIMING", `Child Locate = ${_spLocateMs}ms`);
          log("TIMING", `Child Click = ${_spClickMs}ms`);
          log("TIMING", `Child Transition = ${_spTransMs}ms`);
          perf.recordLocateBreakdown('search', _spLocateMs);
          perf.record(perf.PHASES.CHILD_LOCATE,     _spLocateMs);
          perf.record(perf.PHASES.CHILD_CLICK,      _spClickMs);
          perf.record(perf.PHASES.CHILD_TRANSITION, _spTransMs);
          POSPage.lastSelectedChild = childName;
          childSelected = true;
          break;
        }
        
        log("POS_WARNING", `Child selection click did not register. Search overlay is still open. Retrying...`);

        const direction = attempt % 2 === 0 ? 'down' : 'up';
        log("POS", `Swiping child list ${direction} to locate/select target child...`);
        await this.swipeChildList(driver, direction, 0.75);
        await driver.pause(150);
      } catch (err) {
        log("POS_WARNING", `Attempt ${attempt} to select child failed: ${err.message}`);

        try {
          const direction = attempt % 2 === 0 ? 'down' : 'up';
          log("POS", `Fallback swipe ${direction} on child list after failure...`);
          await this.swipeChildList(driver, direction, 0.75);
        } catch (swipeErr) {
          log("POS_WARNING", `Fallback child-list swipe failed: ${swipeErr.message}`);
        }

        await driver.pause(150);
      }
    }

    if (!childSelected) {
      throw new Error(`Failed to select child "${childName}" after retries`);
    }
    _state.childListLoaded = true;
  }

  static async selectProduct(driver, productName) {
    log("POS", `Searching and selecting product: "${productName}"...`);
    let productEl = null;

    // Fast path: product is usually already visible right after child selection.
    const exactSelector = `android=new UiSelector().text("${productName}")`;
    const containsSelector = `android=new UiSelector().textContains("${productName}")`;
    for (let i = 0; i < 8; i++) {
      try {
        const exactMatches = await driver.$$(exactSelector);
        if (exactMatches.length > 0 && await exactMatches[0].isDisplayed()) {
          productEl = exactMatches[0];
          break;
        }
      } catch (e) {}

      try {
        const containsMatches = await driver.$$(containsSelector);
        if (containsMatches.length > 0 && await containsMatches[0].isDisplayed()) {
          productEl = containsMatches[0];
          break;
        }
      } catch (e) {}

      await driver.pause(40);
    }

    // Fallback path: use robust finder with scrolling only when fast path does not find product.
    if (!productEl) {
      productEl = await BasePage.findElementContainsFast(driver, productName);
    }

    await BasePage.safeClick(driver, productEl);

    // Fast-path wait: product selection is usually immediate, so poll quickly for wallet readiness.
    const walletBtn = await driver.$(`android=new UiSelector().text("${locators.selectWalletButton}")`);
    await walletBtn.waitForDisplayed({ timeout: 15000, interval: 75 });
    await driver.waitUntil(
      async () => await walletBtn.isEnabled(),
      {
        timeout: 15000,
        interval: 60,
        timeoutMsg: 'Expected Select Wallet button to become enabled after product selection'
      }
    );
  }

  /**
   * Adds one or more products to the cart with configurable quantities.
   * Accepts normalized format: [{ name: string, qty: number }]
   *
   * Config options supported (resolved by buildCartItems in test.js):
   *   - Legacy:       "productName": "Meal 1,Meal 2"  → single random product, qty 1
   *   - Option B:     "products": [{ name, qty }]      → single random product, with qty
   *   - Option C:     "cartProducts": [{ name, qty }]  → all products, in order
   */
  static async addProductsToCart(driver, cartItems) {
    const executionMode = process.env.EXECUTION_MODE || config.executionMode || 'standard';
    const isRapid = executionMode === 'rapid';

    if (isRapid) {
      // Clear product cache at the beginning of each cycle's cart build to avoid stale element references from previous cycles
      POSPage._productCache.clear();
    }

    const baseDelayBetweenQty = isRapid
      ? (config.rapidDelayBetweenQuantityClicksMs !== undefined ? config.rapidDelayBetweenQuantityClicksMs : 200)
      : (config.delayBetweenQuantityClicksMs !== undefined ? config.delayBetweenQuantityClicksMs : 1000);
    const hasQtyGreaterThanOne = Array.isArray(cartItems) && cartItems.some((item) => Number(item.qty) > 1);
    let delayBetweenQty = baseDelayBetweenQty;

    if (!isRapid && hasQtyGreaterThanOne) {
      const profile = Array.isArray(config.quantityDelayProfileMs)
        ? config.quantityDelayProfileMs.filter((v) => Number.isFinite(Number(v)) && Number(v) >= 0).map((v) => Number(v))
        : [];
      if (profile.length > 0) {
        const requestedStep = Number(config.quantityDelayProfileStep || 0);
        const boundedStep = Number.isFinite(requestedStep)
          ? Math.max(0, Math.min(profile.length - 1, Math.floor(requestedStep)))
          : 0;
        delayBetweenQty = profile[boundedStep];
      }
    }

    // Cart-build sub-phase instrumentation (timing only; no behavior changes)
    let _productLocateMs = 0;
    let _productClickMs = 0;
    let _cartRefreshMs = 0;

    // Log full cart before starting execution
    log("CART", `Executing cart (${cartItems.length} product${cartItems.length !== 1 ? 's' : ''}):`);
    log("CART", `Quantity click delay profile: ${hasQtyGreaterThanOne ? `qty>1 tuned (${delayBetweenQty}ms)` : `default (${delayBetweenQty}ms)`}`);
    for (const item of cartItems) {
      log("CART", `  ${item.name} x${item.qty}`);
    }

    for (let itemIdx = 0; itemIdx < cartItems.length; itemIdx++) {
      const { name, qty } = cartItems[itemIdx];
      const isLastItem = itemIdx === cartItems.length - 1;
      log("PRODUCT", `Adding "${name}" qty ${qty}`);

      for (let click = 1; click <= qty; click++) {
        log("PRODUCT", `"${name}" click ${click}/${qty}`);

        let productEl = null;
        const exactSelector    = `android=new UiSelector().text("${name}")`;
        const containsSelector = `android=new UiSelector().textContains("${name}")`;
        const isFirstClick     = click === 1;
        const _locateStart = Date.now();

        // ── CACHE PROBE (RAPID MODE) ──────────────────────────────────────────
        let fastHit = false;
        if (isRapid) {
          const cachedEl = POSPage._productCache.get(name);
          if (cachedEl) {
            // Since the cache is cleared at the start of addProductsToCart, any hit here
            // is guaranteed to be from the current transaction context. We bypass isDisplayed()
            // to save a costly Appium round-trip (retries/healing handled in catch block below).
            productEl = cachedEl;
            fastHit = true;
            if (isFirstClick) {
              perf.recordFastpath('product', true);
            }
          }
        }

        if (!productEl) {
          // ── FAST PATH ──────────────────────────────────────────────────────────
          // Single immediate probe — no retries, no scroll.
          // Attempted on every click (product button stays in same position for qty > 1).
          try {
            const exactEl = await driver.$(exactSelector);
            if (await exactEl.isDisplayed().catch(() => false)) {
              productEl = exactEl;
              fastHit = true;
            } else {
              // Try contains match as secondary single probe
              const containsEl = await driver.$(containsSelector);
              if (await containsEl.isDisplayed().catch(() => false)) {
                productEl = containsEl;
                fastHit = true;
              }
            }
          } catch (e) {}

          if (isFirstClick) {
            if (fastHit) {
              log("FASTPATH", `Product visible, skipping search`);
              perf.recordFastpath('product', true);
            } else {
              log("SEARCH", `Product not visible, using search`);
              perf.recordFastpath('product', false);
            }
          }

          // ── SEARCH FALLBACK ────────────────────────────────────────────────────
          // Only invoked when the direct probe missed. Polls with brief waits, then
          // falls back to scroll-based robust search — identical to original logic.
          if (!productEl) {
            for (let i = 0; i < 7; i++) {  // 7 more iterations (was 8 total, 1 already tried above)
              try {
                const exactEl = await driver.$(exactSelector);
                if (await exactEl.isDisplayed()) {
                  productEl = exactEl;
                  break;
                }
              } catch (e) {}

              try {
                const containsEl = await driver.$(containsSelector);
                if (await containsEl.isDisplayed()) {
                  productEl = containsEl;
                  break;
                }
              } catch (e) {}

              await driver.pause(40);
            }

            // Full scroll-based search if still not found
            if (!productEl) {
              productEl = await BasePage.findElementContainsFast(driver, name);
            }
          }

          // Cache the found element in rapid mode
          if (isRapid && productEl) {
            POSPage._productCache.set(name, productEl);
          }
        }

        _productLocateMs += (Date.now() - _locateStart);

        try {
          const _clickStart = Date.now();
          await BasePage.safeClick(driver, productEl);
          _productClickMs += (Date.now() - _clickStart);
        } catch (clickErr) {
          log("PRODUCT_WARNING", `Click ${click}/${qty} on "${name}" failed: ${clickErr.message}. Re-locating and retrying...`);
          if (isRapid) {
            POSPage._productCache.delete(name);
          }
          productEl = await BasePage.findElementContainsFast(driver, name);
          try {
            const _retryClickStart = Date.now();
            await BasePage.safeClick(driver, productEl);
            _productClickMs += (Date.now() - _retryClickStart);
            if (isRapid) {
              POSPage._productCache.set(name, productEl);
            }
          } catch (retryErr) {
            await BasePage.saveFailureScreenshot(driver, `product_click_fail_${name.replace(/\s+/g, '_')}_${click}`);
            throw new Error(`Failed to click product "${name}" (click ${click}/${qty}): ${retryErr.message}`);
          }
        }

        // Stabilization pause after every click EXCEPT the very last click of the very last product.
        // This ensures MAUI processes qty increments AND cart sync between different products.
        const isLastClickOfLastItem = isLastItem && click === qty;
        if (!isLastClickOfLastItem) {
          const _refreshStart = Date.now();
          await driver.pause(delayBetweenQty);
          _cartRefreshMs += (Date.now() - _refreshStart);
        }
      }
    }

    // After all products added: wait for wallet button to become enabled.
    // Fail fast if UiAutomator2 instrumentation/session crashes.
    const _walletReadyStart = Date.now();
    await this._waitWalletEnabled(driver, 15000, 30);
    const _walletReadyMs = Date.now() - _walletReadyStart;

    log("TIMING", `Product Locate = ${_productLocateMs}ms`);
    log("TIMING", `Product Click = ${_productClickMs}ms`);
    log("TIMING", `Cart Refresh = ${_cartRefreshMs}ms`);
    log("TIMING", `Wallet Ready = ${_walletReadyMs}ms`);

    perf.record(perf.PHASES.PRODUCT_LOCATE, _productLocateMs);
    perf.record(perf.PHASES.PRODUCT_CLICK, _productClickMs);
    perf.record(perf.PHASES.CART_REFRESH, _cartRefreshMs);
    perf.record(perf.PHASES.WALLET_READY, _walletReadyMs);

    _state.menuLoaded = true;
  }

  static async clickSelectWallet(driver) {
    log("POS", "Clicking 'Select Wallet'...");
    // Use $$ for the initial probe so a crash here is caught as INSTRUMENTATION_CRASH_DETECTED
    // rather than a raw WebDriverError (driver.$() throws on dead sessions).
    const selector = `android=new UiSelector().text("${locators.selectWalletButton}")`;
    let selectWalletButton;
    try {
      const matches = await driver.$$(selector);
      if (matches.length > 0) {
        const enabled = await matches[0].isEnabled();
        if (enabled) {
          selectWalletButton = matches[0];
        }
      }
    } catch (err) {
      if (POSPage._isFatalDriverError(err)) {
        throw new Error(`INSTRUMENTATION_CRASH_DETECTED: ${err.message}`);
      }
      throw err;
    }

    if (selectWalletButton) {
      await BasePage.safeClick(driver, selectWalletButton, 1);
    } else {
      // Guarded wait for laggy recalculation cases.
      // Uses fail-fast crash detection to avoid repeated isEnabled spam when UiAutomator2 dies.
      selectWalletButton = await this._waitWalletEnabled(driver, 3500, 30);
      await BasePage.safeClick(driver, selectWalletButton, 1);
    }

    // Fast-path wait for Pay button — poll via findElements to avoid stale-element risk.
    const paySelector = `android=new UiSelector().text("${locators.payButton}")`;
    const executionMode = process.env.EXECUTION_MODE || config.executionMode || 'standard';
    const isRapid = executionMode === 'rapid';
    await driver.waitUntil(
      async () => await driver.$(paySelector).isDisplayed().catch(() => false),
      {
        timeout: 30000,
        interval: isRapid ? 100 : 50,
        timeoutMsg: 'Pay button did not appear within 30s after wallet selection'
      }
    );
  }
}

module.exports = POSPage;
