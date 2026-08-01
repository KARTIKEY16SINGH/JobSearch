import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface GoogleSheetsConfig {
  enabled: boolean;
  sheetUrl: string;
  sheetTab: string | null;
  startCell: string;
}

export interface AppConfig {
  headless: boolean;
  userDataDir: string;
  defaultTimeoutMs: number;
  googleSheets: GoogleSheetsConfig;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Loads and validates configuration once, at startup. Every module that
 * needs config gets it passed in explicitly (no hidden global reads
 * scattered through the codebase) — see `src/index.ts`.
 */
export function loadConfig(): AppConfig {
  const sheetUrl = process.env.GOOGLE_SHEET_URL?.trim() ?? "";

  return {
    headless: parseBoolean(process.env.HEADLESS, true),
    userDataDir: path.resolve(process.cwd(), process.env.USER_DATA_DIR ?? "./.browser-profile"),
    defaultTimeoutMs: parseNumber(process.env.DEFAULT_TIMEOUT_MS, 30_000),
    googleSheets: {
      enabled: sheetUrl.length > 0,
      sheetUrl,
      sheetTab: process.env.GOOGLE_SHEET_TAB?.trim() || null,
      startCell: process.env.GOOGLE_SHEET_START_CELL?.trim() || "A1",
    },
  };
}
