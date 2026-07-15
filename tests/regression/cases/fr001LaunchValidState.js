'use strict';

const { assertCondition } = require('../assertions/assertions');

module.exports = {
  id: 'FR-001',
  title: 'Application Launch and Valid State',
  expectedResult: 'Application launches successfully, session is healthy, and a valid known state is detected without blocking popup lock.',
  async run(ctx) {
    await ctx.launchOrActivateApp(ctx.driver, ctx.targetUdid);

    const state = await ctx.waitForKnownState(ctx.driver, (ctx.config.functionalRegression && ctx.config.functionalRegression.stateDetectTimeoutMs) || 30000);
    assertCondition(state !== 'unknown', 'Application remained in an unknown state', 'Known state A-H detected', `Detected state: ${state}`);

    await ctx.ensureSessionHealthy(ctx.driver);

    return {
      actualResult: `Application reached known state ${state} and Appium session remained healthy.`,
    };
  },
};
