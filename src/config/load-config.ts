import path from "node:path";
import { appConfig } from "./app.config";
import { glocalAiConstants } from "./secrets.local";

export interface GoogleSheetsConfig {
	enabled: boolean;
	sheetUrl: string;
	sheetTab: string | null;
	startCell: string;
}

export interface CsvConfig {
	filePath: string;
}

export type AiProviderName = "none" | "openai" | "gemini";

export interface AiConfig {
	provider: AiProviderName;
	openaiApiKey: string;
	openaiModel: string;
	geminiApiKey: string;
	geminiModel: string;
}

export interface AppConfig {
	headless: boolean;
	userDataDir: string;
	defaultTimeoutMs: number;
	appleLocale: string;
	googleSheets: GoogleSheetsConfig;
	csv: CsvConfig;
	ai: AiConfig;
}

/**
 * Resolves `app.config.ts` (+ `secrets.local.ts` for API keys) into the
 * shape the rest of the app uses (e.g. turns a relative `userDataDir`
 * into an absolute path, and an empty `sheetUrl` into
 * `googleSheets.enabled: false`). All actual values come from those two
 * files — edit them directly, nothing here needs changing when you just
 * want to tweak a setting.
 */
export function loadConfig(): AppConfig {
	const sheetUrl = appConfig.googleSheets.sheetUrl.trim();

	return {
		headless: appConfig.headless,
		userDataDir: path.resolve(process.cwd(), appConfig.userDataDir),
		defaultTimeoutMs: appConfig.defaultTimeoutMs,
		appleLocale: appConfig.apple.locale,
		googleSheets: {
			enabled: sheetUrl.length > 0,
			sheetUrl,
			sheetTab: appConfig.googleSheets.sheetTab.trim() || null,
			startCell: appConfig.googleSheets.startCell.trim() || "A1",
		},
		csv: {
			filePath: path.resolve(process.cwd(), appConfig.csv.filePath),
		},
		ai: {
			provider: appConfig.ai.provider as AiProviderName,
			openaiApiKey: glocalAiConstants.openaiApiKey?.trim() ?? "",
			openaiModel: appConfig.ai.openai.model,
			geminiApiKey: glocalAiConstants.geminiApiKey?.trim() ?? "",
			geminiModel: appConfig.ai.gemini.model,
		},
	};
}
