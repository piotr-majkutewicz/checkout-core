/**
 * Test card numbers of the demo. They are made up for this demo and only pass the Luhn check;
 * they belong to no card. The card form runs in the browser and sends nothing but the chosen
 * scenario to the demo API, so no card number ever leaves the page.
 */
export type CardScenario = "success" | "declined" | "three_ds";

export const CARD_SCENARIOS: readonly CardScenario[] = ["success", "declined", "three_ds"];

export const TEST_CARDS: ReadonlyArray<{ number: string; scenario: CardScenario }> = [
  { number: "4242 4242 4242 4242", scenario: "success" },
  { number: "4000 0000 0000 0002", scenario: "declined" },
  { number: "4000 0000 0000 3220", scenario: "three_ds" },
];

/** Luhn check, shipped to the browser as source text so the page and the tests run the same code. */
export const LUHN_SOURCE = `function luhnValid(input) {
  var digits = String(input).replace(/[ -]/g, "");
  if (!/^\\d{12,19}$/.test(digits)) return false;
  var sum = 0;
  for (var i = 0; i < digits.length; i++) {
    var d = Number(digits.charAt(digits.length - 1 - i));
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}`;
