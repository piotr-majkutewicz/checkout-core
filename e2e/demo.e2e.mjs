// End-to-end checks of the demo UI with a real browser (Playwright).
//
//   npm run e2e                      starts `wrangler dev` itself on E2E_PORT (default 8941)
//   E2E_BASE_URL=http://... npm run e2e   uses a server that is already running
//
// Browsers must be installed for Playwright (`npx playwright install chromium`), or
// PLAYWRIGHT_BROWSERS_PATH must point at an existing install.
import { spawn } from "node:child_process";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chromium, devices } from "playwright";

const PORT = process.env.E2E_PORT ?? "8941";
const BASE = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

let server;
let browser;
let ipCounter = 0;

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE + "/robots.txt")).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start");
}

before(async () => {
  if (!process.env.E2E_BASE_URL) {
    server = spawn("npx", ["wrangler", "dev", "--port", PORT, "--ip", "127.0.0.1"], { stdio: "ignore", detached: true });
  }
  await waitForServer();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  // Only the process this script started is stopped.
  if (server) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
});

/** A fresh context. The demo's rate limit is per IP, so every context pretends to be a different client. */
async function newContext(options = {}) {
  ipCounter++;
  return browser.newContext({ ...options, extraHTTPHeaders: { "cf-connecting-ip": `10.9.${process.pid % 200}.${ipCounter}` } });
}

/* ------------------------------------------------------------------ Polish text check */

// Typical English words and phrases that must not appear in the Polish UI.
const ENGLISH = /\b(total|order|status|payment|shipping|shipment|cart|confirm|confirmation|pending|paid|error|locker|back|continue|place order|refund|refunded|tracking|delivery|discount|goods|start over|success|failed|declined|waiting|processing|approve|reject|shipped|picked up|behind the scenes|shop|customer|the|and|your|with|you|please|try|name|number|expiry|card number|bank transfer|notification|signature|duplicate|rejected|ignored|result)\b/i;
// Words that are deliberately kept as they are in the Polish UI.
const ALLOWED = [/BLIK/g, /JSON/g, /HMAC-SHA256/g, /HMAC/g, /3-D Secure/g, /webhook/gi, /VAT/g, /CVC/g, /PLN/g, /checkout-core/gi, /English/g];

function findEnglish(text) {
  let rest = text;
  for (const a of ALLOWED) rest = rest.replace(a, " ");
  const hits = new Set();
  for (const m of rest.matchAll(new RegExp(ENGLISH.source, "gi"))) hits.add(m[0].toLowerCase());
  return [...hits];
}

/** Everything a visitor sees or hears: rendered text (raw JSON in closed blocks is not rendered) and accessible names. */
async function visibleText(page) {
  return page.evaluate(() => {
    const parts = [document.title, document.body.innerText];
    for (const n of document.querySelectorAll("[aria-label],[placeholder],[title],[alt]")) {
      for (const a of ["aria-label", "placeholder", "title", "alt"]) if (n.getAttribute(a)) parts.push(n.getAttribute(a));
    }
    return parts.join("\n");
  });
}

