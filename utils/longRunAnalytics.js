'use strict';

const { log } = require('./logger');
const config = require('../config.json');

function avg(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function linearSlope(points) {
  if (!points || points.length < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }

  const n = points.length;
  const denom = (n * sumXX) - (sumX * sumX);
  if (denom === 0) return 0;
  return ((n * sumXY) - (sumX * sumY)) / denom;
}

function assessMemoryHealth(memoryLeak, slowdown, stability, configOverride) {
  const cfg = configOverride || config;
  const t = (cfg && cfg.memoryHealthThresholds) || {
    healthySlopeMax: 0.25,
    growthSlopeMax: 0.75,
    retentionSlopeMin: 0.75,
    highRiskSlopeMin: 1.5,
    slowdownWarningPct: 10,
    slowdownHighRiskPct: 20
  };

  const slope = memoryLeak.slopeMbPerCycle || 0;
  const netIncrease = memoryLeak.netIncreaseMb || 0;
  const slowdownPct = slowdown.slowdownPercent || 0;
  const slowdownDetected = slowdown.detected || false;

  const failures = stability ? ((stability.cyclesFailed || 0) + (stability.fatalFailures || 0)) : 0;
  const recoveries = stability ? (stability.recoveredFailures || 0) : 0;
  const restarts = stability ? (stability.appRestarts || 0) : 0;

  // 1. High Risk of Memory Leak
  if (slope > t.highRiskSlopeMin && 
      (slowdownPct > t.slowdownHighRiskPct || restarts > 0 || recoveries > 0 || failures > 0)) {
    return {
      status: 'High Risk of Memory Leak',
      statusClass: 'fail',
      risk: 'High',
      riskClass: 'fail',
      trend: slope > 0 ? 'Increasing' : 'Stable',
      recommendation: 'Detailed heap dump analysis is strongly recommended.',
      verdictText: 'Significant memory growth combined with performance degradation and instability detected. Detailed heap dump analysis is strongly recommended.'
    };
  }

  // 2. Potential Memory Retention
  if (slope > t.retentionSlopeMin && 
      (slowdownDetected || slowdownPct > t.slowdownWarningPct || recoveries > 0 || restarts > 0)) {
    return {
      status: 'Potential Memory Retention',
      statusClass: 'recovery',
      risk: 'Medium',
      riskClass: 'recovery',
      trend: slope > 0 ? 'Increasing' : 'Stable',
      recommendation: 'Heap analysis is recommended.',
      verdictText: 'Memory growth exceeded expected thresholds. Performance degradation or recovery activity detected. Heap analysis is recommended.'
    };
  }

  // 3. Memory Growth Observed
  if (slope >= t.healthySlopeMax) {
    return {
      status: 'Memory Growth Observed',
      statusClass: 'recovery',
      risk: 'Low',
      riskClass: 'pass',
      trend: slope > 0 ? 'Increasing' : 'Stable',
      recommendation: 'Additional endurance testing is recommended.',
      verdictText: `Sustained memory growth observed across sampled cycles. Average growth rate: ${slope.toFixed(3)} MB/cycle. No significant cycle-duration drift detected. No failures or recoveries occurred. Additional endurance testing is recommended.`
    };
  }

  // 4. Healthy
  return {
    status: 'Healthy',
    statusClass: 'pass',
    risk: 'Low',
    riskClass: 'pass',
    trend: slope > 0 ? 'Increasing' : 'Stable',
    recommendation: 'No immediate action needed; continue periodic long-run smokes to confirm trend stability.',
    verdictText: 'Memory usage remained stable during the run. No significant performance degradation detected.'
  };
}

function createLongRunAnalytics() {
  const state = {
    cycleDurations: [],
    memorySamples: [],
    recoveryCycles: new Set(),
  };

  function recordCycleDuration(cycle, durationMs) {
    state.cycleDurations.push({ cycle, durationMs });
  }

  function recordMemory(cycle, memoryMb) {
    if (typeof memoryMb !== 'number' || Number.isNaN(memoryMb)) return;
    state.memorySamples.push({ cycle, memoryMb });
  }

  function recordRecovery(cycle) {
    state.recoveryCycles.add(cycle);
  }

  function detectSlowdown() {
    const n = state.cycleDurations.length;
    if (n < 10) {
      return {
        detected: false,
        reason: 'Insufficient cycle volume for trend detection',
        firstCycleSeconds: n > 0 ? Number((state.cycleDurations[0].durationMs / 1000).toFixed(1)) : 0,
        lastCycleSeconds: n > 0 ? Number((state.cycleDurations[n - 1].durationMs / 1000).toFixed(1)) : 0,
        slowdownPercent: 0,
      };
    }

    const window = Math.max(5, Math.min(25, Math.floor(n * 0.15)));
    const first = state.cycleDurations.slice(0, window).map(v => v.durationMs);
    const last = state.cycleDurations.slice(n - window).map(v => v.durationMs);

    const avgFirst = avg(first);
    const avgLast = avg(last);
    const pct = avgFirst > 0 ? ((avgLast - avgFirst) / avgFirst) * 100 : 0;

    return {
      detected: pct >= 12,
      reason: pct >= 12 ? 'Cycle durations increased over run window' : 'No significant cycle-duration drift detected',
      firstCycleSeconds: Number((state.cycleDurations[0].durationMs / 1000).toFixed(1)),
      lastCycleSeconds: Number((state.cycleDurations[n - 1].durationMs / 1000).toFixed(1)),
      avgFirstWindowMs: Math.round(avgFirst),
      avgLastWindowMs: Math.round(avgLast),
      slowdownPercent: Number(pct.toFixed(1)),
      windowSize: window,
    };
  }

  function detectMemoryLeakIndicators() {
    const samples = state.memorySamples;
    if (samples.length < 5) {
      return {
        detected: false,
        reason: 'Insufficient memory samples for leak analysis',
        slopeMbPerCycle: 0,
        netIncreaseMb: 0,
      };
    }

    const points = samples.map(s => ({ x: s.cycle, y: s.memoryMb }));
    const slope = linearSlope(points);
    const netIncrease = samples[samples.length - 1].memoryMb - samples[0].memoryMb;

    const detected = slope > 0.35 && netIncrease > 40;
    return {
      detected,
      reason: detected ? 'Memory trend increases across sampled cycles' : 'No persistent memory-growth signal detected',
      slopeMbPerCycle: Number(slope.toFixed(3)),
      netIncreaseMb: Number(netIncrease.toFixed(1)),
      firstSampleMb: samples[0].memoryMb,
      lastSampleMb: samples[samples.length - 1].memoryMb,
      sampleCount: samples.length,
    };
  }

  function detectRecoverySpikes() {
    const n = state.cycleDurations.length;
    if (n < 20) {
      return {
        detected: false,
        reason: 'Insufficient cycle history for spike detection',
        totalRecoveries: state.recoveryCycles.size,
        spikeWindows: [],
      };
    }

    const window = Math.max(10, Math.min(30, Math.floor(n * 0.1)));
    const totalRecoveries = state.recoveryCycles.size;
    const baseline = totalRecoveries / n;
    const spikeWindows = [];

    for (let start = 1; start <= (n - window + 1); start++) {
      const end = start + window - 1;
      let count = 0;
      for (const c of state.recoveryCycles) {
        if (c >= start && c <= end) count += 1;
      }
      const localRate = count / window;
      if (count >= 3 && localRate >= baseline * 2.2) {
        spikeWindows.push({ startCycle: start, endCycle: end, recoveries: count, localRate: Number(localRate.toFixed(3)) });
      }
    }

    return {
      detected: spikeWindows.length > 0,
      reason: spikeWindows.length > 0 ? 'Recovery concentration spike observed' : 'Recoveries are evenly distributed',
      totalRecoveries,
      baselineRate: Number(baseline.toFixed(3)),
      spikeWindows,
      windowSize: window,
    };
  }

  function getSummaryData(stabilitySummary = null) {
    const memoryLeak = detectMemoryLeakIndicators();
    const slowdown = detectSlowdown();
    const memHealth = assessMemoryHealth(memoryLeak, slowdown, stabilitySummary);
    return {
      slowdown,
      memoryLeak,
      memoryHealth: memHealth,
      recoverySpikes: detectRecoverySpikes(),
      totalCyclesTracked: state.cycleDurations.length,
      memorySamplesTracked: state.memorySamples.length,
      totalRecoveryCycles: state.recoveryCycles.size,
    };
  }

  function printSummary(stabilitySummary = null) {
    const summary = getSummaryData(stabilitySummary);
    log('LONGRUN', '============================================================');
    log('LONGRUN', '=== LONG RUN ANALYTICS ===');
    log('LONGRUN', `Cycles Tracked: ${summary.totalCyclesTracked}`);
    log('LONGRUN', `Memory Samples: ${summary.memorySamplesTracked}`);
    log('LONGRUN', `Recovery Cycles: ${summary.totalRecoveryCycles}`);
    log('LONGRUN', '');

    const slowdown = summary.slowdown;
    log('LONGRUN', `Slowdown Detected: ${slowdown.detected ? 'YES' : 'NO'}`);
    log('LONGRUN', `Cycle 1 vs Last: ${slowdown.firstCycleSeconds || 0}s -> ${slowdown.lastCycleSeconds || 0}s`);
    if (typeof slowdown.slowdownPercent === 'number') {
      log('LONGRUN', `Slowdown Percent: ${slowdown.slowdownPercent}%`);
    }
    log('LONGRUN', `Slowdown Note: ${slowdown.reason}`);
    log('LONGRUN', '');

    const mem = summary.memoryLeak;
    const memHealth = summary.memoryHealth;
    log('LONGRUN', `Memory Health Status: ${memHealth.status}`);
    log('LONGRUN', `Memory Leak Indicator: ${mem.detected ? 'YES' : 'NO'}`);
    log('LONGRUN', `Memory Net Increase: ${mem.netIncreaseMb || 0} MB`);
    log('LONGRUN', `Memory Slope: ${mem.slopeMbPerCycle || 0} MB/cycle`);
    log('LONGRUN', `Leak Risk: ${memHealth.risk}`);
    log('LONGRUN', `Recommendation: ${memHealth.recommendation}`);
    log('LONGRUN', `Memory Note: ${mem.reason}`);
    log('LONGRUN', '');

    const spikes = summary.recoverySpikes;
    log('LONGRUN', `Recovery Spikes: ${spikes.detected ? 'YES' : 'NO'}`);
    log('LONGRUN', `Recovery Spike Note: ${spikes.reason}`);
    if (spikes.spikeWindows && spikes.spikeWindows.length > 0) {
      for (const w of spikes.spikeWindows.slice(0, 5)) {
        log('LONGRUN', `- Spike Window C${w.startCycle}-C${w.endCycle}: ${w.recoveries} recoveries`);
      }
    }

    log('LONGRUN', '============================================================');
  }

  return {
    recordCycleDuration,
    recordMemory,
    recordRecovery,
    getSummaryData,
    printSummary,
  };
}

module.exports = { createLongRunAnalytics, assessMemoryHealth };
