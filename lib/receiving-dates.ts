import { DEFAULT_GLOBAL_SHELF_LIFE_DAYS, receivingDate, type Product } from "./wms";
export { DEFAULT_GLOBAL_SHELF_LIFE_DAYS } from "./wms";
export type ReceivingDateResolution = {
  manufacturingDate: string;
  expiry: string;
  source: "product-shelf-life" | "fixed-default" | "global" | "unresolved";
};

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function resolveReceivingDates(
  product: Pick<Product, "defaultManufacturingDate" | "defaultExpiry" | "defaultShelfLifeDays">,
  globalShelfLifeDays = DEFAULT_GLOBAL_SHELF_LIFE_DAYS,
  date = receivingDate(),
): ReceivingDateResolution {
  if (product.defaultShelfLifeDays !== undefined && product.defaultShelfLifeDays > 0)
    return { manufacturingDate: date, expiry: addDays(date, product.defaultShelfLifeDays), source: "product-shelf-life" };

  if (product.defaultExpiry && product.defaultExpiry >= date) {
    const manufacturingDate = product.defaultManufacturingDate && product.defaultManufacturingDate <= date
      ? product.defaultManufacturingDate
      : date;
    if (manufacturingDate <= product.defaultExpiry)
      return { manufacturingDate, expiry: product.defaultExpiry, source: "fixed-default" };
  }

  if (globalShelfLifeDays > 0)
    return { manufacturingDate: date, expiry: addDays(date, globalShelfLifeDays), source: "global" };

  return { manufacturingDate: "", expiry: "", source: "unresolved" };
}