describe("Polish UI contains no English texts", () => {
  it("walks the whole shopping path in Polish", async () => {
    // The browser asks for English; the demo must still start in Polish.
    const ctx = await newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && !/status of 400/.test(m.text()) && errors.push(m.text())); // the deliberate bad locker code makes the browser log one 400
    const checked = [];
    const check = async (name) => {
      const text = await visibleText(page);
      checked.push(name);
      assert.deepEqual(findEnglish(text), [], `English text on "${name}"`);
      return text;
    };

    await page.goto(BASE + "/");
    await page.waitForSelector("#panel h3");
    assert.equal(await page.evaluate(() => document.documentElement.lang), "pl");
    await check("intro and cart");

    // Cart: discount code, then every payment method with its special screens.
    await page.fill("input[type=text]", "SAVE10");
    await page.locator("input[type=text]").first().dispatchEvent("change");
    await page.waitForSelector(".card .row strong.price");
    await check("cart with discount");
    await page.click("button.primary:has-text('Przejdź do płatności')");
    await check("payment BLIK");
    await page.fill("#blik", "12");
    await page.click("button.primary:has-text('Przejdź do paczkomatu')");
    await check("BLIK error");
    await page.fill("#blik", "123456");
    await page.click("label.opt:has-text('Karta')");
    await check("payment card");
    await page.click("button.primary:has-text('Przejdź do paczkomatu')");
    await check("card error (empty number)");
    await page.click("button:has-text('wymaga 3-D Secure')");
    await page.click("label.opt:has-text('Przelew')");
    await check("payment transfer");
    await page.click("label.opt:has-text('Karta')");
    await page.click("button:has-text('wymaga 3-D Secure')");
    await page.click("button.primary:has-text('Przejdź do paczkomatu')");
    await check("locker");
    await page.fill("#locker-code", "zzz");
    await page.click("button.primary:has-text('Złóż zamówienie')");
    await page.waitForSelector("#error:not([hidden])");
    await check("locker error");
    await page.click("label.opt:has-text('WAW123M')");
    await page.click("button.primary:has-text('Złóż zamówienie')");

    // 3-D Secure screen, then approve.
    await page.waitForSelector("text=Symulowany ekran 3-D Secure");
    await check("3-D Secure screen");
    await page.click("button:has-text('Zatwierdź')");
    await page.waitForSelector(".badge:has-text('opłacone')");
    await check("paid order with summary");
    await page.click("button:has-text('Wyślij to samo powiadomienie jeszcze raz')");
    await page.waitForSelector("text=rozpoznano duplikat");
    await page.click("button:has-text('Wyślij powiadomienie z błędnym podpisem')");
    await page.waitForSelector("text=odrzucone kodem 401");
    await page.click("button:has-text('Wyślij powiadomienie spóźnione')");
    await page.waitForSelector("text=pominięte jako nieaktualne");
    await check("reliability results and anomaly");
    await page.click("button.primary:has-text('Wyślij do paczkomatu')");
    await page.waitForSelector("pre:has-text('Etykieta przesyłki')");
    await check("shipped with label");
    await page.click("button.primary:has-text('Oznacz jako odebrane')");
    await page.waitForSelector(".badge:has-text('odebrane')");
    const done = await check("picked up with withdrawal period");
    assert.match(done, /to nie jest porada prawna/);
    await page.click("button:has-text('Poproś o zwrot pieniędzy')");
    await page.waitForSelector(".badge:has-text('zwrócone')");
    await check("refunded");

    // The log is Polish too, and the raw JSON stays available.
    const log = await page.locator("#log").innerText();
    assert.deepEqual(findEnglish(log), []);
    assert.ok((await page.locator("#log li").count()) > 15);
    await page.locator("#log summary").first().click();
    assert.match(await page.locator("#log pre").first().innerText(), /"lines"/);

    // Other flows: BLIK countdown, declined BLIK, bank transfer.
    await page.click("button:has-text('Zacznij od nowa')");
    await page.waitForSelector("#panel h3:has-text('Koszyk')");
    await page.click("button.primary:has-text('Przejdź do płatności')");
    await page.fill("#blik", "222222");
    await page.click("button.primary:has-text('Przejdź do paczkomatu')");
    await page.click("label.opt:has-text('WAW123M')");
    await page.click("button.primary:has-text('Złóż zamówienie')");
    await page.waitForSelector("#countdown");
    await check("BLIK countdown");
    await page.waitForSelector(".badge:has-text('opłacone')", { timeout: 15000 });

    await page.click("button:has-text('Zacznij od nowa')");
    await page.waitForSelector("#panel h3:has-text('Koszyk')");
    await page.click("button.primary:has-text('Przejdź do płatności')");
    await page.fill("#blik", "111111");
    await page.click("button.primary:has-text('Przejdź do paczkomatu')");
    await page.click("label.opt:has-text('WAW123M')");
    await page.click("button.primary:has-text('Złóż zamówienie')");
    await page.waitForSelector(".badge:has-text('płatność odrzucona')");
    await check("declined BLIK");

    await page.click("button:has-text('Zacznij od nowa')");
    await page.waitForSelector("#panel h3:has-text('Koszyk')");
    await page.click("button.primary:has-text('Przejdź do płatności')");
    await page.click("label.opt:has-text('Przelew')");
    await page.click("button.primary:has-text('Przejdź do paczkomatu')");
    await page.click("label.opt:has-text('WAW123M')");
    await page.click("button.primary:has-text('Złóż zamówienie')");
    await page.waitForSelector("#bank-confirm");
    await check("bank screen");
    await page.click("#bank-confirm");
    await page.waitForSelector("text=Bank przetwarza przelew");
    await check("bank processing");
    await page.waitForSelector(".badge:has-text('opłacone')", { timeout: 10000 });

    assert.ok(checked.length >= 15, "checked many screens");
    assert.deepEqual(errors, [], "no console errors");
    await ctx.close();
  });

  it("detector catches English (self-test)", () => {
    assert.deepEqual(findEnglish("Order total and BLIK"), ["order", "total", "and"]);
    assert.deepEqual(findEnglish("Zamówienie opłacone, BLIK, webhook, 3-D Secure, VAT"), []);
  });
});

