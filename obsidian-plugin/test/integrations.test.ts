/* Other plugins: detected, recommended when missing, and used only through what they publish. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	INTEGRATIONS, getItUrl, integrationState, kosApi, kosBlock, nrBlock, nrMissing, nrSettings, withBlocks, type PluginLookup,
} from '../src/integrations.ts';

const lookup = (plugins: Record<string, { enabled?: boolean; instance?: unknown }>): PluginLookup => (id) => {
	const p = plugins[id];
	return p ? { installed: true, enabled: p.enabled ?? true, instance: p.instance } : { installed: false, enabled: false };
};

test('each integration names its plugin, what it adds, and is said the same way whoever wrote it', () => {
	for (const key of ['knowledgeOs', 'noteRelatives', 'dataview', 'templater', 'spacedRepetition'] as const) {
		const spec = INTEGRATIONS[key];
		assert.ok(spec.id && spec.name && spec.adds.length > 20 && spec.page.startsWith('https://'), key);
	}
	assert.match(INTEGRATIONS.knowledgeOs.needs ?? '', /desktop/i);
});

test('Get it: the community page when listed, else BRAT when it is installed, else the project page', () => {
	const none = lookup({});
	assert.equal(getItUrl(INTEGRATIONS.dataview, none), 'obsidian://show-plugin?id=dataview');
	assert.equal(getItUrl(INTEGRATIONS.knowledgeOs, none), 'https://github.com/asmbatati/knowledge-os');
	const brat = lookup({ 'obsidian42-brat': {} });
	assert.equal(getItUrl(INTEGRATIONS.knowledgeOs, brat), 'obsidian://brat?plugin=asmbatati/knowledge-os');
	assert.equal(getItUrl(INTEGRATIONS.noteRelatives, brat), 'obsidian://brat?plugin=asmbatati/note-relatives');
	assert.equal(getItUrl(INTEGRATIONS.templater, brat), 'obsidian://show-plugin?id=templater-obsidian', 'listed: its page, not BRAT');
});

test('the state a row shows: on, installed but off, not installed, and the Knowledge OS without its API', () => {
	assert.equal(integrationState(INTEGRATIONS.dataview, lookup({ dataview: {} })).kind, 'ready');
	// said of the plugin, not of this row's switch: "is on" read as the switch beside it
	assert.equal(integrationState(INTEGRATIONS.dataview, lookup({ dataview: {} })).text, 'Dataview is installed and enabled.');
	assert.equal(integrationState(INTEGRATIONS.dataview, lookup({ dataview: { enabled: false } })).kind, 'disabled');
	assert.equal(integrationState(INTEGRATIONS.dataview, lookup({})).kind, 'missing');
	const old = integrationState(INTEGRATIONS.knowledgeOs, lookup({ 'knowledge-os': { instance: {} } }));
	assert.equal(old.kind, 'outdated');
	assert.match(old.text, /1\.1/);
	const api = { version: 1, status: async () => ({}) };
	assert.equal(integrationState(INTEGRATIONS.knowledgeOs, lookup({ 'knowledge-os': { instance: { api } } })).kind, 'ready');
});

test('the Knowledge OS is used only through its published API, version 1 or later', () => {
	const status = async () => ({});
	assert.equal(kosApi(lookup({})), null);
	assert.equal(kosApi(lookup({ 'knowledge-os': { instance: { api: { version: 0, status } } } })), null);
	assert.equal(kosApi(lookup({ 'knowledge-os': { enabled: false, instance: { api: { version: 1, status } } } })), null, 'turned off');
	assert.equal(kosApi(lookup({ 'knowledge-os': { instance: { api: { version: 1 } } } })), null, 'no status()');
	assert.ok(kosApi(lookup({ 'knowledge-os': { instance: { api: { version: 2, status } } } })));
});

test('the live progress block names the two properties it draws from', () => {
	assert.equal(kosBlock('teaches', 'assumes'), '```knowledge-os\nprogress\nteaches: teaches\nassumes: assumes\n```');
});

test('Note Relatives: its block name, and the chapter properties it draws no row for', () => {
	const nr = nrSettings(lookup({ 'note-relatives': { instance: { settings: {
		blockName: 'nav', parentKey: 'up', forward: [{ key: 'requires' }], inverse: [{ key: 'requires' }, { key: 'teaches' }],
	} } } }));
	assert.ok(nr);
	assert.equal(nrBlock(nr), '```nav\n```');
	assert.deepEqual(nrMissing(nr, ['teaches', 'assumes', 'up', 'paper']), ['assumes', 'paper']);
	assert.equal(nrSettings(lookup({})), null);
	assert.equal(nrBlock(nrSettings(lookup({ 'note-relatives': { instance: { settings: { blockName: 'relatives' } } } }))!), '```relatives\n```');
	assert.equal(nrBlock(nrSettings(lookup({ 'note-relatives': { instance: { settings: {} } } }))!), '```nav\n```', "Note Relatives' own default");
});

test('blocks go right after the frontmatter, once', () => {
	const note = '---\ntitle: "x"\n---\n\n# X\n\nBody\n';
	assert.equal(withBlocks(note, ['```nav\n```', '```knowledge-os\nprogress\n```']), '---\ntitle: "x"\n---\n```nav\n```\n\n```knowledge-os\nprogress\n```\n\n# X\n\nBody\n');
	assert.equal(withBlocks('# X\n', ['```nav\n```']), '```nav\n```\n\n# X\n');
	const has = '---\na: 1\n---\n```nav\n```\n\n# X\n';
	assert.equal(withBlocks(has, ['```nav\n```']), has, 'a template that has the block keeps one');
	assert.equal(withBlocks(note, []), note);
});
