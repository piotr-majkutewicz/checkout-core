/**
 * Money formatting rule for the demo UI. The currency is always PLN; only the conventions change.
 *   pl: 1 234,56 zł   (non-breaking space as thousands separator, decimal comma, "zł" after)
 *   en: PLN 1,234.56  (comma thousands separator, decimal point, "PLN" before)
 * The function is shipped to the browser as source text so that the tests and the page run the
 * very same code. It takes integer grosze and a format object (see MONEY_FORMATS).
 */
export interface MoneyFormat {
  group: string;
  decimal: string;
  prefix: string;
  suffix: string;
}

export const MONEY_FORMATS: Record<"pl" | "en", MoneyFormat> = {
  pl: { group: " ", decimal: ",", prefix: "", suffix: " zł" },
  en: { group: ",", decimal: ".", prefix: "PLN ", suffix: "" },
};

export const FORMAT_MONEY_SOURCE = `function formatMoney(grosze, f) {
  var neg = grosze < 0;
  var g = Math.abs(grosze);
  var whole = String(Math.floor(g / 100)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, f.group);
  var frac = String(g % 100);
  if (frac.length < 2) frac = "0" + frac;
  return (neg ? "-" : "") + f.prefix + whole + f.decimal + frac + f.suffix;
}`;
