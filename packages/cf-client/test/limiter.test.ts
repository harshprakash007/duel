import { describe, expect, it } from 'vitest';
import { PriorityTokenBucket } from '../src/limiter';

describe('PriorityTokenBucket', () => {
  it('drains strictly by priority lane (high > normal > low)', async () => {
    // maxRps very small so items must queue up
    const limiter = new PriorityTokenBucket({ maxRps: 100 });

    // Exhaust initial token
    await limiter.acquire('normal');

    const executionOrder: string[] = [];

    // Enqueue in reverse order: low, normal, high
    const pLow = limiter.acquire('low').then(() => executionOrder.push('low'));
    const pNormal = limiter.acquire('normal').then(() => executionOrder.push('normal'));
    const pHigh = limiter.acquire('high').then(() => executionOrder.push('high'));

    await Promise.all([pLow, pNormal, pHigh]);

    expect(executionOrder).toEqual(['high', 'normal', 'low']);
    limiter.destroy();
  });

  it('aging guard promotes starved requests', async () => {
    // 50ms aging guard
    const limiter = new PriorityTokenBucket({ maxRps: 50, agingMs: 30 });
    await limiter.acquire('normal');

    const executionOrder: string[] = [];
    const pLow = limiter.acquire('low').then(() => executionOrder.push('low'));

    // Wait until low request has aged past agingMs
    await new Promise((r) => setTimeout(r, 40));

    // Now enqueue a high priority request
    const pHigh = limiter.acquire('high').then(() => executionOrder.push('high'));

    await Promise.all([pLow, pHigh]);

    // Low should have been picked first due to aging guard
    expect(executionOrder).toEqual(['low', 'high']);
    limiter.destroy();
  });

  it('notifies queue depth changes', async () => {
    const depths: Array<{ lane: string; depth: number }> = [];
    const limiter = new PriorityTokenBucket({
      maxRps: 10,
      onQueueDepthChange: (lane, depth) => {
        depths.push({ lane, depth });
      },
    });

    await limiter.acquire('normal'); // consumes immediate token
    const p1 = limiter.acquire('high'); // queues up
    expect(limiter.getQueueDepth('high')).toBe(1);

    await p1;
    expect(limiter.getQueueDepth('high')).toBe(0);

    limiter.destroy();
  });
});