describe("English UI works too", () => {
  it("switches language, keeps the log and shows no Polish chrome", async () => {
    const ctx = await newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + "/");
    await page.waitForSelector("#panel h3");
    await page.click("button[data-lang=en]");
    await page.waitForSelector("#panel h3:has-text('Cart')");
    const text = await visibleText(page);
    assert.doesNotMatch(text, /Koszyk|Płatność|Za kulisami|Zacznij/);
    assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
    assert.match(await page.locator("#log").innerText(), /Cart priced/);
    await ctx.close();
  });
});

/* ------------------------------------------------------------------ mobile */

const PHONE = devices["iPhone 13"];

async function swipe(cdp, x, fromY, toY) {
  const steps = 10;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: fromY }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: fromY + ((toY - fromY) * i) / steps }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await new Promise((r) => setTimeout(r, 400));
}

describe("mobile (iPhone 13)", () => {
  it("does not overflow horizontally, scrolls by touch both ways and keeps touch targets large on every step", async () => {
    const ctx = await newContext({ ...PHONE });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(BASE + "/");
    await page.waitForSelector("#panel h3");

    const report = [];
    async function checkScreen(name) {
      const m = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth, iw: window.innerWidth, h: document.documentElement.scrollHeight, ih: window.innerHeight,
        small: [...document.querySelectorAll("button,input:not([type=radio]),summary,a,label.opt")]
          .filter((n) => n.offsetParent !== null)
          .map((n) => ({ n, r: n.getBoundingClientRect() }))
          .filter(({ r }) => r.height < 43.5)
          .map(({ n, r }) => `${n.tagName} "${(n.textContent || n.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(r.height)}px`),
        fixed: [...document.querySelectorAll("*")].filter((n) => getComputedStyle(n).position === "fixed").length,
        bodyOverflow: getComputedStyle(document.body).overflow + "/" + getComputedStyle(document.documentElement).overflow,
      }));
      assert.ok(m.sw <= m.iw, `${name}: scrollWidth ${m.sw} > innerWidth ${m.iw}`);
      assert.deepEqual(m.small, [], `${name}: touch targets under 44px`);
      assert.equal(m.fixed, 0, `${name}: fixed elements`);
      assert.match(m.bodyOverflow, /^visible\/visible$/, `${name}: overflow`);
      assert.ok(m.h > m.ih + 100, `${name}: page too short to scroll (${m.h} vs ${m.ih})`);
      // Real touch swipes: finger up scrolls down, finger down scrolls back up.
      await page.evaluate(() => window.scrollTo(0, 0));
      await swipe(cdp, 200, 650, 250);
      const down = await page.evaluate(() => window.scrollY);
      assert.ok(down > 100, `${name}: swipe down did not scroll (${down})`);
      await swipe(cdp, 200, 250, 650);
      const up = await page.evaluate(() => window.scrollY);
      assert.ok(up < down, `${name}: swipe back up did not scroll up (${down} -> ${up})`);
      report.push(`${name}: width ${m.sw}/${m.iw}, scrolled ${down} then ${up}`);
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    await checkScreen("cart");
    await page.click("button.primary:has-text('Przejdź do płatności')");
    await checkScreen("payment BLIK");

    // Re-rendering the panel must not move the page.
    const karta = page.locator("label.opt:has-text('Karta')");
    await karta.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 40));
    const before = await page.evaluate(() => window.scrollY);
    await karta.click();
    await page.waitForSelector("#card-number");
    const after = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(after - before) <= 1, `scroll jumped on re-render: ${before} -> ${after}`);
    await checkScreen("payment card");
    await page.click("button:has-text('wymaga 3-D Secure')");
    await page.click("button.primary:has-text('Przejdź do paczkomatu')");
    await checkScreen("locker");
    await page.click("label.opt:has-text('WAW123M')");
    await page.click("button.primary:has-text('Złóż zamówienie')");
    await page.waitForSelector("text=Symulowany ekran 3-D Secure");
    await checkScreen("3-D Secure");
    await page.click("button:has-text('Zatwierdź')");
    await page.waitForSelector(".badge:has-text('opłacone')");
    await checkScreen("confirmation");

    // A log update caused by a button far down the page must not move the page either.
    const again = page.locator("button:has-text('Wyślij to samo powiadomienie jeszcze raz')");
    await again.scrollIntoViewIfNeeded();
    const bottom = await page.evaluate(() => window.scrollY);
    await again.click();
    await page.waitForSelector("text=rozpoznano duplikat");
    const bottomAfter = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(bottomAfter - bottom) <= 1, `scroll moved after reliability demo: ${bottom} -> ${bottomAfter}`);

    // "Behind the scenes" is one tap away and does not overflow either.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click(".tabs button[data-view=backstage]");
    await page.waitForSelector("#log li");
    await checkScreen("behind the scenes");
    assert.deepEqual(errors, []);
    console.log(report.join("\n"));
    await ctx.close();
  });
});
