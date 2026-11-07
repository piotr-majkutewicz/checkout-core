// Static assets of the demo UI, inlined so the Worker needs no asset pipeline and no CDN.
// The client script never uses innerHTML: all dynamic text goes through textContent.
// All user-facing texts come from the dictionaries in src/i18n.

import { type Dict, en } from "../i18n/en.js";
import { FORMAT_MONEY_SOURCE, MONEY_FORMATS } from "../i18n/money.js";
import { pl } from "../i18n/pl.js";

export type Lang = "pl" | "en";
export const DEFAULT_LANG: Lang = "pl";
export const DICTIONARIES: Record<Lang, Dict> = { pl, en };

export function parseLang(value: string | null | undefined): Lang | undefined {
  return value === "pl" || value === "en" ? value : undefined;
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The page shell, rendered in the requested language. The client script keeps it in sync when the language changes. */
export function indexHtml(lang: Lang): string {
  const d = DICTIONARIES[lang];
  const btn = (l: Lang, label: string, aria: "langPl" | "langEn") =>
    `<button type="button" data-lang="${l}" lang="${l}" data-i18n-aria="${aria}" aria-label="${esc(d[aria])}" aria-pressed="${l === lang}">${label}</button>`;
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
<div class="sim" role="note"><div class="wrap"><strong data-i18n="banner">${esc(d.banner)}</strong></div></div>
<header class="top">
  <div class="wrap">
    <div>
      <h1>checkout-core</h1>
      <p class="muted" data-i18n="headerLead">${esc(d.headerLead)}</p>
    </div>
    <div class="lang" role="group" data-i18n-aria="langGroup" aria-label="${esc(d.langGroup)}">${btn("pl", "PL", "langPl")}${btn("en", "EN", "langEn")}</div>
  </div>
</header>
<main class="wrap">
  <ol class="steps" id="steps"></ol>
  <section id="panel" aria-live="polite"></section>
  <p id="error" class="error" role="alert" hidden></p>
</main>
<aside class="wrap cta">
  <p><span data-i18n="ctaLead">${esc(d.ctaLead)}</span> <a href="https://piotrmajkutewicz.pl" rel="noopener" data-i18n="ctaLink">${esc(d.ctaLink)}</a></p>
</aside>
<footer class="wrap muted small" data-i18n="footer">${esc(d.footer)}</footer>
<script src="/app.js" defer></script>
</body>
</html>
`;
}

export const STYLE_CSS = String.raw`:root{--bg:#14110f;--fg:#f2ebdd;--muted:#a99f90;--line:#2f2823;--line2:#4a4038;--accent:#ef4444;--card:#1b1714}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.sim{background:var(--accent);color:#14110f;padding:10px 0;font-size:.95rem;text-align:center}
.cta{margin-top:24px}
.cta p{border:1px solid var(--line2);border-radius:12px;padding:16px;margin:0}
.cta a{color:var(--fg);font-weight:600;text-underline-offset:3px;display:inline-block;min-height:24px}
.cta a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.wrap{max-width:760px;margin:0 auto;padding:0 16px}
.top .wrap{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.lang{display:flex;gap:8px;flex-shrink:0}
.lang button{min-width:44px;min-height:44px;padding:0 12px;font-weight:600}
.lang button[aria-pressed=true]{border-color:var(--accent);background:var(--card)}
.top{border-bottom:1px solid var(--line);padding:24px 0 16px;margin-bottom:16px}
h1{margin:0 0 4px;font-size:1.6rem}
h2{margin:0 0 12px;font-size:1.25rem}
.muted{color:var(--muted)}
.small{font-size:.85rem;padding:24px 16px}
.steps{display:flex;gap:8px;list-style:none;padding:0;margin:0 0 16px;flex-wrap:wrap}
.steps li{border:1px solid var(--line);border-radius:999px;padding:4px 12px;color:var(--muted);font-size:.9rem}
.steps li.active{border-color:var(--accent);color:var(--fg)}
.steps li.done{color:var(--fg);border-color:var(--line2)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px}
.row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
.row .grow{flex:1}
.price{font-variant-numeric:tabular-nums;white-space:nowrap}
button,input,select{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line2);border-radius:8px;padding:10px 14px;min-height:44px}
button{cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
button:disabled{opacity:.5;cursor:not-allowed}
button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
input[type=number]{width:72px}
label.opt{display:flex;gap:12px;align-items:flex-start;padding:10px;border:1px solid var(--line);border-radius:8px;margin-bottom:8px;cursor:pointer}
label.opt input{min-height:0;margin-top:4px}
label.opt.sel{border-color:var(--accent)}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.error{color:#fca5a5;border:1px solid var(--accent);border-radius:8px;padding:10px}
.badge{display:inline-block;border:1px solid var(--line2);border-radius:6px;padding:2px 8px;font-size:.85rem}
.badge.ok{border-color:#4ade80;color:#86efac}
.badge.bad{border-color:var(--accent);color:#fca5a5}
pre{white-space:pre-wrap;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:.85rem;overflow-x:auto}
ul.hist{margin:0;padding-left:18px;color:var(--muted);font-size:.9rem}
`;

const CLIENT_JS = String.raw`(function () {
  "use strict";
  var I18N = __I18N__;
  var MONEY = __MONEY__;
  __FORMAT_MONEY__
  var STEP_KEYS = ["step.cart", "step.payment", "step.locker", "step.confirm"];
  var state = { step: 0, catalog: null, qty: {}, discount: "", method: "blik", blik: "123456", locker: "", quote: null, order: null, extra: null, errorCode: "" };
  var lang = readLang();

  function save(l) { try { localStorage.setItem("lang", l); } catch (e) { /* storage may be blocked */ } }
  function readLang() {
    var q = null;
    try { q = new URLSearchParams(location.search).get("lang"); } catch (e) { /* ignore */ }
    if (q === "pl" || q === "en") { save(q); return q; }
    try { var s = localStorage.getItem("lang"); if (s === "pl" || s === "en") return s; } catch (e) { /* ignore */ }
    return "pl";
  }

  function has(key) { return I18N[lang][key] !== undefined; }
  function t(key, params) {
    var text = I18N[lang][key];
    if (text === undefined) return key;
    Object.keys(params || {}).forEach(function (k) { text = text.split("{" + k + "}").join(String(params[k])); });
    return text;
  }

  function el(tag, props, kids) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") node.textContent = props[k];
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), props[k]);
      else if (k === "class") node.className = props[k];
      else if (props[k] !== null) node.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return node;
  }

  function money(g) { return formatMoney(g, MONEY[lang]); }
  function fmtDate(iso) {
    try { return new Date(iso + "T00:00:00Z").toLocaleDateString(lang === "pl" ? "pl-PL" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); }
    catch (e) { return iso; }
  }
  function productName(p) { return has("product." + p.sku + ".name") ? t("product." + p.sku + ".name") : p.name; }
  function productDesc(p) { return has("product." + p.sku + ".desc") ? t("product." + p.sku + ".desc") : p.description; }
  function lockerName(l) { return has("locker." + l.code) ? t("locker." + l.code) : l.name + ", " + l.city; }
  function label(prefix, value) { return has(prefix + "." + value) ? t(prefix + "." + value) : value; }

  function ApiError(code) { this.code = code; }
  function showError(code) {
    state.errorCode = code || "";
    var e = document.getElementById("error");
    e.textContent = code ? (has("err." + code) ? t("err." + code) : t("err.unknown")) : "";
    e.hidden = !code;
  }
  function fail(e) { showError(e && e.code ? e.code : "unknown"); }

  function api(path, method, body) {
    return fetch(path, { method: method || "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().then(function (d) { if (!r.ok) throw new ApiError(d.code || "unknown"); return d; }, function () { throw new ApiError("unknown"); });
      }, function () { throw new ApiError("network"); });
  }

  function items() {
    return Object.keys(state.qty).filter(function (s) { return state.qty[s] > 0; }).map(function (s) { return { sku: s, quantity: state.qty[s] }; });
  }

  function renderSteps() {
    var ol = document.getElementById("steps");
    ol.textContent = "";
    STEP_KEYS.forEach(function (key, i) {
      ol.appendChild(el("li", { class: i === state.step ? "active" : i < state.step ? "done" : "", text: (i + 1) + ". " + t(key) }));
    });
  }

  function totalsCard(q) {
    var card = el("div", { class: "card" });
    function line(text, value) { card.appendChild(el("div", { class: "row" }, [el("span", { class: "grow", text: text }), el("span", { class: "price", text: value })])); }
    line(t("totals.goods"), money(q.itemsGross));
    if (q.discountTotal > 0) line(t("totals.discount"), "-" + money(q.discountTotal));
    line(t("totals.delivery"), q.shippingGross === 0 ? t("totals.free") : money(q.shippingGross));
    q.vat.forEach(function (v) { line(t("totals.vat", { rate: v.rate, net: money(v.net) }), money(v.vat)); });
    card.appendChild(el("div", { class: "row" }, [el("strong", { class: "grow", text: t("totals.total") }), el("strong", { class: "price", text: money(q.totalGross) })]));
    return card;
  }

  function refreshQuote() {
    if (items().length === 0) { state.quote = null; render(); return Promise.resolve(); }
    return api("/api/quote", "POST", { items: items(), discountCode: state.discount }).then(function (q) { state.quote = q; showError(""); render(); })
      .catch(function (e) { state.quote = null; fail(e); render(); });
  }

  function viewCart() {
    var p = el("div");
    p.appendChild(el("h2", { text: t("cart.title") }));
    var card = el("div", { class: "card" });
    state.catalog.products.forEach(function (prod) {
      var input = el("input", { type: "number", min: "0", max: "99", value: String(state.qty[prod.sku] || 0), "aria-label": t("cart.qtyAria", { name: productName(prod) }) });
      input.addEventListener("change", function () { state.qty[prod.sku] = Math.max(0, Math.min(99, parseInt(input.value, 10) || 0)); refreshQuote(); });
      card.appendChild(el("div", { class: "row" }, [
        el("div", { class: "grow" }, [el("div", { text: productName(prod) }), el("div", { class: "muted small", text: productDesc(prod) + ", " + t("cart.vat", { rate: prod.vatRate }) })]),
        el("span", { class: "price", text: money(prod.unitGross) }), input
      ]));
    });
    p.appendChild(card);
    var code = el("input", { type: "text", placeholder: t("cart.discountPlaceholder"), value: state.discount, "aria-label": t("cart.discountAria") });
    code.addEventListener("change", function () { state.discount = code.value; refreshQuote(); });
    p.appendChild(el("div", { class: "card" }, [code, el("span", { class: "muted small", text: " " + t("cart.try") + " " + state.catalog.discountCodes.join(", ") })]));
    if (state.quote) p.appendChild(totalsCard(state.quote));
    p.appendChild(el("div", { class: "actions" }, [el("button", { class: "primary", text: t("cart.continue"), disabled: state.quote ? null : "disabled", onclick: function () { state.step = 1; render(); } })]));
    return p;
  }

  function radio(name, value, title, hint, checked, onChange) {
    var input = el("input", { type: "radio", name: name, value: value });
    if (checked) input.checked = true;
    input.addEventListener("change", onChange);
    return el("label", { class: "opt" + (checked ? " sel" : "") }, [input, el("span", {}, [el("strong", { text: title }), hint ? el("div", { class: "muted small", text: hint }) : null])]);
  }

  function viewPayment() {
    var p = el("div");
    p.appendChild(el("h2", { text: t("pay.title") }));
    ["blik", "card", "transfer"].forEach(function (m) {
      p.appendChild(radio("method", m, t("method." + m), t("method." + m + ".hint"), state.method === m, function () { state.method = m; render(); }));
    });
    if (state.method === "blik") {
      var b = el("input", { type: "text", inputmode: "numeric", maxlength: "6", value: state.blik, "aria-label": t("pay.blikCode") });
      b.addEventListener("input", function () { state.blik = b.value; });
      p.appendChild(el("div", { class: "card" }, [el("label", { text: t("pay.blikCode") + " " }, [b])]));
    }
    p.appendChild(el("div", { class: "actions" }, [
      el("button", { text: t("pay.back"), onclick: function () { state.step = 0; render(); } }),
      el("button", { class: "primary", text: t("pay.continue"), onclick: function () {
        if (state.method === "blik" && !/^\d{6}$/.test(state.blik)) { showError("bad_blik"); return; }
        showError(""); state.step = 2; render(); } })
    ]));
    return p;
  }

  function viewLocker() {
    var p = el("div");
    p.appendChild(el("h2", { text: t("locker.title") }));
    p.appendChild(el("p", { class: "muted", text: t("locker.intro") }));
    state.catalog.lockers.forEach(function (l) {
      p.appendChild(radio("locker", l.code, l.code + " " + lockerName(l), "", state.locker === l.code, function () { state.locker = l.code; render(); }));
    });
    var c = el("input", { type: "text", value: state.locker, maxlength: "10", "aria-label": t("locker.codeAria"), placeholder: t("locker.placeholder") });
    c.addEventListener("input", function () { state.locker = c.value; });
    p.appendChild(el("div", { class: "card" }, [el("label", { text: t("locker.codeLabel") + " " }, [c])]));
    if (state.quote) p.appendChild(totalsCard(state.quote));
    p.appendChild(el("div", { class: "actions" }, [
      el("button", { text: t("pay.back"), onclick: function () { state.step = 1; render(); } }),
      el("button", { class: "primary", text: t("locker.place"), onclick: placeOrder })
    ]));
    return p;
  }

  function placeOrder() {
    api("/api/orders", "POST", { items: items(), discountCode: state.discount, method: state.method, blikCode: state.blik, lockerCode: state.locker })
      .then(function (d) { state.order = d.order; state.extra = null; showError(""); state.step = 3; render(); })
      .catch(fail);
  }

  function orderAction(path, text, primary) {
    return el("button", { class: primary ? "primary" : "", text: text, onclick: function () {
      api("/api/orders/" + state.order.id + path, "POST").then(function (d) {
        state.order = d.order; state.extra = d; showError(""); render();
      }).catch(fail);
    } });
  }

  function anomalyText(raw) {
    var m = /ignored: (\w+)/.exec(raw);
    return m && has("anomaly." + m[1]) ? t("anomaly." + m[1]) : t("anomaly.generic");
  }

  function viewConfirm() {
    var o = state.order;
    var p = el("div");
    p.appendChild(el("h2", { text: t("confirm.title", { id: o.id }) }));
    var good = o.state === "paid" || o.state === "shipped" || o.state === "fulfilled";
    var bad = o.state === "payment_failed" || o.state === "cancelled";
    p.appendChild(el("div", { class: "card" }, [
      el("div", { class: "row" }, [el("span", { class: "grow", text: t("confirm.status") }), el("span", { class: "badge " + (good ? "ok" : bad ? "bad" : ""), text: label("state", o.state) })]),
      el("div", { class: "row" }, [el("span", { class: "grow", text: t("confirm.payment") }), el("span", { text: label("method", o.paymentMethod) + " (" + o.paymentId + ")" })]),
      el("div", { class: "row" }, [el("span", { class: "grow", text: t("confirm.locker") }), el("span", { text: o.lockerCode })]),
      o.trackingNumber ? el("div", { class: "row" }, [el("span", { class: "grow", text: t("confirm.tracking") }), el("span", { text: o.trackingNumber })]) : null,
      el("div", { class: "row" }, [el("strong", { class: "grow", text: t("totals.total") }), el("strong", { class: "price", text: money(o.totals.totalGross) })])
    ]));
    if (state.extra && state.extra.label) {
      p.appendChild(el("pre", { text: [t("confirm.label"), t("confirm.tracking") + ": " + o.trackingNumber, t("confirm.labelOrder") + ": " + o.id, t("confirm.locker") + ": " + o.lockerCode].join("\n") }));
    }
    if (state.extra && state.extra.withdrawal) {
      var w = state.extra.withdrawal;
      p.appendChild(el("p", { class: "muted", text: t(w.open ? "confirm.withdrawalOpen" : "confirm.withdrawalClosed", { date: fmtDate(w.lastDay) }) }));
    }
    var a = el("div", { class: "actions" });
    if (o.state === "awaiting_payment") a.appendChild(orderAction("/settle", t("action.settle"), true));
    if (o.state === "paid") a.appendChild(orderAction("/ship", t("action.ship"), true));
    if (o.state === "shipped") a.appendChild(orderAction("/deliver", t("action.deliver"), true));
    if (["paid", "shipped", "fulfilled"].indexOf(o.state) >= 0) a.appendChild(orderAction("/refund", t("action.refund")));
    a.appendChild(orderAction("/redeliver", t("action.redeliver")));
    a.appendChild(el("button", { text: t("action.startOver"), onclick: function () { state.qty = {}; state.quote = null; state.order = null; state.step = 0; render(); } }));
    p.appendChild(a);
    if (state.extra && state.extra.outcome) p.appendChild(el("p", { class: "muted small", text: t("confirm.replay", { outcome: label("outcome", state.extra.outcome) }) }));
    p.appendChild(el("h3", { class: "small muted", text: t("confirm.history") }));
    var h = el("ul", { class: "hist" });
    o.history.forEach(function (x) { h.appendChild(el("li", { text: label("state", x.from) + " -> " + label("state", x.to) + " (" + label("event", x.event) + ")" })); });
    p.appendChild(h);
    if (o.anomalies.length) {
      var box = el("div", { class: "error" }, [el("strong", { text: t("confirm.anomalies") })]);
      o.anomalies.forEach(function (x) { box.appendChild(el("div", { text: anomalyText(x) })); });
      p.appendChild(box);
    }
    return p;
  }

  function render() {
    renderSteps();
    var panel = document.getElementById("panel");
    panel.textContent = "";
    if (!state.catalog) return;
    panel.appendChild([viewCart, viewPayment, viewLocker, viewConfirm][state.step]());
  }

  function applyStatic() {
    document.documentElement.lang = lang;
    document.title = t("htmlTitle");
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (n) { n.setAttribute("aria-label", t(n.getAttribute("data-i18n-aria"))); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-lang]"), function (n) { n.setAttribute("aria-pressed", String(n.getAttribute("data-lang") === lang)); });
  }

  function setLang(l) {
    lang = l;
    save(l);
    try {
      var u = new URL(location.href);
      if (u.searchParams.has("lang")) { u.searchParams.set("lang", l); history.replaceState(null, "", u.toString()); }
    } catch (e) { /* ignore */ }
    applyStatic();
    showError(state.errorCode);
    render();
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-lang]"), function (b) {
    b.addEventListener("click", function () { setLang(b.getAttribute("data-lang")); });
  });
  applyStatic();
  renderSteps();

  api("/api/catalog").then(function (c) { state.catalog = c; state.qty[c.products[0].sku] = 1; return refreshQuote(); }).catch(fail);
})();
`;

/** Client script with the dictionaries and the money formatter embedded. */
export const APP_JS = CLIENT_JS
  .replace("__I18N__", () => JSON.stringify(DICTIONARIES))
  .replace("__MONEY__", () => JSON.stringify(MONEY_FORMATS))
  .replace("__FORMAT_MONEY__", () => FORMAT_MONEY_SOURCE);
