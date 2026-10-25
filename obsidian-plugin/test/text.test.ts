import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costLine, plainCitations } from '../src/text.ts';

test('citation markers become plain page numbers in UI text', () => {
	assert.equal(plainCitations('softmax is used [@p1].'), 'softmax is used (p. 1).');
	assert.equal(plainCitations('see [@R2; @p3, @p4] here'), 'see (p. 3, 4) here');
	assert.equal(plainCitations('unknown [@?R9] dropped'), 'unknown dropped');
});

test('the cost line says "included in your plan" for subscriptions', () => {
	const base = { provider: 'p', model: 'm', requests: 12, input_tokens: 29_000, output_tokens: 50_000 };
	assert.match(costLine({ ...base, tier: 'subscription', cost_usd: 0, cost_with_cache_usd: null }), /^Included in your plan \(~12 requests/);
	assert.match(costLine({ ...base, tier: 'paid', cost_usd: 1.5, cost_with_cache_usd: 0.6 }), /^Estimated cost: \$0\.60/);
	assert.match(costLine({ ...base, tier: 'paid', cost_usd: null, cost_with_cache_usd: null }), /^Cost unknown/);
	assert.equal(costLine(null), '');
});
