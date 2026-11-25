export const ORDER_DATE_FIELD = "createdAt" as const;
export const PICK_LIST_SORT = ["productName", "customer", "orderId", "itemNo"] as const;

// Convert ISO date string to browser's LOCAL date string YYYY-MM-DD
export function toLocalDateString(isoString?: string): string {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Format date in exact user-requested style: "Tuesday, November 24, 2026 12:57 AM"
export function formatPickListDate(dayStr?: string): string {
  const now = new Date();
  let baseDate = now;
  if (dayStr && /^\d{4}-\d{2}-\d{2}$/.test(dayStr)) {
    const [y, m, d] = dayStr.split("-").map(Number);
    baseDate = new Date(y, m - 1, d, now.getHours(), now.getMinutes());
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(baseDate);
}

// Deterministic alphabetical sort comparator: product name, then customer name, then order ID, then item #
export function comparePickRowsDefault(
  a: { customer: string; orderId: string; productName: string; barcode?: string; sku?: string },
  b: { customer: string; orderId: string; productName: string; barcode?: string; sku?: string }
): number {
  const c1 = (a.productName || "").localeCompare(b.productName || "", undefined, { numeric: true, sensitivity: "base" });
  if (c1 !== 0) return c1;
  const c2 = (a.customer || "").localeCompare(b.customer || "", undefined, { numeric: true, sensitivity: "base" });
  if (c2 !== 0) return c2;
  const c3 = (a.orderId || "").localeCompare(b.orderId || "", undefined, { numeric: true, sensitivity: "base" });
  if (c3 !== 0) return c3;
  const itemA = a.barcode || a.sku || "";
  const itemB = b.barcode || b.sku || "";
  return itemA.localeCompare(itemB, undefined, { numeric: true, sensitivity: "base" });
}
