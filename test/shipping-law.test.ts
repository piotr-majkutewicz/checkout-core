import { describe, expect, it } from "vitest";
import { DEFAULT_WITHDRAWAL_CONFIG, isWithinWithdrawalPeriod, withdrawalLastDay } from "../src/consumer-law.js";
import { MockShippingProvider } from "../src/shipping/mock.js";
import { EXAMPLE_SIZE_CONFIG, fitParcel } from "../src/shipping/parcel.js";
import { EXAMPLE_LOCKER_CODE_PATTERN, validateLockerCode } from "../src/shipping/locker-code.js";
import { ShippingError } from "../src/shipping/types.js";

const recipient = { name: "Jan Kowalski", phone: "+48500100200", email: "jan@example.com" };
const small = { lengthMm: 200, widthMm: 150, heightMm: 50, weightG: 500 };

describe("locker code validation (example pattern)", () => {
  it("accepts the example shape and normalises", () => {
    expect(validateLockerCode("WAW123M")).toEqual({ valid: true, code: "WAW123M" });
    expect(validateLockerCode("  waw12m ")).toEqual({ valid: true, code: "WAW12M" });
    expect(validateLockerCode("KRK045AB")).toEqual({ valid: true, code: "KRK045AB" });
  });
  it("rejects other shapes", () => {
    for (const bad of ["", "   ", "WA123M", "WAW1M", "WAW1234M", "WAW123", "WAW123MMM", "123WAWM", "WAW 123M", "WAW-123M"]) {
      expect(validateLockerCode(bad).valid, bad).toBe(false);
    }
  });
  it("accepts a custom pattern", () => {
    expect(validateLockerCode("12345", /^\d{5}$/)).toEqual({ valid: true, code: "12345" });
    expect(EXAMPLE_LOCKER_CODE_PATTERN.test("WAW123M")).toBe(true);
  });
});

describe("fitParcel (example size classes)", () => {
  it("picks the smallest fitting class", () => {
    expect(fitParcel(small)).toEqual({ fits: true, sizeClass: "A" });
    expect(fitParcel({ ...small, heightMm: 81 })).toEqual({ fits: true, sizeClass: "B" });
    expect(fitParcel({ lengthMm: 600, widthMm: 370, heightMm: 191, weightG: 500 })).toEqual({ fits: true, sizeClass: "C" });
  });
  it("treats limits as inclusive", () => {
    expect(fitParcel({ lengthMm: 640, widthMm: 380, heightMm: 80, weightG: 25000 })).toEqual({ fits: true, sizeClass: "A" });
    expect(fitParcel({ lengthMm: 641, widthMm: 380, heightMm: 80, weightG: 100 }).fits).toBe(false);
  });
  it("allows rotation of the parcel", () => {
    expect(fitParcel({ lengthMm: 100, widthMm: 640, heightMm: 300, weightG: 100 })).toEqual({ fits: true, sizeClass: "B" });
  });
  it("rejects overweight and oversize", () => {
    expect(fitParcel({ ...small, weightG: 25001 }).fits).toBe(false);
    expect(fitParcel({ lengthMm: 700, widthMm: 700, heightMm: 700, weightG: 1 }).fits).toBe(false);
  });
  it("rejects invalid dimensions", () => {
    expect(() => fitParcel({ ...small, lengthMm: 0 })).toThrow(ShippingError);
    expect(() => fitParcel({ ...small, widthMm: 10.5 })).toThrow(ShippingError);
  });
  it("works with a custom config", () => {
    const cfg = { classes: [{ code: "X", lengthMm: 100, widthMm: 100, heightMm: 100 }], maxWeightG: 1000 };
    expect(fitParcel({ lengthMm: 100, widthMm: 100, heightMm: 100, weightG: 1000 }, cfg)).toEqual({ fits: true, sizeClass: "X" });
    expect(fitParcel(small, cfg).fits).toBe(false);
    expect(EXAMPLE_SIZE_CONFIG.classes).toHaveLength(3);
  });
});

