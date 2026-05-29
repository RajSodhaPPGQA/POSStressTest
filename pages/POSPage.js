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

    while ((Date.now() - start) < timeoutMs) {
      try {
        const matches = await driver.$$(selector);
        if (matches.length > 0) {
          const enabled = await matches[0].isEnabled();
          if (enabled) return matches[0];
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
    const menuBtn = await driver.$(`android=new UiSelector().text("${locators.menuOption}")`);
    try {
      return await menuBtn.isExisting() && await menuBtn.isDisplayed();
    } catch (e) {
      return false;
    }
  }

  static async isPOSMainDisplayed(driver) {
    const nameBtn = await driver.$(`android=new UiSelector().text("${locators.nameButton}")`);
    try {
      return await nameBtn.isExisting() && await nameBtn.isDisplayed();
    } catch (e) {
      return false;
    }
  }

  static async isSearchChildDisplayed(driver) {
    const matches = await driver.$$(`android=new UiSelector().text("${locators.closeButton}")`);
    return matches.length > 0 && await matches[0].isDisplayed().catch(() => false);
  }

  static async isProductPageWithSelectedProduct(driver) {
    const selectWalletBtn = await driver.$(`android=new UiSelector().text("${locators.selectWalletButton}")`);
    try {
      return await selectWalletBtn.isExisting() && await selectWalletBtn.isDisplayed() && await selectWalletBtn.isEnabled();
    } catch (e) {
      return false;
    }
  }

  static async clickMenuOption(driver) {
    log("POS_MENU", `Clicking menu option: "${locators.menuOption}"...`);
    const menuBtn = await BasePage.findElementFast(driver, locators.menuOption);
    await BasePage.safeClick(driver, menuBtn);
    
    // Strategic transition monitor for up to 120 seconds to allow slow menu database loading
    const targetSelector = `android=new UiSelector().text("${locators.nameButton}")`;
    const nameBtn = await driver.$(targetSelector);
    
    await BasePage.monitorTransition(driver, async () => {
      return await nameBtn.isExisting() && await nameBtn.isDisplayed();
    }, 120000, 1000);
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
      const closeSelector = `android=new UiSelector().text("${locators.closeButton}")`;
      // Pre-locate: overlay state probe — NOT counted in locate time, but is real overhead
      const _srPreLocateStart = Date.now();
      const closePre = await driver.$$(closeSelector);
      const overlayWasOpen = closePre.length > 0 && await closePre[0].isDisplayed().catch(() => false);
      const _srPreLocateMs = Date.now() - _srPreLocateStart;
      log("CHILD_FASTPATH", `Immediate lookup started | pre_locate_overhead=${_srPreLocateMs}ms (overlay state check — not in locate timer)`);

      // Single non-retrying probe for child on the current screen
      let screenTarget = null;
      const _srLocateStart = Date.now();

      const _t1 = Date.now();
      const srExactMatches = await driver.$$(`android=new UiSelector().text("${childName}")`);
      const _exactQueryMs = Date.now() - _t1;
      const _t2 = Date.now();
      const srExactVisible = srExactMatches.length > 0 && await srExactMatches[0].isDisplayed().catch(() => false);
      const _exactVisMs = Date.now() - _t2;

      if (srExactVisible) {
        screenTarget = srExactMatches[0];
        log("CHILD_FASTPATH", `Element found immediately (exact match) | exact_query=${_exactQueryMs}ms | vis_check=${_exactVisMs}ms`);
      } else {
        const _t3 = Date.now();
        const srContainsMatches = await driver.$$(`android=new UiSelector().textContains("${childName}")`);
        const _containsQueryMs = Date.now() - _t3;
        const _t4 = Date.now();
        const srContainsVisible = srContainsMatches.length > 0 && await srContainsMatches[0].isDisplayed().catch(() => false);
        const _containsVisMs = Date.now() - _t4;
        if (srContainsVisible) {
          screenTarget = srContainsMatches[0];
          log("CHILD_FASTPATH", `Element found immediately (contains match) | exact_query=${_exactQueryMs}ms | exact_vis=${_exactVisMs}ms | contains_query=${_containsQueryMs}ms | contains_vis=${_containsVisMs}ms`);
        } else {
          log("CHILD_FASTPATH", `Element not visible on screen | exact_query=${_exactQueryMs}ms | exact_vis=${_exactVisMs}ms | contains_query=${_containsQueryMs}ms | contains_vis=${_containsVisMs}ms`);
        }
      }
      const _srLocateMs = Date.now() - _srLocateStart;

      if (screenTarget) {
        log("FASTPATH", `Child "${childName}" already visible on screen — clicking directly (skipping Name/search)`);
        const _srClickStart = Date.now();
        await BasePage.safeClick(driver, screenTarget);
        const _srClickMs = Date.now() - _srClickStart;
        const _srTransStart = Date.now();

        // Verify the click produced the expected screen transition
        let srSucceeded = false;
        if (overlayWasOpen) {
          // Overlay scenario: wait for close button to disappear (overlay dismissed)
          await driver.waitUntil(
            async () => {
              const cur = await driver.$$(closeSelector);
              return !(cur.length > 0 && await cur[0].isDisplayed().catch(() => false));
            },
            { timeout: 600, interval: 30 }
          ).catch(() => {});
          const closeAfter = await driver.$$(closeSelector);
          srSucceeded = !(closeAfter.length > 0 && await closeAfter[0].isDisplayed().catch(() => false));
        } else {
          // Main-screen scenario: wait for Name button to disappear (navigated to product page)
          const nameSelector = `android=new UiSelector().text("${locators.nameButton}")`;
          await driver.waitUntil(
            async () => {
              const nameMatches = await driver.$$(nameSelector);
              return !(nameMatches.length > 0 && await nameMatches[0].isDisplayed().catch(() => false));
            },
            { timeout: 1500, interval: 50 }
          ).catch(() => {});
          const nameAfter = await driver.$$(nameSelector);
          srSucceeded = !(nameAfter.length > 0 && await nameAfter[0].isDisplayed().catch(() => false));
        }

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
        const closePre = await driver.$$(closeSelector);
        const overlayAlreadyOpen = closePre.length > 0 && await closePre[0].isDisplayed().catch(() => false);
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
        const fastExactMatches = await driver.$$(`android=new UiSelector().text("${childName}")`);
        const fastExactVisible = fastExactMatches.length > 0 &&
          await fastExactMatches[0].isDisplayed().catch(() => false);
        if (fastExactVisible) {
          fastTarget = fastExactMatches[0];
        } else {
          const fastContainsMatches = await driver.$$(`android=new UiSelector().textContains("${childName}")`);
          const fastContainsVisible = fastContainsMatches.length > 0 &&
            await fastContainsMatches[0].isDisplayed().catch(() => false);
          if (fastContainsVisible) {
            fastTarget = fastContainsMatches[0];
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

          const closeSelector = `android=new UiSelector().text("${locators.closeButton}")`;
          let stillOpenMatches = await driver.$$(closeSelector);
          let stillOpen = stillOpenMatches.length > 0 && await stillOpenMatches[0].isDisplayed().catch(() => false);
          if (stillOpen) {
            await driver.waitUntil(
              async () => {
                const current = await driver.$$(closeSelector);
                return !(current.length > 0 && await current[0].isDisplayed().catch(() => false));
              },
              { timeout: 600, interval: 30 }
            ).catch(() => {});
            stillOpenMatches = await driver.$$(closeSelector);
            stillOpen = stillOpenMatches.length > 0 && await stillOpenMatches[0].isDisplayed().catch(() => false);
          }
          if (!stillOpen) {
            log("POS", `Child "${childName}" selected via direct fast path`);
            const _fpTransMs = Date.now() - _fpTransStart;
            log("TIMING", `Child Locate = ${_fpLocateMs}ms`);
            log("TIMING", `Child Click = ${_fpClickMs}ms`);
            log("TIMING", `Child Transition = ${_fpTransMs}ms`);
            perf.recordLocateBreakdown('immediate', _fpProbeMs);
            perf.record(perf.PHASES.CHILD_LOCATE,     _fpLocateMs);
            perf.record(perf.PHASES.CHILD_CLICK,      _fpClickMs);
            perf.record(perf.PHASES.CHILD_TRANSITION, _fpTransMs);
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
      log("POS", `Selecting child "${childName}" - Attempt ${attempt}/5...`);
      try {
        if (!(await this.isSearchChildDisplayed(driver))) {
          log("POS", "Search Child overlay not visible. Re-opening Name search...");
          await this.clickName(driver);
        }

        let childElement = null;
        const exactMatches = await driver.$$( `android=new UiSelector().text("${childName}")` );
        const exactVisible = exactMatches.length > 0 && await exactMatches[0].isDisplayed().catch(() => false);
        if (exactVisible) {
          childElement = exactMatches[0];
        }

        if (!exactVisible) {
          childElement = await BasePage.findElementContainsFast(driver, childName, 'childList');
        }
        
        // Use safeClick with dual native click & gesture support for bubble-up clicks in RecyclerView
        _spClickStart = Date.now();
        await BasePage.safeClick(driver, childElement);
        _spTransStart = Date.now();
        
        // Adaptive stabilization: return quickly if overlay closes immediately, but allow brief settle window.
        const closeSelector = `android=new UiSelector().text("${locators.closeButton}")`;
        let closeMatches = await driver.$$(closeSelector);
        let stillVisible = closeMatches.length > 0 && await closeMatches[0].isDisplayed().catch(() => false);
        if (stillVisible) {
          await driver.waitUntil(
            async () => {
              const current = await driver.$$(closeSelector);
              return !(current.length > 0 && await current[0].isDisplayed().catch(() => false));
            },
            {
              timeout: 600,
              interval: 30
            }
          ).catch(() => {});
          closeMatches = await driver.$$(closeSelector);
          stillVisible = closeMatches.length > 0 && await closeMatches[0].isDisplayed().catch(() => false);
        }
        
        if (!stillVisible) {
          log("POS", `🎉 Child "${childName}" successfully selected (Search overlay closed)`);
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
    const delayBetweenQty = config.delayBetweenQuantityClicksMs !== undefined
      ? config.delayBetweenQuantityClicksMs
      : 1000;

    // Log full cart before starting execution
    log("CART", `Executing cart (${cartItems.length} product${cartItems.length !== 1 ? 's' : ''}):`);
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

        // ── FAST PATH ──────────────────────────────────────────────────────────
        // Single immediate probe — no retries, no scroll.
        // Attempted on every click (product button stays in same position for qty > 1).
        let fastHit = false;
        try {
          const exactMatches = await driver.$$(exactSelector);
          if (exactMatches.length > 0 && await exactMatches[0].isDisplayed().catch(() => false)) {
            productEl = exactMatches[0];
            fastHit = true;
          } else {
            // Try contains match as secondary single probe
            const containsMatches = await driver.$$(containsSelector);
            if (containsMatches.length > 0 && await containsMatches[0].isDisplayed().catch(() => false)) {
              productEl = containsMatches[0];
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

          // Full scroll-based search if still not found
          if (!productEl) {
            productEl = await BasePage.findElementContainsFast(driver, name);
          }
        }

        try {
          await BasePage.safeClick(driver, productEl);
        } catch (clickErr) {
          log("PRODUCT_WARNING", `Click ${click}/${qty} on "${name}" failed: ${clickErr.message}. Re-locating and retrying...`);
          productEl = await BasePage.findElementContainsFast(driver, name);
          try {
            await BasePage.safeClick(driver, productEl);
          } catch (retryErr) {
            await BasePage.saveFailureScreenshot(driver, `product_click_fail_${name.replace(/\s+/g, '_')}_${click}`);
            throw new Error(`Failed to click product "${name}" (click ${click}/${qty}): ${retryErr.message}`);
          }
        }

        // Stabilization pause after every click EXCEPT the very last click of the very last product.
        // This ensures MAUI processes qty increments AND cart sync between different products.
        const isLastClickOfLastItem = isLastItem && click === qty;
        if (!isLastClickOfLastItem) {
          await driver.pause(delayBetweenQty);
        }
      }
    }

    // After all products added: wait for wallet button to become enabled.
    // Fail fast if UiAutomator2 instrumentation/session crashes.
    await this._waitWalletEnabled(driver, 15000, 30);
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
    const payStart = Date.now();
    let payVisible = false;
    while (!payVisible && (Date.now() - payStart) < 30000) {
      const payMatches = await driver.$$(paySelector);
      payVisible = payMatches.length > 0 && await payMatches[0].isDisplayed().catch(() => false);
      if (!payVisible) await driver.pause(40);
    }
    if (!payVisible) throw new Error('Pay button did not appear within 30s after wallet selection');
  }
}

module.exports = POSPage;
