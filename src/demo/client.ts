// Browser script of the demo, kept as a string so the Worker needs no asset pipeline.
// It never uses innerHTML: all dynamic text goes through textContent.
import { DICTIONARIES } from "./langs.js";
import { FORMAT_MONEY_SOURCE, MONEY_FORMATS } from "../i18n/money.js";
import { LUHN_SOURCE, TEST_CARDS } from "./cards.js";

/** Seconds the simulated BLIK confirmation takes. */
export const BLIK_DELAY_SECONDS = 5;
/** Milliseconds the simulated bank needs after "confirm the transfer". */
export const BANK_DELAY_MS = 1500;

const CLIENT_JS = String.raw`(function () {
  "use strict";
  var I18N = __I18N__;
  var MONEY = __MONEY__;
  var TEST_CARDS = __CARDS__;
  var BLIK_DELAY = __BLIK_DELAY__;
  var BANK_DELAY = __BANK_DELAY__;
  __FORMAT_MONEY__
  __LUHN__
  var STEP_KEYS = ["step.cart", "step.payment", "step.locker", "step.confirm"];
  var state = fresh();
  var lang = readLang();
  var timers = [];
  var openLog = {};
  var renderedLog = 0;

  function fresh() {
    return { step: 0, catalog: null, qty: {}, discount: "", method: "blik", blik: "123456",
      card: { number: "", expiry: "12/30", cvc: "123" }, cardScenario: "success", locker: "", quote: null,
      order: null, fx: "", shownState: "", paymentStatus: null, withdrawal: null, shipment: null, flow: null, relResult: "", errorCode: "", log: [], view: "shop", busy: false };
  }

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
  function label(prefix, value) { return has(prefix + "." + value) ? t(prefix + "." + value) : String(value); }

  function el(tag, props, kids) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") node.textContent = props[k];
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), props[k]);
      else if (k === "class") node.className = props[k];
      else if (props[k] !== null && props[k] !== undefined) node.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return node;
  }
  function $(id) { return document.getElementById(id); }

  function money(g) { return formatMoney(g, MONEY[lang]); }
  function locale() { return lang === "pl" ? "pl-PL" : "en-GB"; }
  function fmtDate(iso) {
    try { return new Date(iso + "T00:00:00Z").toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); }
    catch (e) { return iso; }
  }
  function fmtTime(iso) {
    try { return new Date(iso).toLocaleTimeString(locale(), { hour12: false }); } catch (e) { return iso; }
  }
  function productName(p) { return has("product." + p.sku + ".name") ? t("product." + p.sku + ".name") : p.name; }
  function productDesc(p) { return has("product." + p.sku + ".desc") ? t("product." + p.sku + ".desc") : p.description; }
  function lockerName(l) { return has("locker." + l.code) ? t("locker." + l.code) : l.name + ", " + l.city; }

  function ApiError(code) { this.code = code; }
  function showError(code) {
    state.errorCode = code || "";
    var e = $("error");
    e.textContent = code ? (has("err." + code) ? t("err." + code) : t("err.unknown")) : "";
    e.hidden = !code;
  }
  function fail(e) { state.busy = false; showError(e && e.code ? e.code : "unknown"); }

  function api(path, method, body) {
    return fetch(path, { method: method || "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().then(function (d) { if (!r.ok) throw new ApiError(d.code || "unknown"); return d; }, function () { throw new ApiError("unknown"); });
      }, function () { throw new ApiError("network"); });
  }

  function clearTimers() { timers.forEach(function (id) { clearTimeout(id); clearInterval(id); }); timers = []; }

  /* ---------- loading states ---------- */

  var SVG_NS = "http://www.w3.org/2000/svg";
  function spinner() { return el("span", { class: "spinner", "aria-hidden": "true" }); }
  /** Announces a short message to screen readers (the live region is visually hidden). */
  function say(text) { var n = $("live"); if (n) n.textContent = text; }
  /** Turns a button into its loading state at once: spinner, new label, no more clicks. The width is kept so nothing shifts. */
  function setBusy(btn) {
    if (!btn) return;
    btn.style.minWidth = btn.offsetWidth + "px";
    btn.setAttribute("aria-busy", "true");
    btn.disabled = true;
    btn.textContent = "";
    btn.appendChild(spinner());
    btn.appendChild(document.createTextNode(t("busy.processing")));
  }
  /** Runs one request-backed action exactly once at a time; the page re-renders (or shows the error) when it ends. */
  function act(btn, fn) {
    if (state.busy) return;
    state.busy = true;
    setBusy(btn);
    if (btn) say(t("busy.processing"));
    var p;
    try { p = fn(); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function () { state.busy = false; }, function (e) { fail(e); render(); });
  }
  function markQuote(on) {
    var n = document.querySelector(".totals");
    if (n) { n.classList.toggle("pending", on); n.setAttribute("aria-busy", String(on)); }
    if (on) say(t("busy.quote"));
  }
  function checkSvg() {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "check");
    svg.setAttribute("aria-hidden", "true");
    var ring = document.createElementNS(SVG_NS, "circle");
    ring.setAttribute("cx", "12"); ring.setAttribute("cy", "12"); ring.setAttribute("r", "10");
    var tick = document.createElementNS(SVG_NS, "path");
    tick.setAttribute("d", "M7 12.5l3.2 3.2L17 8.8");
    svg.appendChild(ring); svg.appendChild(tick);
    return svg;
  }

  function items() {
    return Object.keys(state.qty).filter(function (s) { return state.qty[s] > 0; }).map(function (s) { return { sku: s, quantity: state.qty[s] }; });
  }

  /* ---------- behind the scenes log ---------- */

  function describe(e) {
    var d = e.data || {};
    switch (e.kind) {
      case "cart_priced": return t("log.cart_priced", { lines: d.lines, total: money(d.totalGross), vat: money(d.totalVat) });
      case "order_created": return t("log.order_created", { id: d.orderId, total: money(d.totalGross) });
      case "payment_requested": return t("log.payment_requested", { method: label("method", d.method), amount: money(d.amount), paymentId: d.paymentId });
      case "payment_settled": return t("log.payment_settled", { outcome: label("log.payment_settled", d.outcome) });
      case "webhook_sent": return t("log.webhook_sent", { type: label("webhook.type", d.type), eventId: d.eventId });
      case "signature_ok": return t("log.signature_ok");
      case "order_transition": return t("log.order_transition", { from: label("state", d.from), to: label("state", d.to), event: label("event", d.event) });
      case "webhook_duplicate": return t("log.webhook_duplicate", { eventId: d.eventId });
      case "webhook_ignored": return t("log.webhook_ignored", { reason: label("anomaly", d.reason) });
      case "webhook_rejected": return t("log.webhook_rejected", { status: d.status, reason: label("webhook.error", d.code) });
      case "shipment_created": return t("log.shipment_created", { locker: d.lockerCode, tracking: d.trackingNumber, size: d.sizeClass });
      case "refund_requested": return t("log.refund_requested", { amount: money(d.amount) });
      case "redelivered": return t("log.redelivered", { eventId: d.eventId });
      case "forged_sent": return t("log.forged_sent");
      case "stale_sent": return t("log.stale_sent", { sequence: d.sequence, last: d.lastApplied });
      default: return e.kind;
    }
  }

  function logItem(e, i) {
    var det = el("details", {}, [
      el("summary", { text: t("backstage.raw") }),
      el("pre", { lang: "en", text: JSON.stringify(e.data, null, 2) })
    ]);
    if (openLog[i]) det.open = true;
    det.addEventListener("toggle", function () { openLog[i] = det.open; });
    return el("li", {}, [el("time", { datetime: e.at, text: fmtTime(e.at) }), el("p", { text: describe(e) }), det]);
  }

  function renderLog(all) {
    var ol = $("log");
    if (all) { ol.textContent = ""; renderedLog = 0; }
    for (; renderedLog < state.log.length; renderedLog++) {
      var li = logItem(state.log[renderedLog], renderedLog);
      if (!all) {
        // New entries slide in and the newest one is highlighted for a moment. Scrolling is never touched.
        var prev = ol.querySelector(".latest");
        if (prev) prev.classList.remove("latest");
        li.classList.add("new", "latest");
      }
      ol.appendChild(li);
    }
    $("log-empty").hidden = state.log.length > 0;
    var n = state.log.length;
    $("count").textContent = "(" + n + ")";
    $("tab-back").setAttribute("aria-label", t("tab.backstageAria", { n: n }));
  }

  function addTrace(entries) {
    (entries || []).forEach(function (e) { state.log.push(e); });
    renderLog(false);
  }

  /* ---------- views ---------- */

  function ensureVisible(node) {
    var top = node.getBoundingClientRect().top;
    if (top < 0) window.scrollBy(0, top - 8);
  }

  function goStep(n) { state.step = n; showError(""); render(); ensureVisible($("steps")); }

  function setView(v) {
    state.view = v;
    $("demo").setAttribute("data-view", v);
    Array.prototype.forEach.call(document.querySelectorAll("[data-view].tabs button, .tabs [data-view]"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === v));
    });
    var tabs = document.querySelector(".tabs");
    if (tabs && tabs.offsetParent !== null) ensureVisible(tabs);
  }

  function renderSteps() {
    var ol = $("steps");
    // Update the pills in place so that CSS can animate the change of the active step.
    if (ol.children.length !== STEP_KEYS.length) {
      ol.textContent = "";
      STEP_KEYS.forEach(function () { ol.appendChild(el("li")); });
    }
    STEP_KEYS.forEach(function (key, i) {
      var li = ol.children[i];
      li.className = i === state.step ? "active" : i < state.step ? "done" : "";
      if (i === state.step) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
      li.textContent = (i + 1) + ". " + t(key);
    });
  }

  function guide(key) {
    return el("div", { class: "guide" }, [
      el("p", { text: t(key) }),
      el("button", { type: "button", class: "only-mobile", text: t("backstage.goto"), onclick: function () { setView("backstage"); } })
    ]);
  }

  function totalsCard(q) {
    var card = el("div", { class: "card totals" });
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
    markQuote(true);
    return api("/api/quote", "POST", { items: items(), discountCode: state.discount }).then(function (q) { state.quote = q; addTrace(q.trace); showError(""); render(); })
      .catch(function (e) { state.quote = null; fail(e); render(); });
  }

  function viewCart() {
    var p = el("div");
    p.appendChild(guide("guide.cart"));
    p.appendChild(el("h3", { text: t("cart.title") }));
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
    p.appendChild(el("div", { class: "card" }, [code, el("div", { class: "muted small", text: t("cart.try") + " " + state.catalog.discountCodes.join(", ") })]));
    if (state.quote) p.appendChild(totalsCard(state.quote));
    p.appendChild(el("div", { class: "actions" }, [el("button", { type: "button", class: "primary", text: t("cart.continue"), disabled: state.quote ? null : "disabled", onclick: function () { goStep(1); } })]));
    return p;
  }

  function radio(name, value, title, hint, checked, onChange) {
    var input = el("input", { type: "radio", name: name, value: value });
    if (checked) input.checked = true;
    input.addEventListener("change", onChange);
    return el("label", { class: "opt" + (checked ? " sel" : "") }, [input, el("span", {}, [el("strong", { text: title }), hint ? el("div", { class: "muted small", text: hint }) : null])]);
  }

  function textField(labelText, value, attrs, onInput) {
    var input = el("input", Object.assign({ type: "text", value: value }, attrs));
    input.addEventListener("input", function () { onInput(input.value); });
    return el("div", {}, [el("label", { text: labelText, for: attrs.id }), input]);
  }

  function viewPayment() {
    var p = el("div");
    p.appendChild(guide("guide.payment"));
    p.appendChild(el("h3", { text: t("pay.title") }));
    ["blik", "card", "transfer"].forEach(function (m) {
      p.appendChild(radio("method", m, t("method." + m), t("method." + m + ".hint"), state.method === m, function () { state.method = m; showError(""); render(); }));
    });
    if (state.method === "blik") {
      p.appendChild(el("div", { class: "card" }, [
        textField(t("pay.blikCode"), state.blik, { id: "blik", inputmode: "numeric", maxlength: "6", autocomplete: "off" }, function (v) { state.blik = v; }),
        el("p", { class: "muted small", text: t("blik.hint") })
      ]));
    }
    if (state.method === "card") {
      var fields = el("div", { class: "fields" });
      var num = textField(t("card.number"), state.card.number, { id: "card-number", inputmode: "numeric", maxlength: "23", autocomplete: "off" }, function (v) { state.card.number = v; });
      num.className = "wide";
      fields.appendChild(num);
      fields.appendChild(textField(t("card.expiry"), state.card.expiry, { id: "card-expiry", maxlength: "7", autocomplete: "off" }, function (v) { state.card.expiry = v; }));
      fields.appendChild(textField(t("card.cvc"), state.card.cvc, { id: "card-cvc", inputmode: "numeric", maxlength: "3", autocomplete: "off" }, function (v) { state.card.cvc = v; }));
      var samples = el("div", { class: "samples" });
      TEST_CARDS.forEach(function (c) {
        var lbl = t("card.sample." + c.scenario);
        samples.appendChild(el("button", { type: "button", text: c.number + " (" + lbl + ")", "aria-label": t("card.fillAria", { label: c.number + ", " + lbl }), onclick: function () { state.card.number = c.number; render(); } }));
      });
      p.appendChild(el("div", { class: "card" }, [
        el("p", { class: "muted small", text: t("card.note") }),
        fields,
        el("p", { class: "muted small", text: t("card.try") }),
        samples
      ]));
    }
    p.appendChild(el("div", { class: "actions" }, [
      el("button", { type: "button", text: t("pay.back"), onclick: function () { goStep(0); } }),
      el("button", { type: "button", class: "primary", text: t("pay.continue"), onclick: function () { var err = validatePayment(); if (err) { showError(err); return; } goStep(2); } })
    ]));
    return p;
  }

  function validatePayment() {
    if (state.method === "blik") return /^\d{6}$/.test(state.blik) ? "" : "bad_blik";
    if (state.method === "card") {
      var digits = state.card.number.replace(/\D/g, "");
      if (!luhnValid(digits)) return "bad_card_number";
      var found = TEST_CARDS.filter(function (c) { return c.number.replace(/\D/g, "") === digits; })[0];
      if (!found) return "card_not_test";
      if (!/^(0[1-9]|1[0-2]) ?\/ ?\d{2}$/.test(state.card.expiry.trim())) return "bad_card_expiry";
      if (!/^\d{3}$/.test(state.card.cvc.trim())) return "bad_card_cvc";
      state.cardScenario = found.scenario;
    }
    return "";
  }

  function viewLocker() {
    var p = el("div");
    p.appendChild(guide("guide.locker"));
    p.appendChild(el("h3", { text: t("locker.title") }));
    p.appendChild(el("p", { class: "muted", text: t("locker.intro") }));
    state.catalog.lockers.forEach(function (l) {
      p.appendChild(radio("locker", l.code, l.code + " " + lockerName(l), "", state.locker === l.code, function () { state.locker = l.code; render(); }));
    });
    p.appendChild(el("div", { class: "card" }, [
      textField(t("locker.codeLabel"), state.locker, { id: "locker-code", maxlength: "10", placeholder: t("locker.placeholder"), autocomplete: "off" }, function (v) { state.locker = v; })
    ]));
    if (state.quote) p.appendChild(totalsCard(state.quote));
    p.appendChild(el("div", { class: "actions" }, [
      el("button", { type: "button", text: t("pay.back"), onclick: function () { goStep(1); } }),
      el("button", { type: "button", class: "primary", text: t("locker.place"), onclick: function (ev) { placeOrder(ev.currentTarget); } })
    ]));
    return p;
  }

  function applyResponse(d) {
    var prev = state.order;
    var next = d.order.state;
    // A payment result is announced and animated once, when the order first reaches it.
    state.fx = (next === "paid" || next === "payment_failed") && (!prev || prev.id !== d.order.id || prev.state !== next) ? next : "";
    if (!prev || prev.id !== d.order.id || prev.state !== next) say(t("live.order", { state: label("state", next) }));
    state.order = d.order;
    state.paymentStatus = d.paymentStatus || null;
    state.withdrawal = d.withdrawal || null;
    if (d.shipment) state.shipment = d.shipment;
    addTrace(d.trace);
  }

  function placeOrder(btn) {
    var body = { items: items(), discountCode: state.discount, method: state.method, lockerCode: state.locker };
    if (state.method === "blik") body.blikCode = state.blik;
    if (state.method === "card") body.cardScenario = state.cardScenario;
    act(btn, function () {
      return api("/api/orders", "POST", body).then(function (d) {
        state.flow = d.flow; state.relResult = ""; state.shipment = null; state.shownState = "";
        applyResponse(d); showError(""); state.step = 3; render(); ensureVisible($("steps")); startFlow();
      });
    });
  }

  /* ---------- simulated payment flows ---------- */

  function settle(outcome, btn) {
    act(btn, function () {
      return api("/api/orders/" + state.order.id + "/settle", "POST", { outcome: outcome })
        .then(function (d) { state.flow = null; applyResponse(d); showError(""); render(); });
    });
  }

  function startFlow() {
    clearTimers();
    if (state.flow !== "blik_app" || state.order.state !== "awaiting_payment") return;
    var left = BLIK_DELAY;
    var id = setInterval(function () {
      left--;
      var n = $("countdown");
      if (n) n.textContent = t("flow.blik.text", { n: Math.max(left, 0) });
      if (left <= 0) { clearInterval(id); settle("succeeded"); }
    }, 1000);
    timers.push(id);
  }

  function flowCard() {
    if (!state.flow || state.order.state !== "awaiting_payment") return null;
    var card = el("div", { class: "card" });
    if (state.flow === "blik_app") {
      card.appendChild(el("h3", { class: "waiting" }, [spinner(), t("flow.blik.title")]));
      card.appendChild(el("p", { id: "countdown", role: "timer", text: t("flow.blik.text", { n: BLIK_DELAY }) }));
    } else if (state.flow === "three_ds") {
      card.appendChild(el("h3", { text: t("flow.threeds.title") }));
      card.appendChild(el("p", { text: t("flow.threeds.text") }));
      card.appendChild(el("div", { class: "actions" }, [
        el("button", { type: "button", class: "primary", text: t("flow.threeds.approve"), onclick: function (ev) { settle("succeeded", ev.currentTarget); } }),
        el("button", { type: "button", text: t("flow.threeds.reject"), onclick: function (ev) { settle("failed", ev.currentTarget); } })
      ]));
    } else {
      card.appendChild(el("h3", { text: t("flow.bank.title") }));
      card.appendChild(el("p", { text: t("flow.bank.text", { amount: money(state.order.totals.totalGross) }) }));
      card.appendChild(el("div", { class: "actions" }, [
        el("button", { type: "button", class: "primary", id: "bank-confirm", text: t("flow.bank.confirm"), onclick: function (ev) {
          setBusy(ev.currentTarget);
          card.appendChild(el("p", { class: "waiting", role: "status" }, [spinner(), t("flow.bank.processing")]));
          timers.push(setTimeout(function () { settle("succeeded"); }, BANK_DELAY));
        } })
      ]));
    }
    return card;
  }

  /* ---------- confirmation ---------- */

  function actionButton(path, text, primary) {
    return el("button", { type: "button", class: primary ? "primary" : "", text: text, onclick: function (ev) {
      act(ev.currentTarget, function () {
        return api("/api/orders/" + state.order.id + path, "POST").then(function (d) { state.relResult = ""; applyResponse(d); showError(""); render(); });
      });
    } });
  }

  function reliability() {
    var o = state.order;
    if (!o || o.lastPaymentSequence < 1) return null;
    var box = el("div", { class: "card" }, [el("h3", { text: t("rel.title") }), el("p", { class: "muted", text: t("rel.intro") })]);
    [["/redeliver", "rel.again"], ["/forge", "rel.forged"], ["/late", "rel.late"]].forEach(function (x) {
      box.appendChild(el("div", { class: "rel" }, [
        el("button", { type: "button", text: t(x[1] + ".btn"), onclick: function (ev) {
          act(ev.currentTarget, function () {
            return api("/api/orders/" + o.id + x[0], "POST").then(function (d) { state.relResult = d.outcome; applyResponse(d); showError(""); render(); });
          });
        } }),
        el("p", { class: "muted small", text: t(x[1] + ".help") })
      ]));
    });
    if (state.relResult) box.appendChild(el("p", { class: "result", role: "status", text: t("rel.result." + state.relResult) + " " + t("confirm.backstageHint") }));
    return box;
  }

  function summaryCard(o) {
    var q = o.totals;
    var card = el("div", { class: "card" }, [el("h3", { text: t("sum.title") })]);
    function line(text, value) { card.appendChild(el("div", { class: "row" }, [el("span", { class: "grow", text: text }), el("span", { class: "price", text: value })])); }
    line(t("totals.goods"), money(q.itemsGross));
    if (q.discountTotal > 0) line(t("totals.discount"), "-" + money(q.discountTotal));
    line(t("totals.delivery"), q.shippingGross === 0 ? t("totals.free") : money(q.shippingGross));
    card.appendChild(el("div", { class: "row" }, [el("strong", { class: "grow", text: t("totals.total") }), el("strong", { class: "price", text: money(q.totalGross) })]));
    card.appendChild(el("h3", { text: t("sum.vatTitle") }));
    var head = el("tr", {}, ["sum.rate", "sum.net", "sum.vat", "sum.gross"].map(function (k) { return el("th", { scope: "col", text: t(k) }); }));
    var body = el("tbody");
    q.vat.forEach(function (v) {
      body.appendChild(el("tr", {}, [el("td", { text: v.rate + "%" }), el("td", { text: money(v.net) }), el("td", { text: money(v.vat) }), el("td", { text: money(v.gross) })]));
    });
    body.appendChild(el("tr", {}, [el("th", { scope: "row", text: t("totals.total") }), el("td", { text: money(q.totalNet) }), el("td", { text: money(q.totalVat) }), el("td", { text: money(q.totalGross) })]));
    card.appendChild(el("div", { class: "tablewrap" }, [el("table", {}, [el("thead", {}, [head]), body])]));
    card.appendChild(el("h3", { text: t("sum.withdrawalTitle") }));
    var w = state.withdrawal;
    card.appendChild(el("p", { class: "muted", text: !w ? t("sum.withdrawalNone") : t(w.open ? "sum.withdrawalOpen" : "sum.withdrawalClosed", { date: fmtDate(w.lastDay) }) }));
    return card;
  }

  function labelBox(o) {
    if (!o.trackingNumber) return null;
    var lines = [t("label.title"), t("label.tracking") + ": " + o.trackingNumber, t("label.order") + ": " + o.id, t("label.locker") + ": " + o.lockerCode];
    if (state.shipment && state.shipment.sizeClass) lines.push(t("label.size") + ": " + state.shipment.sizeClass);
    lines.push(t("label.recipient") + ": " + t("label.recipientName"));
    return el("pre", { text: lines.join("\n") });
  }

  function add(parent, node) { if (node) parent.appendChild(node); }

  function viewConfirm() {
    var o = state.order;
    var p = el("div");
    p.appendChild(guide("guide.confirm." + o.state));
    p.appendChild(el("h3", { text: t("confirm.title", { id: o.id }) }));
    var fx = state.fx;
    var changed = state.shownState && state.shownState !== o.state;
    state.fx = "";
    state.shownState = o.state;
    if (o.state === "paid") add(p, el("div", { class: "outcome ok" + (fx ? " fx" : "") }, [checkSvg(), el("span", { text: t("outcome.success") })]));
    if (o.state === "payment_failed") add(p, el("div", { class: "outcome bad" + (fx ? " fx" : ""), role: "alert" }, [el("span", { class: "cross", "aria-hidden": "true", text: "×" }), el("span", { text: t("outcome.failed") })]));
    var good = o.state === "paid" || o.state === "shipped" || o.state === "fulfilled";
    var bad = o.state === "payment_failed" || o.state === "cancelled";
    p.appendChild(el("div", { class: "card" }, [
      el("div", { class: "row" }, [el("span", { class: "grow", text: t("confirm.status") }), el("span", { class: "badge " + (good ? "ok" : bad ? "bad" : "") + (changed ? " pop" : ""), text: label("state", o.state) })]),
      el("div", { class: "row" }, [el("span", { class: "grow", text: t("confirm.payment") }), el("span", { text: label("method", o.paymentMethod) + (state.paymentStatus ? ", " + label("paystatus", state.paymentStatus) : "") })]),
      el("div", { class: "row" }, [el("span", { class: "grow", text: t("confirm.locker") }), el("span", { text: o.lockerCode })]),
      o.trackingNumber ? el("div", { class: "row" }, [el("span", { class: "grow", text: t("confirm.tracking") }), el("span", { text: o.trackingNumber })]) : null
    ]));
    add(p, flowCard());
    var a = el("div", { class: "actions" });
    if (o.state === "paid") a.appendChild(actionButton("/ship", t("action.ship"), true));
    if (o.state === "shipped") a.appendChild(actionButton("/deliver", t("action.deliver"), true));
    if (["paid", "shipped", "fulfilled"].indexOf(o.state) >= 0) a.appendChild(actionButton("/refund", t("action.refund")));
    a.appendChild(el("button", { type: "button", text: t("action.startOver"), onclick: function (ev) { act(ev.currentTarget, startOver); } }));
    p.appendChild(a);
    add(p, labelBox(o));
    p.appendChild(summaryCard(o));
    p.appendChild(el("div", { class: "card" }, [el("h3", { text: t("timeline.title") }), timeline(o)]));
    add(p, reliability());
    if (o.anomalies.length) {
      var box = el("div", { class: "error" }, [el("strong", { text: t("anomalies.title") })]);
      o.anomalies.forEach(function (x) {
        var m = /ignored: (\w+)/.exec(x);
        box.appendChild(el("div", { text: m ? label("anomaly", m[1]) : t("anomaly.generic") }));
      });
      p.appendChild(box);
    }
    return p;
  }

  function timeline(o) {
    var ol = el("ol", { class: "timeline" });
    o.history.forEach(function (x) {
      ol.appendChild(el("li", { text: fmtTime(x.at) + " " + label("state", x.from) + " → " + label("state", x.to) + " (" + label("event", x.event) + ")" }));
    });
    return ol;
  }

  function startOver() {
    clearTimers();
    var catalog = state.catalog, view = state.view;
    state = fresh();
    state.catalog = catalog; state.view = view;
    state.qty[catalog.products[0].sku] = 1;
    openLog = {};
    renderLog(true);
    showError("");
    ensureVisible($("steps"));
    return refreshQuote();
  }

  function render() {
    renderSteps();
    var panel = $("panel");
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
    renderLog(true);
    render();
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-lang]"), function (b) {
    b.addEventListener("click", function () { setLang(b.getAttribute("data-lang")); });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".tabs [data-view]"), function (b) {
    b.addEventListener("click", function () { setView(b.getAttribute("data-view")); });
  });
  $("start").addEventListener("click", function () {
    setView("shop");
    $("demo").scrollIntoView({ block: "start" });
  });
  applyStatic();
  renderSteps();
  renderLog(true);

  api("/api/catalog").then(function (c) { state.catalog = c; state.qty[c.products[0].sku] = 1; return refreshQuote(); }).catch(fail);
})();
`;

/** Client script with the dictionaries, the money formatter and the card helpers embedded. */
export const APP_JS = CLIENT_JS
  .replace("__I18N__", () => JSON.stringify(DICTIONARIES))
  .replace("__MONEY__", () => JSON.stringify(MONEY_FORMATS))
  .replace("__CARDS__", () => JSON.stringify(TEST_CARDS))
  .replace("__BLIK_DELAY__", () => String(BLIK_DELAY_SECONDS))
  .replace("__BANK_DELAY__", () => String(BANK_DELAY_MS))
  .replace("__FORMAT_MONEY__", () => FORMAT_MONEY_SOURCE)
  .replace("__LUHN__", () => LUHN_SOURCE);
