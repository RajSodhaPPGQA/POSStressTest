'use strict';

const POSPage = require('../../../pages/POSPage');
const CheckoutPage = require('../../../pages/CheckoutPage');
const { assertCondition } = require('../assertions/assertions');

module.exports = {
  id: 'FR-003',
  title: 'Basic Order Using Default Wallet',
  expectedResult: 'Configured child and product are used, checkout is available, payment succeeds, and app reaches a valid post-order state.',
  async run(ctx) {
    await ctx.ensureAtChildSelection(ctx.driver);

    const childName = ctx.getConfiguredChild();
    const productName = ctx.getConfiguredProduct();

    await POSPage.selectChild(ctx.driver, childName);
    await POSPage.addProductsToCart(ctx.driver, [{ name: productName, qty: 1 }]);

    const walletReady = await POSPage.isProductPageWithSelectedProduct(ctx.driver);
    assertCondition(walletReady, 'Checkout is not available after adding configured product', 'Select Wallet visible and enabled', 'Select Wallet not ready');

    await POSPage.clickSelectWallet(ctx.driver);
    await CheckoutPage.clickPay(ctx.driver);

    const postState = await ctx.waitForKnownState(ctx.driver, (ctx.config.functionalRegression && ctx.config.functionalRegression.stateDetectTimeoutMs) || 30000);
    assertCondition(postState !== 'unknown', 'Post-order state is unknown', 'Known post-order state', `Detected state: ${postState}`);

    return {
      actualResult: `Order completed using default wallet for child ${childName} and product ${productName}. Post-order state detected: ${postState}.`,
    };
  },
};
