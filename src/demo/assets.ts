// Static assets of the demo UI, inlined so the Worker needs no asset pipeline and no CDN.
// The client script never uses innerHTML: all dynamic text goes through textContent.

export const INDEX_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>checkout-core demo</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="top">
  <div class="wrap">
    <h1>checkout-core</h1>
    <p class="muted">Demo of a checkout core with Polish market specifics: BLIK, parcel lockers (paczkomaty), VAT rates, 14-day withdrawal. Mock payment and shipping providers, in-memory state.</p>
  </div>
</header>
<main class="wrap">
  <ol class="steps" id="steps"></ol>
  <section id="panel" aria-live="polite"></section>
  <p id="error" class="error" role="alert" hidden></p>
</main>
<footer class="wrap muted small">Demo only. Nothing here is a real payment, and nothing is legal or tax advice.</footer>
<script src="/app.js" defer></script>
</body>
</html>
`;

export const STYLE_CSS = String.raw`:root{--bg:#14110f;--fg:#f2ebdd;--muted:#a99f90;--line:#2f2823;--line2:#4a4038;--accent:#ef4444;--card:#1b1714}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:0 16px}
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

export const APP_JS = String.raw`(function () {
  "use strict";
  var STEPS = ["Cart", "Payment", "Locker", "Confirmation"];
  var state = { step: 0, catalog: null, qty: {}, discount: "", method: "blik", blik: "123456", locker: "", quote: null, order: null, extra: null };

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

  function pln(g) {
    var neg = g < 0; g = Math.abs(g);
    var z = String(Math.floor(g / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    var r = String(g % 100); if (r.length < 2) r = "0" + r;
    return (neg ? "-" : "") + z + "," + r + " zł";
  }

  function showError(msg) {
    var e = document.getElementById("error");
    e.textContent = msg || ""; e.hidden = !msg;
  }

  function api(path, method, body) {
    return fetch(path, { method: method || "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Request failed"); return d; }); });
  }

  function items() {
    return Object.keys(state.qty).filter(function (s) { return state.qty[s] > 0; }).map(function (s) { return { sku: s, quantity: state.qty[s] }; });
  }

  function renderSteps() {
    var ol = document.getElementById("steps");
    ol.textContent = "";
    STEPS.forEach(function (name, i) {
      ol.appendChild(el("li", { class: i === state.step ? "active" : i < state.step ? "done" : "", text: (i + 1) + ". " + name }));
    });
  }

  function totalsCard(q) {
    var card = el("div", { class: "card" });
    function line(label, value) { card.appendChild(el("div", { class: "row" }, [el("span", { class: "grow", text: label }), el("span", { class: "price", text: value })])); }
    line("Goods", pln(q.itemsGross));
    if (q.discountTotal > 0) line("Discount", "-" + pln(q.discountTotal));
    line("Delivery to locker", q.shippingGross === 0 ? "free" : pln(q.shippingGross));
    q.vat.forEach(function (v) { line("of which VAT " + v.rate + "% (net " + pln(v.net) + ")", pln(v.vat)); });
    card.appendChild(el("div", { class: "row" }, [el("strong", { class: "grow", text: "Total (gross)" }), el("strong", { class: "price", text: pln(q.totalGross) })]));
    return card;
  }

  function refreshQuote() {
    if (items().length === 0) { state.quote = null; render(); return Promise.resolve(); }
    return api("/api/quote", "POST", { items: items(), discountCode: state.discount }).then(function (q) { state.quote = q; showError(""); render(); })
      .catch(function (e) { state.quote = null; showError(e.message); render(); });
  }

  function viewCart() {
    var p = el("div");
    p.appendChild(el("h2", { text: "Cart" }));
    var card = el("div", { class: "card" });
    state.catalog.products.forEach(function (prod) {
      var input = el("input", { type: "number", min: "0", max: "99", value: String(state.qty[prod.sku] || 0), "aria-label": "Quantity of " + prod.name });
      input.addEventListener("change", function () { state.qty[prod.sku] = Math.max(0, Math.min(99, parseInt(input.value, 10) || 0)); refreshQuote(); });
      card.appendChild(el("div", { class: "row" }, [
        el("div", { class: "grow" }, [el("div", { text: prod.name }), el("div", { class: "muted small", text: prod.description + ", VAT " + prod.vatRate + "%" })]),
        el("span", { class: "price", text: pln(prod.unitGross) }), input
      ]));
    });
    p.appendChild(card);
    var code = el("input", { type: "text", placeholder: "Discount code", value: state.discount, "aria-label": "Discount code" });
    code.addEventListener("change", function () { state.discount = code.value; refreshQuote(); });
    p.appendChild(el("div", { class: "card" }, [code, el("span", { class: "muted small", text: " Try: " + state.catalog.discountCodes.join(", ") })]));
    if (state.quote) p.appendChild(totalsCard(state.quote));
    p.appendChild(el("div", { class: "actions" }, [el("button", { class: "primary", text: "Continue to payment", disabled: state.quote ? null : "disabled", onclick: function () { state.step = 1; render(); } })]));
    return p;
  }

  function radio(name, value, title, hint, checked, onChange) {
    var input = el("input", { type: "radio", name: name, value: value });
    if (checked) input.checked = true;
    input.addEventListener("change", onChange);
    return el("label", { class: "opt" + (checked ? " sel" : "") }, [input, el("span", {}, [el("strong", { text: title }), el("div", { class: "muted small", text: hint })])]);
  }

  function viewPayment() {
    var p = el("div");
    p.appendChild(el("h2", { text: "Payment" }));
    var methods = [
      ["blik", "BLIK", "6-digit code from your banking app. Mock codes: 222222 is declined, 333333 is delayed, anything else succeeds."],
      ["card", "Card", "Mock redirect to a fake 3-D Secure page. Always succeeds."],
      ["transfer", "Bank transfer", "Asynchronous: stays pending until you confirm it on the last step."]
    ];
    methods.forEach(function (m) { p.appendChild(radio("method", m[0], m[1], m[2], state.method === m[0], function () { state.method = m[0]; render(); })); });
    if (state.method === "blik") {
      var b = el("input", { type: "text", inputmode: "numeric", maxlength: "6", value: state.blik, "aria-label": "BLIK code" });
      b.addEventListener("input", function () { state.blik = b.value; });
      p.appendChild(el("div", { class: "card" }, [el("label", { text: "BLIK code " }, [b])]));
    }
    p.appendChild(el("div", { class: "actions" }, [
      el("button", { text: "Back", onclick: function () { state.step = 0; render(); } }),
      el("button", { class: "primary", text: "Continue to locker", onclick: function () {
        if (state.method === "blik" && !/^\d{6}$/.test(state.blik)) { showError("BLIK code must be 6 digits"); return; }
        showError(""); state.step = 2; render(); } })
    ]));
    return p;
  }

  function viewLocker() {
    var p = el("div");
    p.appendChild(el("h2", { text: "Parcel locker (paczkomat)" }));
    p.appendChild(el("p", { class: "muted", text: "Pick a mock locker or type a code. The code format check is an example pattern, not an official carrier specification." }));
    state.catalog.lockers.forEach(function (l) {
      p.appendChild(radio("locker", l.code, l.code + " " + l.name, l.city, state.locker === l.code, function () { state.locker = l.code; render(); }));
    });
    var c = el("input", { type: "text", value: state.locker, maxlength: "10", "aria-label": "Locker code", placeholder: "e.g. WAW123M" });
    c.addEventListener("input", function () { state.locker = c.value; });
    p.appendChild(el("div", { class: "card" }, [el("label", { text: "Locker code " }, [c])]));
    if (state.quote) p.appendChild(totalsCard(state.quote));
    p.appendChild(el("div", { class: "actions" }, [
      el("button", { text: "Back", onclick: function () { state.step = 1; render(); } }),
      el("button", { class: "primary", text: "Place order", onclick: placeOrder })
    ]));
    return p;
  }

  function placeOrder() {
    api("/api/orders", "POST", { items: items(), discountCode: state.discount, method: state.method, blikCode: state.blik, lockerCode: state.locker })
      .then(function (d) { state.order = d.order; state.extra = null; showError(""); state.step = 3; render(); })
      .catch(function (e) { showError(e.message); });
  }

  function orderAction(path, label, primary) {
    return el("button", { class: primary ? "primary" : "", text: label, onclick: function () {
      api("/api/orders/" + state.order.id + path, "POST").then(function (d) {
        state.order = d.order; state.extra = d; showError(""); render();
      }).catch(function (e) { showError(e.message); });
    } });
  }

  function viewConfirm() {
    var o = state.order;
    var p = el("div");
    p.appendChild(el("h2", { text: "Order " + o.id }));
    var good = o.state === "paid" || o.state === "shipped" || o.state === "fulfilled";
    var bad = o.state === "payment_failed" || o.state === "cancelled";
    p.appendChild(el("div", { class: "card" }, [
      el("div", { class: "row" }, [el("span", { class: "grow", text: "Status" }), el("span", { class: "badge " + (good ? "ok" : bad ? "bad" : ""), text: o.state })]),
      el("div", { class: "row" }, [el("span", { class: "grow", text: "Payment" }), el("span", { text: o.paymentMethod + " (" + o.paymentId + ")" })]),
      el("div", { class: "row" }, [el("span", { class: "grow", text: "Locker" }), el("span", { text: o.lockerCode })]),
      o.trackingNumber ? el("div", { class: "row" }, [el("span", { class: "grow", text: "Tracking number" }), el("span", { text: o.trackingNumber })]) : null,
      el("div", { class: "row" }, [el("strong", { class: "grow", text: "Total (gross)" }), el("strong", { class: "price", text: pln(o.totals.totalGross) })])
    ]));
    if (state.extra && state.extra.label) p.appendChild(el("pre", { text: state.extra.label }));
    if (state.extra && state.extra.withdrawal) {
      var w = state.extra.withdrawal;
      p.appendChild(el("p", { class: "muted", text: "Withdrawal period ends on " + w.lastDay + " (" + (w.open ? "still open" : "closed") + "). Illustration only, not legal advice." }));
    }
    var a = el("div", { class: "actions" });
    if (o.state === "awaiting_payment") a.appendChild(orderAction("/settle", "Simulate: payment confirmed", true));
    if (o.state === "paid") a.appendChild(orderAction("/ship", "Ship to locker", true));
    if (o.state === "shipped") a.appendChild(orderAction("/deliver", "Mark as picked up", true));
    if (["paid", "shipped", "fulfilled"].indexOf(o.state) >= 0) a.appendChild(orderAction("/refund", "Request refund"));
    a.appendChild(orderAction("/redeliver", "Replay last webhook (idempotency)"));
    a.appendChild(el("button", { text: "Start over", onclick: function () { state.qty = {}; state.quote = null; state.order = null; state.step = 0; render(); } }));
    p.appendChild(a);
    if (state.extra && state.extra.outcome) p.appendChild(el("p", { class: "muted small", text: "Replay result: " + state.extra.outcome + " (no second effect)." }));
    var h = el("ul", { class: "hist" });
    o.history.forEach(function (x) { h.appendChild(el("li", { text: x.from + " -> " + x.to + " (" + x.event + ")" })); });
    p.appendChild(h);
    if (o.anomalies.length) p.appendChild(el("p", { class: "error", text: o.anomalies.join("; ") }));
    return p;
  }

  function render() {
    renderSteps();
    var panel = document.getElementById("panel");
    panel.textContent = "";
    panel.appendChild([viewCart, viewPayment, viewLocker, viewConfirm][state.step]());
  }

  api("/api/catalog").then(function (c) { state.catalog = c; state.qty[c.products[0].sku] = 1; return refreshQuote(); }).catch(function (e) { showError(e.message); });
})();
`;
