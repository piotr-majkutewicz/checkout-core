import type { CartLine, ShippingRule, Discount } from "../cart.js";
import type { Parcel } from "../shipping/types.js";

/** Demo products. Prices and VAT rates are illustrative, not tax advice. */
export interface Product extends Omit<CartLine, "quantity"> {
  description: string;
  parcel: Parcel;
}

export const PRODUCTS: readonly Product[] = [
  { sku: "MUG-01", name: "Ceramic mug", description: "350 ml, dishwasher safe", unitGross: 4999, vatRate: 23, parcel: { lengthMm: 120, widthMm: 120, heightMm: 110, weightG: 400 } },
  { sku: "BOOK-01", name: "Hardcover book", description: "Reduced VAT rate example (5%)", unitGross: 3990, vatRate: 5, parcel: { lengthMm: 240, widthMm: 160, heightMm: 30, weightG: 700 } },
  { sku: "TEA-01", name: "Loose leaf tea, 100 g", description: "Food example (8%)", unitGross: 1999, vatRate: 8, parcel: { lengthMm: 150, widthMm: 100, heightMm: 60, weightG: 150 } },
  { sku: "LAMP-01", name: "Desk lamp", description: "Bulky enough to need a bigger locker", unitGross: 18900, vatRate: 23, parcel: { lengthMm: 600, widthMm: 250, heightMm: 120, weightG: 2200 } },
];

export const SHIPPING_RULE: ShippingRule = { kind: "flat", price: 1299, freeFrom: 20000 };

export const DISCOUNT_CODES: Record<string, Discount> = {
  SAVE10: { kind: "percent", basisPoints: 1000 },
  MINUS20: { kind: "amount", amount: 2000 },
};

/**
 * Naive parcel estimate: footprint of the biggest item, heights stacked, weights added.
 * Real packing is a separate problem and is out of scope for this demo.
 */
export function estimateParcel(items: ReadonlyArray<{ product: Product; quantity: number }>): Parcel {
  let length = 0;
  let width = 0;
  let height = 0;
  let weight = 0;
  for (const { product, quantity } of items) {
    length = Math.max(length, product.parcel.lengthMm);
    width = Math.max(width, product.parcel.widthMm);
    height += product.parcel.heightMm * quantity;
    weight += product.parcel.weightG * quantity;
  }
  return { lengthMm: length, widthMm: width, heightMm: height, weightG: weight };
}
