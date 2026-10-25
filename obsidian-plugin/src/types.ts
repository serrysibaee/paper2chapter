/* The parts of the paper2chapter backend API the plugin uses (see backend/app/main.py). */

export type PaperStatus =
	| 'uploaded' | 'extracting' | 'extracted' | 'analyzing' | 'analyzed' | 'generating' | 'ready' | 'failed';

export type Audience = 'high-school' | 'undergraduate' | 'graduate' | 'practitioner';
export type Effort = 'low' | 'medium' | 'high';

export interface Usage {
	calls: number;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	cost_usd: number | null;
}

export interface JobState {
	kind: 'extract' | 'analyze' | 'generate';
	status: 'running' | 'succeeded' | 'failed';
	stage: string;
	progress: number;
	message: string;
	error: string | null;
}

export interface PaperRecord {
	id: string;
	filename: string;
	status: PaperStatus;
	title: string;
	page_count: number;
	job: JobState | null;
	has_analysis: boolean;
	has_chapter: boolean;
	usage: Usage;
}

export interface Prerequisite {
	id: string;
	name: string;
	why_needed: string;
	level: 'foundational' | 'intermediate' | 'advanced';
}

export interface PaperAnalysis {
	title: string;
	authors: string[];
	year: string | null;
	field: string;
	one_sentence_summary: string;
	difficulty: 'introductory' | 'intermediate' | 'advanced';
	prerequisites: Prerequisite[];
}

export interface ModelOption {
	id: string;
	label: string;
	tier: 'free' | 'free-tier' | 'paid' | 'local' | 'subscription';
	notes: string;
	typical_chapter_cost_usd: number | null;
}

export interface ProviderOption {
	id: string;
	label: string;
	kind: string;
	configured: boolean;
	api_key_env: string | null;
	setup_hint?: string;
	free_note: string;
	models: ModelOption[];
}

export interface Selection {
	provider: string;
	model: string;
	effort: Effort;
}

export interface AppSettings {
	selection: Selection;
	providers: ProviderOption[];
}

export interface ProviderCheck {
	installed: boolean | null;
	version: string | null;
	signed_in: boolean | null;
	message: string;
}

export interface Estimate {
	provider: string;
	model: string;
	tier: string;
	requests: number;
	input_tokens: number;
	output_tokens: number;
	cost_usd: number | null;
	cost_with_cache_usd: number | null;
}

export interface GenerationOptions {
	audience: Audience;
	known_prerequisites: string[];
	focus: string;
	include_python: boolean;
}

export interface MarkdownExport {
	markdown: string;
	assets: string[];
	title: string;
	filename: string;
}
