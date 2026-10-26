/* Just enough of the `obsidian` module to load the bundled plugin in Node and see what it registers. */

export class TFile {
	path: string;
	name: string;
	extension: string;
	stat = { size: 10, mtime: 1 };
	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() ?? path;
		this.extension = this.name.split('.').pop() ?? '';
	}
}

const chain = (): unknown => {
	const p: unknown = new Proxy(() => p, { get: (_t, k) => (k === 'then' ? undefined : () => p), apply: () => p });
	return p;
};

export class Plugin {
	app: unknown;
	manifest: unknown;
	commands: { id: string; name: string }[] = [];
	ribbons: string[] = [];
	tabs: unknown[] = [];
	events: unknown[] = [];
	data: unknown = null;
	constructor(app: unknown, manifest: unknown) {
		this.app = app;
		this.manifest = manifest;
	}
	addCommand(c: { id: string; name: string }) { this.commands.push(c); return c; }
	addRibbonIcon(_icon: string, title: string) { this.ribbons.push(title); return chain(); }
	addSettingTab(t: unknown) { this.tabs.push(t); }
	addStatusBarItem() { return { hide() {}, show() {}, setText() {} }; }
	registerEvent(e: unknown) { this.events.push(e); }
	async loadData() { return this.data; }
	async saveData(d: unknown) { this.data = d; }
}

export class PluginSettingTab {
	containerEl = chain();
	app: unknown;
	plugin: unknown;
	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}
}
export class Modal {
	contentEl = chain();
	app: unknown;
	constructor(app: unknown) {
		this.app = app;
	}
	open() {}
	close() {}
}
export class FuzzySuggestModal<T> extends Modal {
	setPlaceholder(_t: string) {}
	declare _t?: T;
}
export class Setting {
	constructor(_el: unknown) { return chain() as Setting; }
}
export const notices: string[] = [];
export class Notice {
	constructor(msg: string) { notices.push(msg); }
}
export const Platform = { isDesktopApp: false, isWin: false, isMacOS: false };
export const normalizePath = (p: string) => p;
export const requestUrl = async () => { throw new Error('no network in tests'); };
export class SuggestModal<T> extends Modal {
	setPlaceholder(_t: string) {}
	onNoSuggestion() {}
	declare _t?: T;
}
export class Component {
	load() {}
	unload() {}
}
export const MarkdownRenderer = { render: async () => {} };
export const moment = () => ({ format: (f: string) => f });
