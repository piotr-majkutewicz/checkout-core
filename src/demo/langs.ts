import { type Dict, en } from "../i18n/en.js";
import { pl } from "../i18n/pl.js";

export type Lang = "pl" | "en";
export const DEFAULT_LANG: Lang = "pl";
export const DICTIONARIES: Record<Lang, Dict> = { pl, en };

export function parseLang(value: string | null | undefined): Lang | undefined {
  return value === "pl" || value === "en" ? value : undefined;
}

