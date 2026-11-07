import { EXAMPLE_LOCKER_CODE_PATTERN, validateLockerCode } from "./locker-code.js";
import { EXAMPLE_SIZE_CONFIG, type SizeConfig, fitParcel } from "./parcel.js";
import {
  type CreateShipmentRequest,
  type LockerPoint,
  type Shipment,
  ShippingError,
  type ShippingProvider,
} from "./types.js";

/** Invented lockers for demos and tests. They do not correspond to real devices. */
export const MOCK_LOCKERS: readonly LockerPoint[] = [
  { code: "WAW123M", name: "Mock locker Warsaw Centre", city: "Warsaw", address: "Example Street 1", supportedSizes: ["A", "B", "C"] },
  { code: "KRK045A", name: "Mock locker Krakow Old Town", city: "Krakow", address: "Example Street 2", supportedSizes: ["A", "B", "C"] },
  { code: "GDA010N", name: "Mock locker Gdansk Port", city: "Gdansk", address: "Example Street 3", supportedSizes: ["A", "B"] },
];

export interface MockShippingOptions {
  lockers?: readonly LockerPoint[];
  sizes?: SizeConfig;
  codePattern?: RegExp;
}

export class MockShippingProvider implements ShippingProvider {
  private counter = 0;
  private readonly lockers: readonly LockerPoint[];
  private readonly sizes: SizeConfig;
  private readonly pattern: RegExp;

  constructor(options: MockShippingOptions = {}) {
    this.lockers = options.lockers ?? MOCK_LOCKERS;
    this.sizes = options.sizes ?? EXAMPLE_SIZE_CONFIG;
    this.pattern = options.codePattern ?? EXAMPLE_LOCKER_CODE_PATTERN;
  }

  async getLocker(code: string): Promise<LockerPoint | null> {
    const check = validateLockerCode(code, this.pattern);
    if (!check.valid) return null;
    return this.lockers.find((l) => l.code === check.code) ?? null;
  }

  async createShipment(request: CreateShipmentRequest): Promise<Shipment> {
    const check = validateLockerCode(request.lockerCode, this.pattern);
    if (!check.valid) throw new ShippingError("invalid_locker_code", check.reason);
    const locker = this.lockers.find((l) => l.code === check.code);
    if (!locker) throw new ShippingError("unknown_locker", `No locker with code ${check.code}`);

    const fit = fitParcel(request.parcel, this.sizes);
    if (!fit.fits) throw new ShippingError("parcel_too_large", fit.reason);
    if (!locker.supportedSizes.includes(fit.sizeClass)) {
      throw new ShippingError("parcel_too_large", `Locker ${locker.code} does not take size ${fit.sizeClass}`);
    }

    const trackingNumber = `MOCK${String(++this.counter).padStart(10, "0")}`;
    const content = [
      "MOCK SHIPPING LABEL (not a real carrier label)",
      `Tracking: ${trackingNumber}`,
      `Order: ${request.orderId}`,
      `Deliver to locker: ${locker.code} (${locker.name})`,
      `Size class: ${fit.sizeClass}`,
      `Recipient: ${request.recipient.name}`,
    ].join("\n");
    return { trackingNumber, sizeClass: fit.sizeClass, label: { format: "text", content } };
  }
}
