/* Small text helpers for the plugin's UI, kept free of the obsidian module so they are unit-tested. */
import type { Estimate } from './types.ts';

/** `[@p4]` → `(p. 4)`; references and unresolved keys are dropped from plain UI text. */
export function plainCitations(text: string): string {
	return text.replace(/\s*\[@([^\]]+)\]/g, (_m, keys: string) => {
		const pages = keys.split(/[;,]/).map((k) => k.trim().replace(/^@/, '')).filter((k) => /^p\d+$/.test(k)).map((k) => k.slice(1));
		return pages.length ? ` (p. ${pages.join(', ')})` : '';
	});
}

export function costLine(e: Estimate | null): string {
	if (!e) return '';
	const reqs = `~${e.requests} requests, ~${Math.round(e.input_tokens / 1000)}K input and ~${Math.round(e.output_tokens / 1000)}K output tokens`;
	if (e.tier === 'subscription') return `Included in your plan (${reqs}; the plan's usage limits apply).`;
	const v = e.cost_with_cache_usd ?? e.cost_usd;
	if (v === null) return `Cost unknown for this model (${reqs}).`;
	return `Estimated cost: ${v === 0 ? 'free' : v < 0.01 ? '< $0.01' : '$' + v.toFixed(2)} (${reqs}).`;
}