describe("MockShippingProvider", () => {
  it("creates a shipment with a tracking number and label", async () => {
    const p = new MockShippingProvider();
    const s1 = await p.createShipment({ orderId: "o1", lockerCode: "waw123m", parcel: small, recipient });
    const s2 = await p.createShipment({ orderId: "o2", lockerCode: "KRK045A", parcel: small, recipient });
    expect(s1.trackingNumber).toBe("MOCK0000000001");
    expect(s2.trackingNumber).toBe("MOCK0000000002");
    expect(s1.sizeClass).toBe("A");
    expect(s1.label.content).toContain("WAW123M");
  });
  it("looks up lockers", async () => {
    const p = new MockShippingProvider();
    expect((await p.getLocker("WAW123M"))?.city).toBe("Warsaw");
    expect(await p.getLocker("ZZZ999Z")).toBeNull();
    expect(await p.getLocker("garbage")).toBeNull();
  });
  it("fails with typed errors", async () => {
    const p = new MockShippingProvider();
    const code = async (lockerCode: string, parcel = small) =>
      p.createShipment({ orderId: "o", lockerCode, parcel, recipient }).catch((e: ShippingError) => e.code);
    expect(await code("bad")).toBe("invalid_locker_code");
    expect(await code("ZZZ999Z")).toBe("unknown_locker");
    expect(await code("WAW123M", { ...small, weightG: 99999 })).toBe("parcel_too_large");
    // GDA010N only supports A and B in the mock data
    expect(await code("GDA010N", { lengthMm: 600, widthMm: 370, heightMm: 300, weightG: 500 })).toBe("parcel_too_large");
  });
});

describe("withdrawal period", () => {
  it("is 14 days after receipt by default", () => {
    expect(DEFAULT_WITHDRAWAL_CONFIG.days).toBe(14);
    expect(withdrawalLastDay("2026-03-01T12:00:00Z")).toBe("2026-03-15");
  });
  it("rolls over months and years", () => {
    expect(withdrawalLastDay("2026-01-25T12:00:00Z")).toBe("2026-02-08");
    expect(withdrawalLastDay("2026-12-25T12:00:00Z")).toBe("2027-01-08");
  });
  it("handles leap years", () => {
    expect(withdrawalLastDay("2028-02-20T12:00:00Z")).toBe("2028-03-05");
    expect(withdrawalLastDay("2026-02-20T12:00:00Z")).toBe("2026-03-06");
  });
  it("uses the Warsaw calendar day, including around midnight and DST", () => {
    // 22:30 UTC on 28 March 2026 is 23:30 in Warsaw (still winter time): same day
    expect(withdrawalLastDay("2026-03-28T22:30:00Z")).toBe("2026-04-11");
    // 23:30 UTC is 00:30 on the 29th (DST starts that night)
    expect(withdrawalLastDay("2026-03-28T23:30:00Z")).toBe("2026-04-12");
  });
  it("supports a configurable length", () => {
    const cfg = { days: 30, timeZone: "Europe/Warsaw" };
    expect(withdrawalLastDay("2026-03-01T12:00:00Z", cfg)).toBe("2026-03-31");
    expect(withdrawalLastDay("2026-03-01T12:00:00Z", { ...cfg, days: 0 })).toBe("2026-03-01");
    expect(() => withdrawalLastDay("2026-03-01T12:00:00Z", { ...cfg, days: -1 })).toThrow();
    expect(() => withdrawalLastDay("2026-03-01T12:00:00Z", { ...cfg, days: 1.5 })).toThrow();
  });
  it("checks whether a date is still within the period", () => {
    const received = "2026-04-01T10:00:00Z";
    expect(isWithinWithdrawalPeriod(received, "2026-04-01T10:00:00Z")).toBe(true);
    expect(isWithinWithdrawalPeriod(received, "2026-04-15T21:59:00Z")).toBe(true); // 23:59 Warsaw (CEST)
    expect(isWithinWithdrawalPeriod(received, "2026-04-15T22:00:00Z")).toBe(false); // 00:00 on the 16th
    expect(isWithinWithdrawalPeriod(received, "2026-03-31T10:00:00Z")).toBe(false); // before receipt
  });
  it("rejects invalid dates", () => {
    expect(() => withdrawalLastDay("not a date")).toThrow();
  });
});
