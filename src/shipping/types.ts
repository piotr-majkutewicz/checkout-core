/** Parcel dimensions in millimetres and weight in grams. */
export interface Parcel {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightG: number;
}

export interface LockerPoint {
  code: string;
  name: string;
  city: string;
  address: string;
  /** Largest parcel size class this locker can take. */
  supportedSizes: string[];
}

export interface Recipient {
  name: string;
  phone: string;
  email: string;
}

export interface CreateShipmentRequest {
  orderId: string;
  lockerCode: string;
  parcel: Parcel;
  recipient: Recipient;
}

export interface Shipment {
  trackingNumber: string;
  sizeClass: string;
  label: { format: "text"; content: string };
}

export type ShippingErrorCode = "invalid_locker_code" | "unknown_locker" | "parcel_too_large" | "invalid_parcel";

export class ShippingError extends Error {
  constructor(
    readonly code: ShippingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ShippingError";
  }
}

export interface ShippingProvider {
  /** Returns the locker (paczkomat, parcel locker) with this code, or null if it does not exist. */
  getLocker(code: string): Promise<LockerPoint | null>;
  createShipment(request: CreateShipmentRequest): Promise<Shipment>;
}
