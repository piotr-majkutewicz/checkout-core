// Static assets of the demo UI, inlined so the Worker needs no asset pipeline and no CDN.
// The client script never uses innerHTML: all dynamic text goes through textContent.
// All user-facing texts come from the dictionaries in src/i18n.

import type { Dict } from "../i18n/en.js";
import { DICTIONARIES, type Lang } from "./langs.js";
export { STYLE_CSS } from "./style.js";
export { APP_JS } from "./client.js";

export { type Lang, DEFAULT_LANG, DICTIONARIES, parseLang } from "./langs.js";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The page shell, rendered in the requested language. The client script keeps it in sync when the language changes. */
export function indexHtml(lang: Lang): string {
  const d = DICTIONARIES[lang];
  const t = (key: keyof Dict) => `data-i18n="${key}"`;
  const btn = (l: Lang, label: string, aria: "langPl" | "langEn") =>
    `<button type="button" data-lang="${l}" lang="${l}" data-i18n-aria="${aria}" aria-label="${esc(d[aria])}" aria-pressed="${l === lang}">${label}</button>`;
  const items = (["intro.item1", "intro.item2", "intro.item3", "intro.item4", "intro.item5"] as const)
    .map((k) => `<li ${t(k)}>${esc(d[k])}</li>`)
    .join("");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(d.htmlTitle)}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="sim" role="note"><div class="wrap"><strong ${t("banner")}>${esc(d.banner)}</strong></div></div>
<header class="top">
  <div class="wrap">
    <h1>checkout-core</h1>
    <div class="lang" role="group" data-i18n-aria="langGroup" aria-label="${esc(d.langGroup)}">${btn("pl", "PL", "langPl")}${btn("en", "EN", "langEn")}</div>
  </div>
</header>
<section class="wrap intro" id="intro">
  <p ${t("intro.lead")}>${esc(d["intro.lead"])}</p>
  <h2 ${t("intro.listTitle")}>${esc(d["intro.listTitle"])}</h2>
  <ul>${items}</ul>
  <button type="button" class="primary" id="start" ${t("intro.start")}>${esc(d["intro.start"])}</button>
</section>
<div class="demo" id="demo" data-view="shop">
  <div class="tabs" role="group" data-i18n-aria="view.group" aria-label="${esc(d["view.group"])}">
    <button type="button" data-view="shop" aria-pressed="true" ${t("tab.shop")}>${esc(d["tab.shop"])}</button>
    <button type="button" data-view="backstage" aria-pressed="false" id="tab-back" aria-label="${esc(d["tab.backstageAria"].replace("{n}", "0"))}"><span ${t("tab.backstage")}>${esc(d["tab.backstage"])}</span> <span class="count" id="count" aria-hidden="true">(0)</span></button>
  </div>
  <section class="col" id="col-shop" aria-labelledby="h-shop">
    <h2 id="h-shop" ${t("col.shop")}>${esc(d["col.shop"])}</h2>
    <ol class="steps" id="steps" data-i18n-aria="steps.aria" aria-label="${esc(d["steps.aria"])}"></ol>
    <div id="panel"></div>
    <p id="error" class="error" role="alert" hidden></p>
  </section>
  <section class="col" id="col-back" aria-labelledby="h-back">
    <h2 id="h-back" ${t("col.backstage")}>${esc(d["col.backstage"])}</h2>
    <p class="muted small" ${t("backstage.intro")}>${esc(d["backstage.intro"])}</p>
    <p class="muted" id="log-empty" ${t("backstage.empty")}>${esc(d["backstage.empty"])}</p>
    <ol class="log" id="log" role="log"></ol>
  </section>
</div>
<aside class="wrap cta">
  <p><span ${t("ctaLead")}>${esc(d.ctaLead)}</span> <a href="https://piotrmajkutewicz.pl" rel="noopener" ${t("ctaLink")}>${esc(d.ctaLink)}</a></p>
</aside>
<footer class="wrap muted small" ${t("footer")}>${esc(d.footer)}</footer>
<script src="/app.js" defer></script>
</body>
</html>
`;
}
