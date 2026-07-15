'use strict';

const BasePage = require('../../../pages/BasePage');
const POSPage = require('../../../pages/POSPage');
const { assertCondition } = require('../assertions/assertions');

module.exports = {
  id: 'FR-002',
  title: 'POS Navigation and Child Selection',
  expectedResult: 'POS ordering flow opens, configured child is selected, and expected product/menu state is reached.',
  async run(ctx) {
    await ctx.ensureAtChildSelection(ctx.driver);

    const childName = ctx.getConfiguredChild();
    const productName = ctx.getConfiguredProduct();

    await POSPage.selectChild(ctx.driver, childName);

    const overlayStillOpen = await POSPage.isSearchChildDisplayed(ctx.driver);
    assertCondition(!overlayStillOpen, 'Child selection overlay is still open after selection', 'Search child overlay closes', 'Search child overlay remained visible');

    const productEl = await BasePage.findElementContainsFast(ctx.driver, productName);
    const productVisible = await productEl.isDisplayed().catch(() => false);
    assertCondition(productVisible, 'Expected product state is not visible after child selection', `Configured product ${productName} visible`, `Configured product ${productName} not visible`);

    return {
      actualResult: `Navigated to POS flow, selected child ${childName}, and verified configured product/menu state with product ${productName}.`,
    };
  },
};
