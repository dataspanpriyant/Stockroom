export type Role = "Admin" | "Supervisor" | "Operator" | "Viewer";
export const DEFAULT_GLOBAL_SHELF_LIFE_DAYS = 365;
export type Product = {
  id: string;
  name: string;
  category: string;
  barcode: string;
  minimum: number;
  price: number;
  promotion: string;
  unit?: string;
  brand?: string;
  productType?: "Perishable" | "Non-perishable" | "Serialized";
  expiryTracking?: boolean;
  serialTracking?: boolean;
  defaultManufacturingDate?: string;
  defaultExpiry?: string;
  defaultShelfLifeDays?: number;
};
export type SampleProduct = Omit<Product, "minimum" | "price" | "promotion"> & {
  minimum?: number;
  price?: number;
  promotion?: string;
  warehouse?: string;
  batch?: string;
  manufacturingDate?: string;
  expiry?: string;
  sample: true;
};
export type Location = {
  id: string;
  name?: string;
  warehouse: string;
  capacity: number;
  kind: "Storage" | "Pick face";
  zone?: string;
  rack?: string;
  section?: string;
  row?: number;
  column?: number;
  shelf?: number;
  blocked?: boolean;
  assignedProduct?: string;
};
export type Lot = {
  id: string;
  product: string;
  receiptId?: string;
  batch: string;
  expiry: string;
  location: string;
  warehouse?: string;
  qty: number;
  reserved: number;
  putAwayBy?: string;
  putAwayAt?: string;
};
export type Receipt = {
  id: string;
  supplier: string;
  product: string;
  expected: number;
  received: number;
  damaged: number;
  accepted: number;
  batch: string;
  expiry: string;
  status: string;
  grn: string;
  note: string;
  warehouse: string;
  receivingLocation: string;
  purchaseOrder?: string;
  manufacturingDate?: string;
  rejected?: number;
  putAwayBy?: string;
  putAwayAt?: string;
};
export type OrderLine = {
  product: string;
  qty: number;
  picked: number;
  packed: number;
};
export type Order = {
  id: string;
  customer: string;
  product: string;
  qty: number;
  picked: number;
  allocations: { lot: string; product: string; qty: number }[];
  status: string;
  assignee: string;
  weight: number;
  dimensions: string;
  material: string;
  courier: string;
  tracking: string;
  delivery: string;
  orderType: "Customer Order" | "Personal Shop Order";
  warehouse?: string;
  lines: OrderLine[];
  createdBy?: string;
  createdAt?: string;
  pickedBy?: string;
  pickedAt?: string;
  packedBy?: string;
  packedAt?: string;
  dispatchedBy?: string;
  dispatchedAt?: string;
  vehicleNumber?: string;
  receiverStore?: string;
  dispatchNote?: string;
  backordered?: number;
};
export type StoreTransfer = {
  id: string;
  source: string;
  destination: string;
  lines: { product: string; qty: number }[];
  status: "Draft" | "Requested" | "Approved" | "Picked" | "Packed" | "In Transit" | "Dispatched" | "Received" | "Received with Discrepancy" | "Cancelled" | "Rejected";
  requestedBy?: string;
  requestedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  dispatchedBy?: string;
  dispatchedAt: string;
  receivedBy?: string;
  receivedAt: string;
  sourceType?: "Store" | "Warehouse";
  destinationType?: "Store" | "Warehouse";
  sourceWarehouse?: string;
  destinationWarehouse?: string;
  allocations?: { lot: string; product: string; qty: number }[];
  pickedBy?: string;
  pickedAt?: string;
  packedBy?: string;
  packedAt?: string;
  discrepancyReason?: string;
};
export type ReceivingSession = {
  id: string;
  supplier: string;
  warehouse: string;
  receivingLocation: string;
  expected: { product: string; qty: number }[];
  scanned: { product: string; qty: number }[];
  confirmed: boolean;
  step?: "Scan" | "Inspect" | "Confirm";
  scannedBy?: string;
  scannedAt?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  confirmedBy?: string;
  confirmedAt?: string;
};
export type Approval = {
  id: string;
  kind: string;
  lot: string;
  qty: number;
  destination: string;
  reason: string;
  observedQty?: number;
  requestedBy: string;
  status: string;
};
export type User = {
  id: string;
  name: string;
  role: Role;
  password: string;
  active: boolean;
};
export type Event = {
  id: string;
  at: string;
  actor: string;
  action: string;
  reference: string;
  detail: string;
};
export type Sync = {
  id: string;
  system: string;
  key: string;
  status: string;
  detail: string;
  at: string;
  attempts: number;
};
export type State = {
  settings?: {
    receivingDefaultShelfLifeDays?: number;
  };
  rackGrids?: RackGrid[];
  layoutBlocks?: LayoutBlock[];
  layoutSections?: LayoutSection[];
  products: Product[];
  warehouses: { id: string; name: string }[];
  locations: Location[];
  suppliers: { id: string; name: string }[];
  users: User[];
  lots: Lot[];
  receipts: Receipt[];
  orders: Order[];
  approvals: Approval[];
  returns: {
    id: string;
    order: string;
    product?: string;
    qty: number;
    disposition: string;
    reason: string;
  }[];
  events: Event[];
  syncs: Sync[];
  connectors: {
    system: string;
    owner: string;
    direction: string;
    frequency: string;
    enabled: boolean;
  }[];
  purchaseOrders: {
    id: string;
    supplier: string;
    product: string;
    qty: number;
    status?: "Draft" | "Sent" | "Partially received" | "Received" | "Closed";
    receivedQty?: number;
    createdAt?: string;
    sentAt?: string;
    closedAt?: string;
  }[];
  storeStock: { store: string; product: string; qty: number }[];
  stores: { id: string; name: string }[];
  transfers: StoreTransfer[];
  receivingSessions: ReceivingSession[];
  sampleProducts: SampleProduct[];
};
export type Command = Record<string, unknown> & { type: string };
function referencedLotIds(state: Pick<State, "orders" | "transfers" | "returns">) {
  const ids = new Set<string>();
  for (const order of state.orders) for (const allocation of order.allocations) ids.add(allocation.lot);
  for (const transfer of state.transfers) for (const allocation of transfer.allocations || []) ids.add(allocation.lot);
  for (const returnRecord of state.returns) {
    const lot = (returnRecord as { lot?: unknown }).lot;
    if (typeof lot === "string" && lot) ids.add(lot);
  }
  return ids;
}
export function cleanupZeroQuantityLots(state: State) {
  const referenced = referencedLotIds(state);
  const removed: string[] = [];
  const retained: string[] = [];
  state.lots = state.lots.filter((lot) => {
    if (lot.qty !== 0) return true;
    if (referenced.has(lot.id)) { retained.push(lot.id); return true; }
    removed.push(lot.id);
    return false;
  });
  return { removed, retained };
}
export type RackGrid = {
  warehouse: string;
  zone: string;
  rack: string;
  section?: string;
  rows: number;
  columns: number;
  capacity: number;
};
export type LayoutPath = { warehouse: string; zone: string; rack?: string; section?: string; row?: number };
export type LayoutRect = { x: number; y: number; width: number; height: number };
export type LayoutBlock = LayoutRect & { warehouse: string; zone: string; rack?: string };
export type LayoutSection = { warehouse: string; zone: string; rack: string; section: string; rows: number; columns: number; removedRows?: number[]; removedColumns?: number[]; rowNumbers?: number[]; rowNames?: Record<number, string> };
export const permissions: Record<Role, string[]> = {
  Admin: ["*"],
  Supervisor: ["*"],
  Operator: [
    "receive",
    "receiveMultiple",
    "receiveScan",
    "putaway",
    "putawayRow",
    "quarantine",
    "order",
    "pick",
    "pack",
    "dispatch",
    "delivery",
    "cancel",
    "return",
    "request",
    "transfer",
    "registerSampleProducts",
  ],
  Viewer: [],
};
export function can(role: Role, action: string) {
  return permissions[role].includes("*") || permissions[role].includes(action);
}
function required(c: Record<string, unknown>, key: string) {
  const s = String(c[key] ?? "").trim();
  if (!s || s.length > 300)
    throw Error(`${key} is required (maximum 300 characters)`);
  return s;
}
function number(c: Record<string, unknown>, key: string, zero = false) {
  const n = Number(c[key]);
  if (!Number.isSafeInteger(n) || n < (zero ? 0 : 1))
    throw Error(
      `${key} must be a ${zero ? "non-negative" : "positive"} whole number`,
    );
  return n;
}
function find<T extends { id: string }>(items: T[], id: string) {
  const row = items.find((x) => x.id === id);
  if (!row) throw Error(`Record not found: ${id}`);
  return row;
}
function money(c: Command) {
  const n = Number(c.price);
  if (!Number.isFinite(n) || n < 0 || n > 1000000000000)
    throw Error("Enter a valid non-negative price");
  return Math.round(n * 100) / 100;
}
export function receivingDate(value: Date | number = new Date()) {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
export function today() {
  return receivingDate();
}
export function naturalSort<T>(items: T[], value: (item: T) => string): T[] {
  return [...items].sort((a, b) => value(a).localeCompare(value(b), undefined, { numeric: true, sensitivity: "base" }));
}
export function available(l: Lot) {
  return l.location !== "RECEIVING" && l.expiry >= today()
    ? l.qty - l.reserved
    : 0;
}
export function recordWarehouse(
  state: Pick<State, "locations" | "receipts">,
  record: { location?: string; receiptId?: string; warehouse?: string },
) {
  if (record.location) {
    return state.locations.find((location) => location.id === record.location)?.warehouse ||
      (record.receiptId ? state.receipts.find((receipt) => receipt.id === record.receiptId)?.warehouse : undefined);
  }
  return record.warehouse;
}
export function lotWarehouse(state: Pick<State, "locations" | "receipts">, lot: Lot) {
  return recordWarehouse(state, lot);
}
export type WarehouseTotals = {
  physical: number;
  available: number;
  reserved: number;
  receiving: number;
  expired: number;
  openOrders: number;
  readyToShip: number;
};
export function warehouseTotals(state: Pick<State, "lots" | "locations" | "receipts" | "orders">, warehouse = "ALL"): WarehouseTotals {
  const inScope = (lot: Lot) => warehouse === "ALL" || lotWarehouse(state, lot) === warehouse;
  const lots = state.lots.filter(inScope);
  const orders = state.orders.filter((order) => warehouse === "ALL" || order.allocations.some((allocation) => {
    const lot = state.lots.find((item) => item.id === allocation.lot);
    return lot ? lotWarehouse(state, lot) === warehouse : false;
  }));
  return {
    physical: lots.reduce((sum, lot) => sum + lot.qty, 0),
    available: lots.reduce((sum, lot) => sum + available(lot), 0),
    reserved: lots.reduce((sum, lot) => sum + lot.reserved, 0),
    receiving: lots.filter((lot) => lot.location === "RECEIVING" && lot.expiry >= today()).reduce((sum, lot) => sum + lot.qty, 0),
    expired: lots.filter((lot) => lot.qty > 0 && lot.expiry < today()).reduce((sum, lot) => sum + lot.qty, 0),
    openOrders: orders.filter((order) => !["Dispatched", "Cancelled", "Short picked"].includes(order.status)).length,
    readyToShip: orders.filter((order) => order.status === "Packed").length,
  };
}
export type ProductAvailability = { product: string; available: number; earliestExpiry?: string };
export function productAvailability(state: Pick<State, "lots" | "locations" | "receipts">, warehouse: string) {
  const byProduct = new Map<string, ProductAvailability>();
  if (!warehouse) return byProduct;
  for (const lot of state.lots) {
    if (lotWarehouse(state, lot) !== warehouse) continue;
    const quantity = available(lot);
    if (quantity <= 0) continue;
    const current = byProduct.get(lot.product);
    if (current) {
      current.available += quantity;
      if (!current.earliestExpiry || lot.expiry < current.earliestExpiry) current.earliestExpiry = lot.expiry;
    } else byProduct.set(lot.product, { product: lot.product, available: quantity, earliestExpiry: lot.expiry });
  }
  return byProduct;
}
function date(c: Command) {
  const v = required(c, "expiry");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v ||
    v < today()
  )
    throw Error("Expiry must be a valid date today or later");
  return v;
}
function historicalDate(value: unknown, key: string) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)
    throw Error(`${key} must be a valid date`);
  return v;
}
function productDefaultDates(c: Command, current?: Product) {
  const manufacturing = c.defaultManufacturingDate === undefined
    ? current?.defaultManufacturingDate || ""
    : historicalDate(c.defaultManufacturingDate, "Default production date");
  const shelfLifeInput = c.defaultShelfLifeDays === undefined ? undefined : String(c.defaultShelfLifeDays).trim();
  if (shelfLifeInput === "0") throw Error("Default shelf life must be above 0 days");
  const shelfLife = c.defaultShelfLifeDays === undefined
    ? current?.defaultShelfLifeDays
    : shelfLifeInput === "" ? undefined : number(c, "defaultShelfLifeDays", true);
  const expiry = shelfLife !== undefined && shelfLife > 0
    ? new Date(Date.now() + shelfLife * 86400000).toISOString().slice(0, 10)
    : c.defaultExpiry === undefined
    ? current?.defaultExpiry || ""
    : historicalDate(c.defaultExpiry, "Default expiry");
  if (manufacturing && manufacturing > today())
    throw Error("Default production date cannot be in the future");
  if (manufacturing && expiry && manufacturing > expiry)
    throw Error("Default production date must be on or before default expiry");
  return {
    defaultManufacturingDate: manufacturing || undefined,
    defaultExpiry: expiry || undefined,
    defaultShelfLifeDays: shelfLife,
  };
}
export function seed(): State {
  return {
    products: [
      {
        id: "WH-2401-BLK",
        name: "Wireless Headphones",
        category: "Electronics",
        barcode: "89010001",
        minimum: 30,
        price: 2499,
        promotion: "",
      },
      {
        id: "CP-1058-WHT",
        name: "Ceramic Pour-Over Set",
        category: "Home & Living",
        barcode: "89010002",
        minimum: 20,
        price: 1299,
        promotion: "",
      },
      {
        id: "EB-3310-OLV",
        name: "Everyday Backpack",
        category: "Accessories",
        barcode: "89010003",
        minimum: 25,
        price: 1799,
        promotion: "",
      },
      {
        id: "LT-8820-SND",
        name: "Linen Throw Blanket",
        category: "Home & Living",
        barcode: "89010004",
        minimum: 20,
        price: 999,
        promotion: "",
      },
    ],
    sampleProducts: [
      { id: "SAMPLE-APPLE", name: "Apple", category: "Fruits", barcode: "100001", unit: "kg", productType: "Perishable", expiryTracking: true, serialTracking: false, warehouse: "WH-NORTH", batch: "APPLE-SAMPLE-01", manufacturingDate: "2026-11-01", expiry: "2026-11-30", sample: true },
      { id: "SAMPLE-BANANA", name: "Banana", category: "Fruits", barcode: "100002", unit: "kg", productType: "Perishable", expiryTracking: true, serialTracking: false, warehouse: "WH-NORTH", batch: "BANANA-SAMPLE-01", manufacturingDate: "2026-11-01", expiry: "2026-11-28", sample: true },
      { id: "SAMPLE-MILK", name: "Amul Milk", category: "Dairy", barcode: "100003", unit: "packet", productType: "Perishable", expiryTracking: true, serialTracking: false, warehouse: "WH-NORTH", batch: "MILK-SAMPLE-01", manufacturingDate: "2026-11-18", expiry: "2026-11-25", sample: true },
      { id: "SAMPLE-BISCUITS", name: "Biscuits", category: "Snacks", barcode: "100004", unit: "pack", productType: "Non-perishable", expiryTracking: false, serialTracking: false, warehouse: "WH-NORTH", batch: "BISCUITS-SAMPLE-01", manufacturingDate: "2026-10-01", sample: true },
      { id: "SAMPLE-RICE", name: "Rice", category: "Grocery", barcode: "100005", unit: "kg", productType: "Non-perishable", expiryTracking: false, serialTracking: false, warehouse: "WH-NORTH", batch: "RICE-SAMPLE-01", manufacturingDate: "2026-09-01", sample: true },
    ],
    warehouses: [
      { id: "WH-NORTH", name: "Northstar Distribution Center" },
      { id: "WH-SOUTH", name: "South Distribution Center" },
    ],
    locations: [
      { id: "A-01", warehouse: "WH-NORTH", capacity: 500, kind: "Storage" },
      { id: "P-01", warehouse: "WH-NORTH", capacity: 100, kind: "Pick face" },
      { id: "B-01", warehouse: "WH-NORTH", capacity: 500, kind: "Storage" },
      { id: "S-01", warehouse: "WH-SOUTH", capacity: 500, kind: "Storage" },
      { id: "WH-NORTH-QUARANTINE", name: "Quarantine", warehouse: "WH-NORTH", zone: "QUARANTINE", rack: "QUARANTINE", section: "QUARANTINE-01", row: 1, column: 1, capacity: 1000000, kind: "Storage", blocked: true },
      { id: "WH-SOUTH-QUARANTINE", name: "Quarantine", warehouse: "WH-SOUTH", zone: "QUARANTINE", rack: "QUARANTINE", section: "QUARANTINE-01", row: 1, column: 1, capacity: 1000000, kind: "Storage", blocked: true },
    ],
    suppliers: [{ id: "SUP-01", name: "Northstar Trading" }],
    users: [],
    lots: [
      {
        id: "LOT-001",
        product: "WH-2401-BLK",
        batch: "WH-26-A",
        expiry: "2028-12-31",
        location: "A-01",
        qty: 200,
        reserved: 0,
      },
      {
        id: "LOT-002",
        product: "CP-1058-WHT",
        batch: "CP-26-A",
        expiry: "2028-06-30",
        location: "B-01",
        qty: 40,
        reserved: 0,
      },
      {
        id: "LOT-003",
        product: "EB-3310-OLV",
        batch: "EB-26-A",
        expiry: "2028-12-31",
        location: "A-01",
        qty: 100,
        reserved: 0,
      },
      {
        id: "LOT-004",
        product: "LT-8820-SND",
        batch: "LT-26-A",
        expiry: "2026-12-01",
        location: "B-01",
        qty: 12,
        reserved: 0,
      },
    ],
    receipts: [],
    orders: [],
    approvals: [],
    returns: [],
    events: [],
    syncs: [],
    purchaseOrders: [],
    storeStock: [],
    stores: [
      { id: "STORE-01", name: "Northstar Central" },
      { id: "STORE-02", name: "Northstar South" },
    ],
    transfers: [],
    receivingSessions: [],
    connectors: [
      {
        system: "ERP",
        owner:
          "ERP owns products, suppliers, purchase and sales orders; WMS owns warehouse stock",
        direction: "Inbound masters / orders; outbound stock movements",
        frequency: "Manual import and export",
        enabled: false,
      },
      {
        system: "POS",
        owner:
          "POS owns store sales; WMS owns warehouse fulfillment and return inspection",
        direction: "Inbound sales and customer returns; store stock updates",
        frequency: "Manual import and export",
        enabled: false,
      },
      {
        system: "ESL",
        owner: "ERP owns prices and promotions; WMS supplies shelf stock",
        direction: "Outbound price, promotion and shelf stock feed",
        frequency: "Manual export",
        enabled: false,
      },
    ],
  };
}
export function locationPosition(location: Location) {
  const parts = location.id.split("-");
  const legacyBin = /^R(\d+)-S(\d+)-B(\d+)$/i.exec(location.id);
  return {
    zone: location.zone || (legacyBin ? "Storage" : parts[0]) || "Storage",
    rack: location.rack || (legacyBin ? parts[0] : parts[1]) || "01",
    section: location.section || `${location.rack || (legacyBin ? parts[0] : parts[1]) || "01"}-01`,
    row: location.row ?? (legacyBin ? 1 : Number(parts[2]) || 1),
    shelf: location.shelf ?? (legacyBin ? Number(legacyBin[2]) : 1),
    column: location.column ?? (legacyBin ? Number(legacyBin[3]) : Number(parts[3]) || 1),
  };
}

export function layoutReference(path: LayoutPath) {
  return [path.warehouse, path.zone, path.rack, path.section, path.row === undefined ? undefined : `R${path.row}`]
    .filter((part): part is string => part !== undefined).map(encodeURIComponent).join("/");
}

export function occupiedByLocation(lots: Lot[]) {
  const occupied = new Map<string, number>();
  for (const lot of lots) occupied.set(lot.location, (occupied.get(lot.location) ?? 0) + lot.qty);
  return occupied;
}

export type StorageOccupancy = { capacity: number; occupied: number; available: number; excess: number };
export function isQuarantineLocation(location: Pick<Location, "zone">) {
  return location.zone === "QUARANTINE";
}

export type WarehouseStorageTotals = StorageOccupancy & { quarantine: number };
export function warehouseStorageTotals(state: Pick<State, "locations" | "lots">, warehouse = "ALL"): WarehouseStorageTotals {
  const locations = state.locations.filter((location) => location.warehouse === warehouse || warehouse === "ALL");
  const occupied = occupiedByLocation(state.lots);
  const normal = locations.filter((location) => !isQuarantineLocation(location));
  const quarantine = locations.filter((location) => isQuarantineLocation(location)).reduce((sum, location) => sum + (occupied.get(location.id) ?? 0), 0);
  const capacity = normal.reduce((sum, location) => sum + location.capacity, 0);
  const occupiedNormal = normal.reduce((sum, location) => sum + (occupied.get(location.id) ?? 0), 0);
  return { capacity, occupied: occupiedNormal, available: Math.max(0, capacity - occupiedNormal), excess: Math.max(0, occupiedNormal - capacity), quarantine };
}

export function storageTone({ capacity, occupied, available, excess }: StorageOccupancy) {
  if (excess) return "over";
  if (!capacity || (!available && occupied < capacity)) return "blocked";
  if (occupied === capacity) return "full";
  return occupied ? "partial" : "available";
}

export function storageOccupancy(state: Pick<State, "locations" | "lots">) {
  const occupied = occupiedByLocation(state.lots);
  const units = new Map<string, StorageOccupancy>();
  const groups = new Map<string, StorageOccupancy>();
  const empty = { capacity: 0, occupied: 0, available: 0, excess: 0 };
  for (const unit of state.locations) {
    const quantity = occupied.get(unit.id) ?? 0;
    const quarantine = isQuarantineLocation(unit);
    const occupancy = {
      capacity: quarantine ? 0 : unit.capacity, occupied: quarantine ? 0 : quantity,
      available: quarantine ? 0 : unit.blocked ? 0 : Math.max(0, unit.capacity - quantity),
      excess: quarantine ? 0 : Math.max(0, quantity - unit.capacity),
    };
    units.set(unit.id, occupancy);
    const { zone, rack, section, row } = locationPosition(unit);
    const levels = [
      [unit.warehouse], [unit.warehouse, zone], [unit.warehouse, zone, rack],
      [unit.warehouse, zone, rack, section], [unit.warehouse, zone, rack, section, row],
    ];
    for (const parts of levels) {
      const key = JSON.stringify(parts);
      const total = groups.get(key) ?? { ...empty };
      total.capacity += occupancy.capacity;
      total.occupied += occupancy.occupied;
      total.available += occupancy.available;
      total.excess += occupancy.excess;
      groups.set(key, total);
    }
  }
  return {
    unit: (id: string) => units.get(id) ?? empty,
    group: (warehouse: string, path?: LayoutPath) => groups.get(JSON.stringify(
      [warehouse, path?.zone, path?.rack, path?.section, path?.row].filter((part) => part !== undefined),
    )) ?? empty,
  };
}

export function inLayoutPath(location: Location, path: LayoutPath) {
  if (location.warehouse !== path.warehouse) return false;
  const position = locationPosition(location);
  return position.zone === path.zone && (path.rack === undefined || position.rack === path.rack) &&
    (path.section === undefined || position.section === path.section) &&
    (path.row === undefined || position.row === path.row);
}

function readLayoutPath(c: Record<string, unknown>): LayoutPath {
  return {
    warehouse: required(c, "warehouse"), zone: required(c, "zone"),
    rack: c.rack === undefined ? undefined : required(c, "rack"),
    section: c.section === undefined ? undefined : required(c, "section"),
    row: c.row === undefined ? undefined : number(c, "row", true),
  };
}
function hasLayoutGroup(state: State, path: LayoutPath) {
  const contains = (item: { warehouse: string; zone: string; rack?: string }) =>
    item.warehouse === path.warehouse && item.zone === path.zone && (path.rack === undefined || item.rack === path.rack);
  return Boolean(state.layoutBlocks?.some(contains) || state.rackGrids?.some(contains) ||
    state.layoutSections?.some(contains) || state.locations.some((location) => inLayoutPath(location, path)));
}
function readLayoutRect(input: Record<string, unknown>, rack?: string): LayoutRect {
  const rect = { x: number(input, "x", true), y: number(input, "y", true), width: number(input, "width"), height: number(input, "height") };
  if (rect.width < (rack ? 180 : 260) || rect.height < (rack ? 92 : 155) ||
    rect.x + rect.width > 30000 || rect.y + rect.height > 30000)
    throw Error("The block size or position is outside the layout limits");
  return rect;
}
function setLayoutCapacity(state: State, locations: Location[], total: number) {
  if (!locations.length) throw Error("Add a storage unit before setting capacity");
  const occupied = occupiedByLocation(state.lots);
  const minimums = locations.map((location) => Math.max(1, occupied.get(location.id) || 0));
  const extra = total - minimums.reduce((sum, quantity) => sum + quantity, 0);
  if (extra < 0) throw Error("Capacity must cover all occupied stock and allow at least one per empty unit");
  const original = locations.reduce((sum, location) => sum + location.capacity, 0);
  if (total === original && locations.every((location, index) => location.capacity >= minimums[index])) return;
  const weights = locations.map((location, index) => Math.max(0, location.capacity - minimums[index]));
  const weight = weights.reduce((sum, value) => sum + value, 0);
  let accumulated = 0;
  let assigned = 0;
  locations.forEach((location, index) => {
    accumulated += weight ? weights[index] : 1;
    const share = Math.floor(extra * (accumulated / (weight || locations.length)));
    location.capacity = minimums[index] + share - assigned;
    assigned = share;
  });
}
export function rackGridFor(state: Pick<State, "rackGrids">, warehouse: string, zone: string, rack: string) {
  return state.rackGrids?.find((grid) => grid.warehouse === warehouse && grid.zone === zone && grid.rack === rack);
}
export function storageUnitReference(warehouse: string, zone: string, rack: string, row: number, column: number) {
  return [warehouse, zone, rack].map(encodeURIComponent).concat(`R${row}C${column}`).join("/");
}
export function rackCoordinates(locations: Location[]) {
  const coordinates = new Map<string, { row: number; column: number }>();
  const occupied = new Set<string>();
  let lastRow = locations.reduce((max, item) => Math.max(max, locationPosition(item).row), 1);
  for (const location of locations) {
    const position = locationPosition(location);
    const column = Math.max(1, position.column);
    const row = Math.max(1, position.row);
    const unitRow = occupied.has(`${row}:${column}`) ? ++lastRow : row;
    occupied.add(`${unitRow}:${column}`);
    coordinates.set(location.id, { row: unitRow, column });
  }
  return coordinates;
}

export function hasStoredStock(state: Pick<State, "lots">, location: Location) {
  return state.lots.some((lot) => lot.location === location.id && (lot.qty > 0 || lot.reserved > 0));
}

export function hasStorageAllocation(state: Pick<State, "lots">, location: Location) {
  return Boolean(location.assignedProduct || hasStoredStock(state, location));
}

function assertNoReferencedLots(state: Pick<State, "orders" | "transfers" | "returns"> & { lots: Lot[] }, lots: Lot[]) {
  const referenced = referencedLotIds(state);
  const referencedLot = lots.find((lot) => referenced.has(lot.id));
  if (referencedLot) throw Error(`Cannot delete location while lot ${referencedLot.id} is still referenced`);
}

function validateMapLocation(locations: Location[], location: Location) {
  const position = locationPosition(location);
  if (locations.some((other) => {
    if (other.id === location.id || other.warehouse !== location.warehouse) return false;
    const neighbor = locationPosition(other);
    return neighbor.zone === position.zone && neighbor.rack === position.rack && neighbor.section === position.section &&
      neighbor.row === position.row && neighbor.shelf === position.shelf && neighbor.column === position.column;
  })) throw Error("Another storage column already occupies this position");
}

export function receivingReceipt(state: Pick<State, "receipts">, lot: Lot) {
  const matches = state.receipts.filter((receipt) => lot.receiptId
    ? receipt.id === lot.receiptId
    : receipt.product === lot.product && receipt.batch === lot.batch && receipt.expiry === lot.expiry);
  return matches.find((receipt) => receipt.accepted === lot.qty) || matches[0];
}

function compareMapPositions(a: Location, b: Location) {
  const first = locationPosition(a), second = locationPosition(b);
  const compare = (left: string, right: string) => left.localeCompare(right, "en", { numeric: true });
  return compare(first.zone, second.zone) || compare(first.rack, second.rack) || compare(first.section, second.section) ||
    first.row - second.row || first.shelf - second.shelf || first.column - second.column || compare(a.id, b.id);
}

function followsProductOrder(state: Pick<State, "locations" | "products">, target: Location, sku: string) {
  const name = (id: string) => state.products.find((product) => product.id === id)?.name || id;
  const targetName = name(sku);
  return state.locations.every((other) => {
    if (other.id === target.id || other.warehouse !== target.warehouse || !other.assignedProduct) return true;
    const order = targetName.localeCompare(name(other.assignedProduct), "en", { numeric: true, sensitivity: "base" });
    return order * compareMapPositions(target, other) >= 0;
  });
}

export function mapPlacementIssue(
  state: Pick<State, "lots" | "receipts" | "locations" | "products">, lot: Lot, target: Location,
) {
  const receipt = receivingReceipt(state, lot);
  if (receipt && target.warehouse !== receipt.warehouse) return "Choose a location in the receiving warehouse";
  if (target.blocked) return "This location is blocked";
  if (target.assignedProduct && target.assignedProduct !== lot.product) return "Location is assigned to another SKU";
  const stock = state.lots.filter((item) => item.location === target.id && item.qty > 0);
  if (stock.length && !stock.some((item) => item.product === lot.product))
    return "Location contains stock for another SKU";
  if (stock.reduce((used, item) => used + item.qty, 0) >= target.capacity) return "Location is full";
  if (!stock.length && !target.assignedProduct && !followsProductOrder(state, target, lot.product))
    return "This column is outside the alphabetical order of assigned storage";
  return "";
}

export type ProductLocationCompliance =
  | "Correct Location"
  | "Zone Mismatch"
  | "Unassigned"
  | "Storage Compatibility Issue";

export function normalizeZone(zone: string): string {
  return String(zone || "").trim().toUpperCase().replace(/^ZONE\s+/i, "");
}

export function isSingleLetterZone(zone: string): boolean {
  return /^[A-Z]$/i.test(normalizeZone(zone));
}

export function isSpecialPurposeZone(zone: string): boolean {
  const norm = normalizeZone(zone);
  return norm === "QUARANTINE" || norm === "RECEIVING" || norm === "STAGING" || norm === "DISPATCH" || norm === "RETURNS";
}

export function compareZones(a: string, b: string): number {
  const normA = normalizeZone(a);
  const normB = normalizeZone(b);
  const isSpecialA = isSpecialPurposeZone(a);
  const isSpecialB = isSpecialPurposeZone(b);
  const isLetterA = isSingleLetterZone(a);
  const isLetterB = isSingleLetterZone(b);

  const priorityA = isSpecialA ? 3 : isLetterA ? 1 : 2;
  const priorityB = isSpecialB ? 3 : isLetterB ? 1 : 2;

  if (priorityA !== priorityB) {
    return priorityA - priorityB;
  }
  return normA.localeCompare(normB, "en", { numeric: true });
}

export function expectedZoneForProduct(productName: string): string | null {
  if (!productName) return null;
  const normalized = productName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim();
  const match = normalized.match(/[a-zA-Z]/);
  return match ? match[0].toUpperCase() : null;
}

export function evaluateProductCompliance(
  state: Pick<State, "locations" | "products" | "lots">,
  lot: Lot,
): {
  compliance: ProductLocationCompliance;
  expectedZone: string | null;
  actualZone: string | null;
  issueDetail?: string;
} {
  const product = state.products.find((p) => p.id === lot.product);
  const expectedZone = product ? expectedZoneForProduct(product.name) : null;
  if (!lot.location || lot.location === "RECEIVING") {
    return { compliance: "Unassigned", expectedZone, actualZone: null };
  }
  const loc = state.locations.find((l) => l.id === lot.location);
  if (!loc) {
    return { compliance: "Unassigned", expectedZone, actualZone: null };
  }
  const actualZone = loc.zone || locationPosition(loc).zone || null;

  // Storage compatibility checks
  if (loc.blocked) {
    return { compliance: "Storage Compatibility Issue", expectedZone, actualZone, issueDetail: "Location is blocked" };
  }
  if (loc.assignedProduct && loc.assignedProduct !== lot.product) {
    return { compliance: "Storage Compatibility Issue", expectedZone, actualZone, issueDetail: `Location is assigned to another SKU (${loc.assignedProduct})` };
  }
  const otherSkuLots = state.lots.filter((item) => item.location === loc.id && item.qty > 0 && item.product !== lot.product);
  if (otherSkuLots.length > 0) {
    return { compliance: "Storage Compatibility Issue", expectedZone, actualZone, issueDetail: "Location contains mixed SKUs" };
  }
  if (isQuarantineLocation(loc) && lot.expiry >= today()) {
    return { compliance: "Storage Compatibility Issue", expectedZone, actualZone, issueDetail: "Non-expired stock stored in quarantine" };
  }

  // Zone match check
  if (expectedZone && actualZone) {
    const normActual = normalizeZone(actualZone);
    const normExpected = normalizeZone(expectedZone);
    if (normActual === normExpected) {
      return { compliance: "Correct Location", expectedZone, actualZone };
    } else {
      return { compliance: "Zone Mismatch", expectedZone, actualZone };
    }
  }

  return { compliance: expectedZone ? "Zone Mismatch" : "Unassigned", expectedZone, actualZone };
}

export type PlacementTier = "best" | "compatible" | "partial" | "not-possible";
export type PlacementEvaluation = {
  location: Location;
  issue: string;
  reason: string;
  free: number;
  tier: PlacementTier;
  warning: string;
  rank: number[];
  expectedZone?: string;
  isExpectedZone?: boolean;
  zoneMismatch?: boolean;
};

export function evaluatePlacement(
  state: Pick<State, "lots" | "receipts" | "locations" | "products">,
  lot: Lot,
  target: Location,
): PlacementEvaluation {
  const issue = mapPlacementIssue(state, lot, target);
  const used = state.lots.filter((item) => item.location === target.id).reduce((sum, item) => sum + item.qty, 0);
  const free = Math.max(0, target.capacity - used);
  const sameSku = state.lots.some((item) => item.location === target.id && item.qty > 0 && item.product === lot.product);
  const sameBatch = state.lots.some((item) => item.location === target.id && item.qty > 0 && item.product === lot.product && item.batch === lot.batch && item.expiry === lot.expiry);

  const product = state.products.find((p) => p.id === lot.product);
  const expectedZone = product ? expectedZoneForProduct(product.name) : null;
  const targetZone = target.zone || locationPosition(target).zone;
  const normTarget = normalizeZone(targetZone);
  const normExpected = expectedZone ? normalizeZone(expectedZone) : null;
  const isExpectedZone = normExpected ? normTarget === normExpected : true;
  const zoneMismatch = Boolean(normExpected && !isExpectedZone);

  let warning = sameSku && !sameBatch ? "Mixes batches" : "";
  if (zoneMismatch) {
    const mismatchWarning = `Zone mismatch: Expected Zone ${expectedZone}, target is Zone ${targetZone}`;
    warning = warning ? `${mismatchWarning} · ${warning}` : mismatchWarning;
  }

  const valid = !issue;
  // If there is a zone mismatch, it cannot be tier 'best', at most 'compatible'
  const tier: PlacementTier = !valid
    ? "not-possible"
    : free >= lot.qty
      ? (!zoneMismatch && (sameBatch || target.assignedProduct === lot.product) ? "best" : "compatible")
      : free > 0
        ? "partial"
        : "not-possible";

  const rank = [
    tier === "best" ? 0 : tier === "compatible" ? 1 : tier === "partial" ? 2 : 3,
    isExpectedZone ? 0 : 1,
    sameBatch ? 0 : target.assignedProduct === lot.product ? 1 : 2,
    free >= lot.qty ? 0 : 1,
    locationPosition(target).row,
    locationPosition(target).column,
  ];

  const placementIssue = issue || (free <= 0 ? "Location is full" : "");
  const reason = placementIssue || (tier === "best"
    ? (sameBatch ? `Same SKU and batch, ${free} units free in Zone ${targetZone}` : `SKU-assigned row, ${free} units free in Zone ${targetZone}`)
    : tier === "partial" ? `Fits ${free} of ${lot.qty} units`
      : zoneMismatch
        ? `Alternative zone (${targetZone}), ${free} units free`
        : `Compatible location, ${free} units free`);

  return {
    location: target,
    issue: placementIssue,
    reason,
    free,
    tier,
    warning,
    rank,
    expectedZone: expectedZone || undefined,
    isExpectedZone,
    zoneMismatch,
  };
}

export function placementEvaluations(
  state: Pick<State, "lots" | "receipts" | "locations" | "products">,
  lot: Lot,
  locations: Location[],
) {
  return locations.map((location) => evaluatePlacement(state, lot, location)).sort((a, b) =>
    a.rank.find((value, index) => value !== b.rank[index])! - b.rank.find((value, index) => value !== a.rank[index])!
  );
}

export function rowPlacementOptions(
  state: Pick<State, "lots" | "receipts" | "locations" | "products">, lot: Lot, row: LayoutPath,
) {
  return state.locations.filter((location) => inLayoutPath(location, row) && !mapPlacementIssue(state, lot, location))
    .map((location) => ({
      location,
      available: location.capacity - state.lots.filter((item) => item.location === location.id).reduce((sum, item) => sum + item.qty, 0),
    }))
    .sort((a, b) => Number(b.location.assignedProduct === lot.product) - Number(a.location.assignedProduct === lot.product) ||
      compareMapPositions(a.location, b.location));
}

export function execute(
  original: State,
  c: Command,
  actor: Pick<User, "id" | "name" | "role">,
): State {
  if (!can(actor.role, c.type))
    throw Error("Your role cannot perform this action");
  let s = structuredClone(original);
  const id = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  let reference = "";
  let detail = "";
  const audit = (action: string, ref: string, text: string) => {
    s.events.unshift({
      id: id("EVT"),
      at: new Date().toISOString(),
      actor: actor.name || actor.id,
      action,
      reference: ref,
      detail: text,
    });
  };
  function capacity(location: string, qty: number) {
    const target = find(s.locations, location);
    const used = s.lots
      .filter((l) => l.location === location)
      .reduce((n, l) => n + l.qty, 0);
    if (qty > 0 && target.blocked) throw Error("Destination location is blocked");
    if (used + qty > target.capacity)
      throw Error("Destination location capacity exceeded");
  }
  function move(lot: Lot, qty: number, destination: string) {
    if (qty > available(lot))
      throw Error("Quantity exceeds available unreserved stock");
    if (lot.location === destination)
      throw Error("Choose a different destination");
    const target = find(s.locations, destination);
    if (target.assignedProduct && target.assignedProduct !== lot.product)
      throw Error("Location is assigned to another SKU");
    capacity(destination, qty);
    lot.qty -= qty;
    s.lots.push({
      ...lot,
      id: id("LOT"),
      location: destination,
      qty,
      reserved: 0,
    });
  }
  function reserve(customer: string, product: string, qty: number, orderType: Order["orderType"] = "Customer Order", warehouse = "") {
    return reserveLines(customer, [{ product, qty }], orderType, warehouse);
  }
  function reserveLines(customer: string, lines: { product: string; qty: number }[], orderType: Order["orderType"], warehouse = "") {
    if (!warehouse) throw Error("Warehouse is required for new orders");
    const allocations: Order["allocations"] = [];
    for (const line of lines) {
      find(s.products, line.product);
      const availability = productAvailability(s, warehouse).get(line.product);
      const eligible = s.lots
        .filter((l) => l.product === line.product && available(l) > 0 && lotWarehouse(s, l) === warehouse)
        .sort((a, b) => a.expiry.localeCompare(b.expiry));
      if (!availability || availability.available < line.qty)
        throw Error(`Insufficient available stock in warehouse ${warehouse}; receiving, expired and reserved stock are excluded`);
      let remaining = line.qty;
      for (const l of eligible) {
        const take = Math.min(remaining, available(l));
        if (take) {
          l.reserved += take;
          allocations.push({ lot: l.id, product: line.product, qty: take });
          remaining -= take;
        }
      }
    }
    const order: Order = {
      id: id("ORD"),
      customer,
      product: lines[0].product,
      qty: lines.reduce((n, line) => n + line.qty, 0),
      picked: 0,
      allocations,
      status: "Reserved",
      assignee: "",
      weight: 0,
      dimensions: "",
      material: "",
      courier: "",
      tracking: "",
      delivery: "",
      orderType,
      warehouse,
      lines: lines.map((line) => ({ ...line, picked: 0, packed: 0 })),
      backordered: 0,
      createdBy: actor.name || actor.id,
      createdAt: new Date().toISOString(),
    };
    s.orders.push(order);
    return order;
  }
  function automaticReceivingBatch(product: string, warehouse: string, expiry: string) {
    const base = `${warehouse}-${receivingDate().slice(2).replace(/-/g, "")}`;
    const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}(?:-(\\d+))?$`);
    const candidates = new Map<string, string>();
    for (const receipt of s.receipts) {
      if (receipt.product !== product || receipt.warehouse !== warehouse) continue;
      const match = pattern.exec(receipt.batch);
      if (match) candidates.set(receipt.batch, receipt.expiry);
    }
    for (const lot of s.lots) {
      if (lot.product !== product || lotWarehouse(s, lot) !== warehouse) continue;
      const match = pattern.exec(lot.batch);
      if (match && !candidates.has(lot.batch)) candidates.set(lot.batch, lot.expiry);
    }
    const suffixes = new Set<number>();
    for (const [batch, batchExpiry] of candidates) {
      const suffix = batch === base ? 1 : Number(batch.slice(base.length + 1));
      if (batchExpiry === expiry) return batch;
      if (Number.isSafeInteger(suffix)) suffixes.add(suffix);
    }
    if (!suffixes.has(1)) return base;
    let next = 2;
    while (suffixes.has(next)) next += 1;
    return `${base}-${next}`;
  }
  function receiveOne(receiveCommand: Command) {
    const product = find(s.products, required(receiveCommand, "product"));
    const supplierId = required(receiveCommand, "supplier");
    const supplier = supplierId === "Unspecified" ? { id: "Unspecified" } : find(s.suppliers, supplierId);
    const warehouse = find(s.warehouses, String(receiveCommand.warehouse || s.warehouses[0]?.id));
    const receivingLocation = String(receiveCommand.receivingLocation || "RECEIVING");
    if (receivingLocation !== "RECEIVING") {
      const location = find(s.locations, receivingLocation);
      if (location.warehouse !== warehouse.id) throw Error("Receiving location must belong to the selected warehouse");
    }
    const expected = number(receiveCommand, "expected");
    const received = number(receiveCommand, "received");
    const damaged = number(receiveCommand, "damaged", true);
    const rejected = receiveCommand.rejected === undefined || receiveCommand.rejected === "" ? 0 : number(receiveCommand, "rejected", true);
    if (received > expected || damaged > received || rejected > received - damaged)
      throw Error("Received cannot exceed expected; damaged and rejected quantities cannot exceed received");
    const quality = required(receiveCommand, "quality");
    if (!["Passed", "Failed"].includes(quality)) throw Error("Invalid quality result");
    const requestedStatus = String(receiveCommand.status || "Accepted");
    if (!["Draft", "Pending Inspection", "Accepted", "Rejected"].includes(requestedStatus)) throw Error("Invalid receipt status");
    const expiry = product.expiryTracking === false ? "2099-12-31" : (receiveCommand.allowExpired === true ? historicalDate(receiveCommand.expiry, "Expiry") : date(receiveCommand));
    const manufacturingDate = historicalDate(receiveCommand.manufacturingDate, "Manufacturing date");
    if (manufacturingDate && expiry !== "2099-12-31" && manufacturingDate > expiry) throw Error("Manufacturing date cannot be after expiry date");
    const explicitBatch = String(receiveCommand.batch ?? "").trim();
    const batch = explicitBatch || automaticReceivingBatch(product.id, warehouse.id, expiry);
    const existingBatch = s.receipts.find((receipt) => receipt.product === product.id &&
      receipt.batch === batch && receipt.warehouse === warehouse.id && receipt.expiry !== expiry);
    if (existingBatch && existingBatch.expiry !== expiry)
      throw Error(`${product.name}, batch ${batch} already exists in ${warehouse.id} with expiry ${existingBatch.expiry}. You entered ${expiry}.`);
    const accepted = requestedStatus === "Accepted" && quality === "Passed" ? received - damaged - rejected : 0;
    const receiptId = id("RCV");
    const grn = id("GRN");
    const note = String(receiveCommand.note || "");
    if ((received < expected || damaged > 0 || rejected > 0 || quality === "Failed") && !note.trim())
      throw Error("An exception reason is required for shortages, damage or quality failure");
    s.receipts.push({
      id: receiptId,
      supplier: supplier.id,
      product: product.id,
      expected,
      received,
      damaged,
      accepted,
      batch,
      expiry,
      status: requestedStatus === "Accepted" && quality === "Failed" ? "Rejected" : requestedStatus === "Accepted" && accepted ? "Awaiting put away" : requestedStatus,
      grn,
      note,
      warehouse: warehouse.id,
      receivingLocation,
      purchaseOrder: receiveCommand.purchaseOrder ? String(receiveCommand.purchaseOrder) : undefined,
      manufacturingDate: receiveCommand.manufacturingDate ? String(receiveCommand.manufacturingDate) : undefined,
      rejected: quality === "Failed" ? received : rejected,
    });
    if (accepted)
      s.lots.push({
        id: id("LOT"),
        product: product.id,
        batch,
        expiry,
        location: "RECEIVING",
        qty: accepted,
        reserved: 0,
        receiptId,
      });
    return { reference: receiptId, detail: `${grn}: accepted ${accepted}; damaged ${damaged}; missing ${expected - received}; quality ${quality}. ${note}` };
  }
  switch (c.type) {
    case "receivingSettings": {
      const days = number(c, "days");
      if (days > 3650) throw Error("Global receiving shelf life must be 3650 days or fewer");
      const oldDays = s.settings?.receivingDefaultShelfLifeDays ?? DEFAULT_GLOBAL_SHELF_LIFE_DAYS;
      s.settings = { ...s.settings, receivingDefaultShelfLifeDays: days };
      audit("receivingSettings", "RECEIVING-SETTINGS", `Changed global receiving shelf life from ${oldDays} to ${days} days`);
      reference = "RECEIVING-SETTINGS";
      detail = `Global receiving shelf life set to ${days} days`;
      break;
    }
    case "receiveReconciliation": {
      const supplierId = String(c.supplier || "Unspecified").trim() || "Unspecified";
      const supplier = supplierId === "Unspecified" ? { id: "Unspecified" } : find(s.suppliers, supplierId);
      const warehouse = find(s.warehouses, required(c, "warehouse"));
      let lines: unknown;
      try { lines = JSON.parse(String(c.lines || "[]")); } catch { throw Error("Receiving list must be valid JSON"); }
      if (!Array.isArray(lines) || !lines.length) throw Error("Add at least one scanned item before confirmation");
      const seen = new Map<string, number>();
      const assignedBatches: string[] = [];
      const warehouseName = warehouse.name || warehouse.id;
      for (const raw of lines) {
        if (!raw || typeof raw !== "object") throw Error("Invalid receiving list item");
        const line = raw as Record<string, unknown>;
        const product = find(s.products, required(line, "product"));
        const barcode = required(line, "barcode");
        if (barcode !== product.barcode) throw Error(`Barcode does not match ${product.name}`);
        const received = number(line, "received");
        const damaged = number(line, "damaged", true);
        if (damaged > received) throw Error("Damaged quantity cannot exceed received quantity");
        const explicitBatch = String(line.batch ?? "").trim();
        const expiry = product.expiryTracking === false ? "2099-12-31" : historicalDate(line.expiry, "Expiry");
        const mfg = historicalDate(line.manufacturingDate, "Manufacturing date");
        if (product.expiryTracking !== false && !expiry) throw Error(`Expiry is required for ${product.name}`);
        if (mfg && expiry !== "2099-12-31" && mfg > expiry) throw Error("Manufacturing date cannot be after expiry date");
        const expired = expiry !== "2099-12-31" && expiry < today();
        const lineNumber = lines.indexOf(raw) + 1;
        const batch = explicitBatch || automaticReceivingBatch(product.id, warehouse.id, expiry);
        const key = `${product.id}|${batch}`;
        const existingBatch = s.receipts.find((receipt) => receipt.product === product.id && receipt.batch === batch && receipt.warehouse === warehouse.id && receipt.expiry !== expiry);
        if (existingBatch && existingBatch.expiry !== expiry)
          throw Error(`Receiving line ${lineNumber}: ${product.name}, batch ${batch} already exists in ${warehouseName} with expiry ${existingBatch.expiry}. You entered ${expiry}.`);
        if (explicitBatch && seen.has(key))
          throw Error(`Receiving line ${lineNumber}: ${product.name}, batch ${batch} is duplicated in the pending receiving list.`);
        if (explicitBatch) seen.set(key, lineNumber);
        const rejected = expired || damaged === received;
        const next = execute(s, { type: "receive", supplier: supplier.id, warehouse: warehouse.id, product: product.id, expected: received, received, damaged, quality: rejected ? "Failed" : "Passed", status: rejected ? "Rejected" : "Accepted", batch, expiry, manufacturingDate: mfg, allowExpired: expired, note: String(c.note || (expired ? "Expired stock quarantined" : "Barcode reconciliation")) }, actor);
        s = next;
        assignedBatches.push(batch);
      }
      reference = id("RECON");
      detail = `Confirmed barcode reconciliation for ${lines.length} batch line${lines.length === 1 ? "" : "s"}. Assigned batches: ${assignedBatches.join(", ")}`;
      break;
    }
    case "receiveScan": {
      const action = String(c.action || "start");
      if (action === "start") {
        const session: ReceivingSession = {
          id: id("RCVSESSION"),
          supplier: required(c, "supplier"),
          warehouse: find(s.warehouses, required(c, "warehouse")).id,
          receivingLocation: String(c.receivingLocation || "RECEIVING"),
          expected: JSON.parse(String(c.expected || "[]")),
          scanned: [],
          confirmed: false,
          step: "Scan",
          scannedBy: "",
          scannedAt: "",
          verifiedBy: "",
          verifiedAt: "",
          confirmedBy: "",
          confirmedAt: "",
        };
        if (!Array.isArray(session.expected)) throw Error("Expected lines must be an array");
        session.expected = session.expected.map((line) => ({ product: required({ product: line.product }, "product"), qty: number({ qty: line.qty }, "qty") }));
        if (new Set(session.expected.map((line) => line.product)).size !== session.expected.length)
          throw Error("Each expected product may appear only once");
        s.receivingSessions.push(session); reference = session.id; detail = "Receiving scan session started";
      } else {
        const session = find(s.receivingSessions, required(c, "session"));
        if (session.confirmed) throw Error("Receiving scan session has already been confirmed");
        if (action === "scan") {
          const barcode = required(c, "barcode");
          const product = s.products.find((p) => p.barcode === barcode);
          if (!product) throw Error("Unknown product barcode; scan was not added");
          const qty = number(c, "qty"); const line = session.scanned.find((x) => x.product === product.id);
          if (line) line.qty += qty; else session.scanned.push({ product: product.id, qty });
          session.scannedBy = actor.name || actor.id;
          session.scannedAt = new Date().toISOString();
          reference = session.id; detail = `Scanned ${product.id} × ${qty} by ${session.scannedBy}`;
        } else if (action === "verify" || action === "inspect") {
          if (!session.scanned.length) throw Error("Scan at least one product before verification");
          if (session.scannedBy && (actor.id === session.scannedBy || actor.name === session.scannedBy)) {
            throw Error("Receiving scanner and verifier must be different staff members");
          }
          session.verifiedBy = actor.name || actor.id;
          session.verifiedAt = new Date().toISOString();
          session.step = "Inspect";
          reference = session.id;
          detail = `Receiving scan session verified by ${session.verifiedBy}`;
        } else if (action === "confirm") {
          if (!session.verifiedBy) throw Error("A separate verifier must inspect the receiving session before confirmation");
          if (c.verifier && (c.verifier === session.scannedBy || c.verifier === actor.name || c.verifier === actor.id)) {
            throw Error("Receiving scanner and verifier must be different staff members");
          }
          if (session.verifiedBy && session.scannedBy && (session.verifiedBy === session.scannedBy)) {
            throw Error("Receiving scanner and verifier must be different staff members");
          }
          const additional = session.scanned.filter((line) => !session.expected.some((x) => x.product === line.product));
          if (additional.length && !String(c.additionalReason || "").trim()) throw Error("A reason is required for additional scanned products");
          for (const line of session.scanned) {
            const expected = session.expected.find((x) => x.product === line.product)?.qty || 0;
            const product = find(s.products, line.product);
            if (product.expiryTracking !== false && !String(c.expiry || "").trim())
              throw Error(`Expiry is required for ${product.name}`);
            const expiry = String(c.expiry || "2099-12-31");
            const next = execute(s, { type: "receive", supplier: session.supplier, warehouse: session.warehouse, receivingLocation: session.receivingLocation, product: product.id, expected: Math.max(expected, line.qty), received: line.qty, damaged: 0, quality: "Passed", batch: `${session.id}-${product.id}`, expiry, note: String(c.note || c.additionalReason || "Scan reconciliation") }, actor);
            s = next;
          }
          const currentSession = find(s.receivingSessions, session.id);
          currentSession.confirmed = true;
          currentSession.confirmedBy = actor.name || actor.id;
          currentSession.confirmedAt = new Date().toISOString();
          currentSession.step = "Confirm";
          reference = session.id;
          detail = `Receiving scan session confirmed by ${currentSession.confirmedBy}; additional reason: ${String(c.additionalReason || "")}`;
        } else throw Error("Invalid receiving scan action");
      }
      break;
    }
    case "purchaseOrder": {
      const action = required(c, "action");
      if (action === "create") {
        const poid = required(c, "id");
        if (s.purchaseOrders.some((po) => po.id === poid)) throw Error("Purchase order already exists");
        find(s.suppliers, required(c, "supplier"));
        find(s.products, required(c, "product"));
        const qty = number(c, "qty");
        s.purchaseOrders.push({ id: poid, supplier: String(c.supplier), product: String(c.product), qty, status: "Draft", receivedQty: 0, createdAt: new Date().toISOString() });
        reference = poid;
        detail = `Purchase order ${poid} created`;
      } else {
        const po = s.purchaseOrders.find((item) => item.id === required(c, "id"));
        if (!po) throw Error("Purchase order not found");
        po.status ||= "Draft";
        po.receivedQty ||= 0;
        if (action === "update") {
          if (po.status !== "Draft") throw Error("Only draft purchase orders can be edited");
          if (c.supplier) { find(s.suppliers, String(c.supplier)); po.supplier = String(c.supplier); }
          if (c.product) { find(s.products, String(c.product)); po.product = String(c.product); }
          if (c.qty !== undefined) po.qty = number(c, "qty");
          reference = po.id;
          detail = `Purchase order ${po.id} updated`;
        } else if (action === "send") {
          if (po.status !== "Draft") throw Error("Only draft purchase orders can be sent");
          po.status = "Sent";
          po.sentAt = new Date().toISOString();
          reference = po.id;
          detail = `Purchase order ${po.id} sent to receiving`;
        } else if (action === "receive") {
          if (!["Sent", "Partially received"].includes(po.status)) throw Error("Purchase order is not open for receiving");
          const remaining = po.qty - po.receivedQty;
          const receivedQty = number(c, "qty");
          if (receivedQty > remaining) throw Error("Receipt exceeds the remaining purchase-order quantity");
          const next = execute(s, {
            type: "receive",
            supplier: po.supplier,
            product: po.product,
            warehouse: required(c, "warehouse"),
            receivingLocation: String(c.receivingLocation || "RECEIVING"),
            expected: receivedQty,
            received: receivedQty,
            damaged: Number(c.damaged || 0),
            quality: required(c, "quality"),
            batch: required(c, "batch"),
            expiry: required(c, "expiry"),
            note: String(c.note || ""),
            purchaseOrder: po.id,
          }, actor);
          s = next;
          const updated = s.purchaseOrders.find((item) => item.id === po.id)!;
          updated.receivedQty = (updated.receivedQty || 0) + receivedQty;
          updated.status = updated.receivedQty >= updated.qty ? "Received" : "Partially received";
          reference = updated.id;
          detail = `Purchase order ${updated.id} received ${receivedQty} units`;
        } else if (action === "close") {
          if ((po.receivedQty || 0) < po.qty) throw Error("Purchase order cannot close before the ordered quantity is received");
          po.status = "Closed";
          po.closedAt = new Date().toISOString();
          reference = po.id;
          detail = `Purchase order ${po.id} closed`;
        } else throw Error("Invalid purchase-order action");
      }
      break;
    }
    case "receive": {
      ({ reference, detail } = receiveOne(c));
      break;
    }
    case "receiveMultiple": {
      let lines: unknown;
      try { lines = JSON.parse(String(c.lines || "[]")); } catch { throw Error("Receiving lines must be valid JSON"); }
      if (!Array.isArray(lines) || !lines.length) throw Error("Add at least one receiving line");
      const { type: _type, lines: _lines, ...shared } = c;
      const created: { reference: string; detail: string }[] = [];
      for (const [index, raw] of lines.entries()) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error(`Receiving line ${index + 1}: invalid line`);
        try {
          created.push(receiveOne({ ...shared, ...(raw as Record<string, unknown>), type: "receive" }));
        } catch (error) {
          throw Error(`Receiving line ${index + 1}: ${error instanceof Error ? error.message : "invalid line"}`);
        }
      }
      reference = created.map((item) => item.reference).join(",");
      detail = `Received ${created.length} line${created.length === 1 ? "" : "s"}`;
      break;
    }
    case "putawayRow":
    case "putaway": {
      const lot = find(s.lots, required(c, "lot"));
      if (lot.location !== "RECEIVING" || !lot.qty)
        throw Error("Lot is not awaiting put away");
      const product = find(s.products, lot.product);
      const qty = number(c, "qty");
      if (qty > lot.qty) throw Error("Quantity exceeds goods awaiting storage");
      const row = c.type === "putawayRow" ? readLayoutPath(c) : undefined;
      if (row && (row.rack === undefined || row.section === undefined || row.row === undefined))
        throw Error("Choose an exact storage row");
      const destination = row ? layoutReference(row) : required(c, "destination");
      if (required(c, "productBarcode") !== product.barcode || String(c.locationBarcode ?? "").trim() !== destination)
        throw Error("Product or location barcode does not match");
      const targets = row
        ? placementEvaluations(s, lot, s.locations.filter((location) => inLayoutPath(location, row)))
          .filter((evaluation) => evaluation.tier !== "not-possible")
          .map((evaluation) => ({ location: evaluation.location, available: evaluation.free }))
        : (() => {
          const target = find(s.locations, destination);
          const evaluation = evaluatePlacement(s, lot, target);
          return [{ location: target, available: evaluation.free, evaluation }];
        })();
      if (targets.reduce((sum, item) => sum + item.available, 0) < qty)
        throw Error("The selected row has insufficient compatible capacity");

      const expZone = expectedZoneForProduct(product.name);
      if (expZone) {
        for (const { location: target } of targets) {
          const targetZone = target.zone || locationPosition(target).zone;
          const normTarget = normalizeZone(targetZone);
          const normExpected = normalizeZone(expZone);
          if (normTarget !== normExpected && !isQuarantineLocation(target)) {
            const expectedZoneExists = s.locations.some(
              (l) => l.warehouse === target.warehouse && normalizeZone(l.zone || locationPosition(l).zone) === normExpected
            );
            if (!expectedZoneExists) {
              if ((c.fromMap || c.requireStrictZoneValidation) && !c.confirmZoneMismatch && !c.authorizedAlternative) {
                throw Error(`Zone Exception: Expected Zone ${expZone} for "${product.name}" does not exist in warehouse ${target.warehouse}. Authorized alternative confirmation required.`);
              }
            } else {
              const expectedLocations = s.locations.filter(
                (l) => l.warehouse === target.warehouse && normalizeZone(l.zone || locationPosition(l).zone) === normExpected
              );
              const expectedHasCapacity = expectedLocations.some((l) => {
                const used = s.lots.filter((item) => item.location === l.id).reduce((sum, item) => sum + item.qty, 0);
                return !l.blocked && (!l.assignedProduct || l.assignedProduct === lot.product) && (l.capacity - used) >= qty;
              });
              if (expectedHasCapacity && !c.confirmZoneMismatch && !c.authorizedAlternative) {
                throw Error(`Zone Mismatch: "${product.name}" is designated for Zone ${expZone}. Putting away in Zone ${targetZone} requires explicit authorized confirmation.`);
              }
              if (!expectedHasCapacity && !c.confirmZoneMismatch && !c.authorizedAlternative) {
                throw Error(`Zone Full Exception: Expected Zone ${expZone} has insufficient capacity for "${product.name}". Authorized alternative confirmation required.`);
              }
            }
          }
        }
      }

      let remaining = qty;
      for (const { location: target, available } of targets) {
        if (!remaining) break;
        const quantity = Math.min(remaining, available);
        const fromMap = Boolean(row) || c.fromMap === true;
        const evaluation = evaluatePlacement(s, lot, target);
        if (evaluation.issue) throw Error(evaluation.issue);
        capacity(target.id, quantity);
        if (fromMap && !target.assignedProduct && !s.lots.some((item) => item.location === target.id && item.qty > 0))
          target.assignedProduct = lot.product;
        lot.qty -= quantity;
        remaining -= quantity;
        s.lots.push({
          ...lot, id: id("LOT"), location: target.id, qty: quantity, reserved: 0,
          putAwayBy: actor.name || actor.id, putAwayAt: new Date().toISOString(),
        });
      }
      for (const r of s.receipts.filter(
        (r) =>
          (lot.receiptId ? r.id === lot.receiptId : r.product === lot.product && r.batch === lot.batch && r.expiry === lot.expiry) &&
          r.status === "Awaiting put away",
      )) {
        r.putAwayBy = actor.name || actor.id;
        r.putAwayAt = new Date().toISOString();
        if (
          !s.lots.some(
            (l) =>
              (lot.receiptId ? l.receiptId === r.id : l.product === r.product && l.batch === r.batch && l.expiry === r.expiry) &&
              l.location === "RECEIVING" &&
              l.qty > 0,
          )
        )
          r.status = "Stored";
      }
      reference = lot.id;
      detail = `${qty} units moved from RECEIVING to ${destination} by ${actor.name || actor.id}`;
      break;
    }
    case "order": {
      const orderType = String(c.orderType || "Customer Order") as Order["orderType"];
      if (!["Customer Order", "Personal Shop Order"].includes(orderType)) throw Error("Invalid order type");
      const customer = orderType === "Personal Shop Order" ? required(c, "shop") : required(c, "customer");
      if (orderType === "Personal Shop Order") find(s.stores, customer);
      let lines: { product: string; qty: number }[];
      try { lines = c.lines ? JSON.parse(String(c.lines)) : [{ product: required(c, "product"), qty: number(c, "qty") }]; } catch { throw Error("Order lines must be valid JSON"); }
      if (!Array.isArray(lines) || !lines.length || lines.length > 100) throw Error("Add at least one order line");
      lines = lines.map((line) => ({ product: required({ product: line.product }, "product"), qty: number({ qty: line.qty }, "qty") }));
      if (new Set(lines.map((line) => line.product)).size !== lines.length)
        throw Error("Each order product may appear only once");
      const reservationWarehouse = required(c, "warehouse");
      find(s.warehouses, reservationWarehouse);
      const o = reserveLines(customer, lines, orderType, reservationWarehouse);
      reference = o.id;
      detail = `Reserved ${o.qty} units using earliest expiry first`;
      break;
    }
    case "assign": {
      const o = find(s.orders, required(c, "order"));
      if (o.status !== "Reserved")
        throw Error("Only reserved orders can be assigned");
      const u = find(s.users, required(c, "assignee"));
      if (!u.active || u.role === "Viewer")
        throw Error("Choose an active warehouse staff member");
      o.assignee = u.id;
      reference = o.id;
      detail = `Assigned to ${u.name}`;
      break;
    }
    case "pick": {
      const o = find(s.orders, required(c, "order"));
      if (!['Reserved', 'Picking'].includes(o.status)) throw Error("Order is not awaiting picking");
      if (!o.assignee) o.assignee = actor.id;
      if (actor.role === "Operator" && o.assignee !== actor.id)
        throw Error("This task is assigned to another user");
      const pickedProduct = s.products.find((p) => p.barcode === required(c, "productBarcode"));
      if (!pickedProduct) throw Error("Product barcode does not match");
      const line = o.lines.find((x) => x.product === pickedProduct.id);
      if (!line) throw Error("Product is not part of this order");
      const qty = number(c, "qty", true);
      if (qty > line.qty) throw Error("Picked quantity exceeds ordered quantity");
      if (qty < line.qty && !String(c.reason || "").trim())
        throw Error("A reason is required for a short pick");
      if (o.allocations.some((a) => find(s.lots, a.lot).expiry < today()))
        throw Error(
          "Allocated stock has expired. Cancel and reserve eligible stock again",
        );
      let remaining = qty;
      const kept: Order["allocations"] = [];
      for (const a of o.allocations) {
        if (a.product !== line.product) { kept.push(a); continue; }
        const l = find(s.lots, a.lot);
        const take = Math.min(remaining, a.qty);
        l.reserved -= a.qty - take;
        if (take) kept.push({ lot: l.id, product: a.product, qty: take });
        remaining -= take;
      }
      o.allocations = kept;
      line.picked = qty;
      o.picked = o.lines.reduce((n, x) => n + x.picked, 0);
      o.backordered = o.lines.reduce((n, x) => n + Math.max(0, x.qty - x.picked), 0);
      o.pickedBy = actor.name || actor.id;
      o.pickedAt = new Date().toISOString();
      o.status = o.lines.every((x) => x.picked === x.qty) ? "Picked" : (qty < line.qty ? "Short picked" : "Picking");
      reference = o.id;
      detail = `Picked ${qty}/${line.qty} of ${line.product} by ${o.pickedBy}; ${line.qty - qty} released from reservation. ${String(c.reason || "")}`;
      break;
    }
    case "pack": {
      const o = find(s.orders, required(c, "order"));
      if (!['Picked', 'Packing'].includes(o.status)) throw Error("Order must be picked first");
      const packedProduct = s.products.find((p) => p.barcode === required(c, "productBarcode"));
      if (!packedProduct) throw Error("Product barcode does not match");
      const line = o.lines.find((x) => x.product === packedProduct.id);
      if (!line || packedProduct.barcode !== c.productBarcode) throw Error("Product barcode does not match this order");
      if (number(c, "qty") !== line.picked) throw Error("Pack quantity must match picked quantity");
      const weight = Number(c.weight);
      if (!Number.isFinite(weight) || weight <= 0 || weight > 100000)
        throw Error("Enter a valid positive package weight");
      o.weight = weight;
      o.dimensions = required(c, "dimensions");
      o.material = required(c, "material");
      line.packed = line.picked;
      o.packedBy = actor.name || actor.id;
      o.packedAt = new Date().toISOString();
      o.status = o.lines.every((x) => x.packed === x.qty) ? "Packed" : "Packing";
      reference = o.id;
      detail = `${o.picked} packed by ${o.packedBy}; ${weight} kg; ${o.dimensions}; ${o.material}`;
      break;
    }
    case "dispatch": {
      const o = find(s.orders, required(c, "order"));
      if (o.status !== "Packed")
        throw Error("Order must be packed before dispatch");
      if (number(c, "qty") !== o.picked || !o.lines.every((x) => x.packed === x.qty))
        throw Error("Verify the packed quantity");
      o.courier = required(c, "courier");
      o.tracking = required(c, "tracking");
      o.dispatchedBy = actor.name || actor.id;
      o.dispatchedAt = new Date().toISOString();
      o.vehicleNumber = String(c.vehicleNumber || "");
      o.receiverStore = String(c.receiverStore || "");
      o.dispatchNote = String(c.dispatchNote || "");
      for (const a of o.allocations) {
        const l = find(s.lots, a.lot);
        if (l.expiry < today())
          throw Error(
            "Allocated stock has expired; cancel this order and inspect stock",
          );
        if (l.qty < a.qty || l.reserved < a.qty)
          throw Error("Stock allocation mismatch");
        l.qty -= a.qty;
        l.reserved -= a.qty;
      }
      o.status = "Dispatched";
      o.delivery = "In transit";
      reference = o.id;
      detail = `Dispatched ${o.picked} with ${o.courier}, tracking ${o.tracking}; physical stock deducted once`;
      break;
    }
    case "delivery": {
      const o = find(s.orders, required(c, "order"));
      if (o.status !== "Dispatched") throw Error("Order is not dispatched");
      const status = required(c, "delivery");
      if (!["Delivered", "Delivery exception", "In transit"].includes(status))
        throw Error("Invalid delivery status");
      o.delivery = status;
      reference = o.id;
      detail = status;
      break;
    }
    case "transfer": {
      const action = required(c, "action");
      if (action === "createWarehouse") {
        const sourceWarehouse = required(c, "sourceWarehouse");
        const destination = find(s.stores, required(c, "destination"));
        find(s.warehouses, sourceWarehouse);
        let lines: { product: string; qty: number }[];
        try { lines = JSON.parse(String(c.lines)); } catch { throw Error("Transfer lines must be valid JSON"); }
        if (!Array.isArray(lines) || !lines.length) throw Error("Add at least one transfer line");
        lines = lines.map((line) => ({ product: required({ product: line.product }, "product"), qty: number({ qty: line.qty }, "qty") }));
        if (new Set(lines.map((line) => line.product)).size !== lines.length)
          throw Error("Each transfer product may appear only once");
        const allocations: { lot: string; product: string; qty: number }[] = [];
        for (const line of lines) {
          find(s.products, line.product);
          let remaining = line.qty;
          for (const lot of s.lots.filter((x) => x.product === line.product && x.location !== "RECEIVING" && s.locations.find((l) => l.id === x.location)?.warehouse === sourceWarehouse).sort((a, b) => a.expiry.localeCompare(b.expiry))) {
            const take = Math.min(remaining, available(lot));
            if (take > 0) { lot.reserved += take; allocations.push({ lot: lot.id, product: line.product, qty: take }); remaining -= take; }
            if (!remaining) break;
          }
          if (remaining > 0) throw Error(`Insufficient warehouse stock for ${line.product}`);
        }
        const transfer: StoreTransfer = {
          id: id("TRF"), source: sourceWarehouse, destination: destination.id, sourceType: "Warehouse", destinationType: "Store", sourceWarehouse,
          lines, allocations, status: "Draft", requestedBy: actor.name || actor.id, requestedAt: new Date().toISOString(), dispatchedAt: "", receivedAt: "",
        };
        s.transfers.push(transfer); reference = transfer.id; detail = `Warehouse transfer created from ${sourceWarehouse} to ${destination.name} by ${transfer.requestedBy}`;
      } else if (action === "create" || action === "request") {
        const source = find(s.stores, required(c, "source"));
        const destination = find(s.stores, required(c, "destination"));
        if (source.id === destination.id) throw Error("Source and destination shops must differ");
        let lines: { product: string; qty: number }[];
        try { lines = JSON.parse(String(c.lines)); } catch { throw Error("Transfer lines must be valid JSON"); }
        if (!Array.isArray(lines) || !lines.length) throw Error("Add at least one transfer line");
        lines = lines.map((line) => ({ product: required({ product: line.product }, "product"), qty: number({ qty: line.qty }, "qty") }));
        if (new Set(lines.map((line) => line.product)).size !== lines.length)
          throw Error("Each transfer product may appear only once");
        for (const line of lines) {
          find(s.products, line.product);
          const stock = s.storeStock.find((x) => x.store === source.id && x.product === line.product)?.qty || 0;
          if (stock < line.qty) throw Error(`Insufficient shop stock for ${line.product}`);
        }
        const transfer: StoreTransfer = {
          id: id("TRF"),
          source: source.id,
          destination: destination.id,
          lines,
          status: "Draft",
          requestedBy: actor.name || actor.id,
          requestedAt: new Date().toISOString(),
          dispatchedAt: "",
          receivedAt: "",
        };
        s.transfers.push(transfer); reference = transfer.id; detail = `Transfer created from ${source.name} to ${destination.name} by ${transfer.requestedBy}`;
      } else {
        const transfer = s.transfers.find((x) => x.id === required(c, "transfer"));
        if (!transfer) throw Error("Transfer not found");
        if (action === "approve") {
          if (transfer.requestedBy && (transfer.requestedBy === actor.id || transfer.requestedBy === actor.name)) {
            throw Error("Transfer requester and approver must be different staff members");
          }
          if (actor.role !== "Admin" && actor.role !== "Supervisor") throw Error("Only a supervisor or admin can approve transfers");
          if (!["Draft", "Requested"].includes(transfer.status)) throw Error("Only requested transfers can be approved");
          transfer.approvedBy = actor.name || actor.id;
          transfer.approvedAt = new Date().toISOString();
          transfer.status = "Approved";
          reference = transfer.id;
          detail = `Transfer approved by ${transfer.approvedBy}`;
        } else if (action === "dispatch") {
          if (transfer.sourceType === "Warehouse") {
            if (transfer.status !== "Packed") throw Error("Warehouse transfer must be picked and packed before dispatch");
            for (const allocation of transfer.allocations || []) {
              const lot = find(s.lots, allocation.lot);
              if (lot.reserved < allocation.qty) throw Error(`Warehouse transfer reservation is no longer available for ${allocation.product}`);
              lot.qty -= allocation.qty;
              lot.reserved -= allocation.qty;
            }
          } else {
            if (transfer.status !== "Approved") throw Error("Transfer approval is required before dispatch");
            for (const line of transfer.lines) {
              const stock = s.storeStock.find((x) => x.store === transfer.source && x.product === line.product);
              if (!stock || stock.qty < line.qty) throw Error(`Insufficient shop stock for ${line.product}`);
              stock.qty -= line.qty;
            }
          }
          transfer.status = "In Transit";
          transfer.dispatchedBy = actor.name || actor.id;
          transfer.dispatchedAt = new Date().toISOString();
          reference = transfer.id;
          detail = `${transfer.sourceType === "Warehouse" ? "Warehouse stock" : "Shop stock"} moved into transit by ${transfer.dispatchedBy}; destination stock unchanged`;
        } else if (action === "pick" || action === "pack") {
          if (transfer.sourceType !== "Warehouse") throw Error("Pick and pack steps apply to warehouse transfers only");
          if (action === "pick" && transfer.status !== "Approved") throw Error("Transfer must be approved before picking");
          if (action === "pack" && transfer.status !== "Picked") throw Error("Transfer must be picked before packing");
          transfer.status = action === "pick" ? "Picked" : "Packed";
          if (action === "pick") { transfer.pickedBy = actor.name || actor.id; transfer.pickedAt = new Date().toISOString(); }
          else { transfer.packedBy = actor.name || actor.id; transfer.packedAt = new Date().toISOString(); }
          reference = transfer.id; detail = `Warehouse transfer ${action} confirmed by ${actor.name || actor.id}`;
        } else if (action === "receive") {
          if (!["Dispatched", "In Transit"].includes(transfer.status)) throw Error("Only dispatched transfers can be received");
          const received = c.received ? JSON.parse(String(c.received)) : transfer.lines;
          if (!Array.isArray(received)) throw Error("Received quantities must be valid JSON");
          let discrepancy = false;
          for (const line of transfer.lines) {
            const actual = Number(received.find((x: { product: string }) => x.product === line.product)?.qty ?? 0);
            if (!Number.isSafeInteger(actual) || actual < 0 || actual > line.qty) throw Error("Received quantity must be between zero and dispatched quantity");
            if (transfer.destinationType === "Warehouse") {
              let remaining = actual;
              if (remaining > 0) {
                const used = occupiedByLocation(s.lots);
                const destinations = s.locations.filter((location) => location.warehouse === transfer.destinationWarehouse &&
                  !location.blocked && (!location.assignedProduct || location.assignedProduct === line.product));
                for (const allocation of transfer.allocations ?? []) {
                  if (!remaining) break;
                  if (allocation.product !== line.product) continue;
                  const source = find(s.lots, allocation.lot);
                  let unplaced = Math.min(remaining, allocation.qty);
                  for (const destination of destinations) {
                    if (!unplaced) break;
                    const occupied = used.get(destination.id) ?? 0;
                    const qty = Math.min(unplaced, Math.max(0, destination.capacity - occupied));
                    if (!qty) continue;
                    s.lots.push({ ...source, id: id("LOT"), location: destination.id, qty, reserved: 0, receiptId: undefined });
                    used.set(destination.id, occupied + qty);
                    unplaced -= qty;
                    remaining -= qty;
                  }
                  if (unplaced) throw Error("Destination warehouse has insufficient compatible capacity");
                }
                if (remaining) throw Error("Transfer allocation does not cover received quantity");
              }
            } else {
              const stock = s.storeStock.find((x) => x.store === transfer.destination && x.product === line.product);
              if (stock) stock.qty += actual; else s.storeStock.push({ store: transfer.destination, product: line.product, qty: actual });
            }
            if (actual !== line.qty) {
              discrepancy = true;
              s.events.unshift({ id: id("EVT"), at: new Date().toISOString(), actor: actor.name || actor.id, action: "transfer-shortage", reference: transfer.id, detail: `${line.product}: dispatched ${line.qty}, received ${actual}` });
            }
          }
          transfer.status = discrepancy ? "Received with Discrepancy" : "Received";
          transfer.discrepancyReason = discrepancy ? String(c.reason || "Quantity discrepancy recorded at destination") : undefined;
          transfer.receivedBy = actor.name || actor.id;
          transfer.receivedAt = new Date().toISOString();
          reference = transfer.id;
          detail = `Destination ${transfer.destinationType === "Warehouse" ? "warehouse" : "shop"} confirmed receipt by ${transfer.receivedBy}`;
        } else if (action === "cancel") {
          if (transfer.status !== "Draft") throw Error("Only draft transfers can be cancelled");
          for (const allocation of transfer.allocations || []) find(s.lots, allocation.lot).reserved -= allocation.qty;
          transfer.status = "Cancelled"; reference = transfer.id; detail = "Transfer cancelled";
        } else throw Error("Invalid transfer action");
      }
      break;
    }
    case "cancel": {
      const o = find(s.orders, required(c, "order"));
      if (!["Reserved", "Picking", "Picked", "Packing", "Packed", "Short picked"].includes(o.status))
        throw Error("This order cannot be cancelled");
      for (const a of o.allocations) find(s.lots, a.lot).reserved -= a.qty;
      o.allocations = [];
      o.status = "Cancelled";
      reference = o.id;
      detail = required(c, "reason");
      break;
    }
    case "return": {
      const o = find(s.orders, required(c, "order"));
      if (o.status !== "Dispatched")
        throw Error("Returns require a dispatched order");
      const product = String(c.product || (o.lines.length === 1 ? o.lines[0].product : "")).trim();
      if (!product) throw Error("Choose the returned product for a multi-line order");
      const line = o.lines.find((item) => item.product === product);
      if (!line) throw Error("Returned product is not part of the order");
      const qty = number(c, "qty");
      const returned = s.returns
        .filter((r) => r.order === o.id && (!r.product || r.product === product))
        .reduce((n, r) => n + r.qty, 0);
      if (returned + qty > line.picked)
        throw Error("Return exceeds shipped quantity remaining");
      const disposition = required(c, "disposition");
      if (!["Restock", "Quarantine"].includes(disposition))
        throw Error("Invalid disposition");
      const reason = required(c, "reason");
      reference = id("RET");
      if (disposition === "Restock") {
        const expiry = date(c);
        s.lots.push({
          id: id("LOT"),
          product,
          batch: required(c, "batch"),
          expiry,
          location: "RECEIVING",
          qty,
          reserved: 0,
        });
      }
      s.returns.push({ id: reference, order: o.id, product, qty, disposition, reason });
      detail = `${qty} returned from ${o.id}: ${disposition}. ${reason}`;
      break;
    }
    case "quarantineLot": {
      const lot = find(s.lots, required(c, "lot"));
      if (lot.qty <= 0) throw Error("Lot has no quantity to quarantine");
      if (lot.expiry >= today()) throw Error("Only expired lots can be moved to quarantine");
      if (lot.reserved !== 0) throw Error("Reserved stock cannot be moved to quarantine");
      const warehouse = lotWarehouse(s, lot);
      if (!warehouse) throw Error("Lot warehouse could not be determined");
      const target = s.locations.find((location) => location.warehouse === warehouse && location.zone === "QUARANTINE");
      if (!target) throw Error(`No quarantine location configured for warehouse ${warehouse}`);
      const used = s.lots.filter((item) => item.location === target.id).reduce((sum, item) => sum + item.qty, 0);
      if (used + lot.qty > target.capacity) throw Error("Quarantine location capacity exceeded");
      const source = lot.location;
      lot.location = target.id;
      reference = lot.id;
      detail = `${lot.qty} expired units moved from ${source} to quarantine at ${target.id}`;
      break;
    }
    case "request": {
      const lot = find(s.lots, required(c, "lot"));
      if (lot.location === "RECEIVING")
        throw Error("Complete put away before inventory controls");
      const kind = required(c, "kind");
      if (
        !["Adjustment", "Cycle count", "Transfer", "Replenishment"].includes(
          kind,
        )
      )
        throw Error("Invalid inventory operation");
      const qty = number(c, "qty", kind === "Cycle count");
      const reason = required(c, "reason");
      const destination = ["Transfer", "Replenishment"].includes(kind)
        ? required(c, "destination")
        : "";
      if (destination) find(s.locations, destination);
      reference = id("REQ");
      s.approvals.push({
        id: reference,
        kind,
        lot: lot.id,
        qty,
        destination,
        reason,
        observedQty: lot.qty,
        requestedBy: actor.id,
        status: "Pending",
      });
      detail = `${kind} requested: ${qty}. ${reason}`;
      break;
    }
    case "approve": {
      const req = find(s.approvals, required(c, "request"));
      if (req.status !== "Pending")
        throw Error("Request has already been processed");
      if (req.requestedBy === actor.id)
        throw Error("A different supervisor or admin must review this request");
      const decision = required(c, "decision");
      if (!["Approve", "Reject"].includes(decision))
        throw Error("Invalid approval decision");
      if (decision === "Reject") {
        req.status = "Rejected";
        reference = req.id;
        detail = required(c, "reason");
        break;
      }
      const lot = find(s.lots, req.lot);
      if (req.kind === "Transfer" || req.kind === "Replenishment") {
        if (
          req.kind === "Replenishment" &&
          find(s.locations, req.destination).kind !== "Pick face"
        )
          throw Error("Replenishment destination must be a pick face");
        move(lot, req.qty, req.destination);
      } else if (req.kind === "Cycle count") {
        if (req.observedQty !== undefined && lot.qty !== req.observedQty)
          throw Error(
            "Stock moved after this count was requested; reject and recount",
          );
        if (req.qty < lot.reserved)
          throw Error("Count cannot be below reserved quantity");
        if (req.qty > lot.qty) capacity(lot.location, req.qty - lot.qty);
        lot.qty = req.qty;
      } else {
        if (req.qty > lot.qty - lot.reserved)
          throw Error("Adjustment exceeds unreserved physical stock");
        lot.qty -= req.qty;
      }
      req.status = "Approved";
      reference = req.id;
      detail = `${req.kind} approved by second reviewer: ${req.qty}. ${req.reason}`;
      break;
    }
    case "createLayoutZone": {
      const warehouse = required(c, "warehouse"), zone = required(c, "zone");
      find(s.warehouses, warehouse);
      if (hasLayoutGroup(s, { warehouse, zone })) throw Error("That zone already exists in this warehouse");
      (s.layoutBlocks ??= []).push({ warehouse, zone, ...readLayoutRect(c) });
      reference = layoutReference({ warehouse, zone });
      detail = "Created warehouse zone";
      break;
    }
    case "saveWarehouseLayout": {
      const warehouse = required(c, "warehouse");
      find(s.warehouses, warehouse);
      if (!Array.isArray(c.blocks) || !c.blocks.length) throw Error("Provide at least one layout block");
      const updates = new Map<string, LayoutBlock>();
      for (const input of c.blocks) {
        if (!input || typeof input !== "object") throw Error("Invalid layout block");
        const zone = required(input, "zone");
        const rack = input.rack === undefined ? undefined : required(input, "rack");
        const path = { warehouse, zone, rack };
        if (!hasLayoutGroup(s, path)) throw Error("A layout block was renamed or removed. Refresh the map before saving.");
        const key = layoutReference(path);
        if (updates.has(key)) throw Error("Duplicate layout block");
        const current = s.layoutBlocks?.find((block) => layoutReference(block) === key);
        const expected = input.expected;
        if (expected === null ? Boolean(current) : !current || !expected ||
          current.x !== expected.x || current.y !== expected.y ||
          current.width !== expected.width || current.height !== expected.height)
          throw Error("This layout was updated elsewhere. Discard the draft and refresh before saving again.");
        updates.set(key, { ...path, ...readLayoutRect(input, rack) });
      }
      s.layoutBlocks = [...(s.layoutBlocks ?? []).filter((block) => !updates.has(layoutReference(block))), ...updates.values()];
      reference = warehouse;
      detail = `Saved positions and sizes for ${updates.size} layout blocks`;
      break;
    }
    case "configureLayoutSection": {
      const { warehouse, zone, rack, section } = readLayoutPath(c);
      if (!rack || !section || !hasLayoutGroup(s, { warehouse, zone, rack })) throw Error("Select a rack and section");
      const path = { warehouse, zone, rack, section };
      const members = s.locations.filter((location) => inLayoutPath(location, path));
      const configured = s.layoutSections?.find((item) => layoutReference(item) === layoutReference(path));
      const oldGrid = rackGridFor(s, warehouse, zone, rack);
      const inherited = oldGrid && section === (oldGrid.section ?? `${rack}-01`);
      const exists = Boolean(members.length || configured || inherited);
      if (c.create === true ? exists : !exists) throw Error(c.create === true ? "Section ID already exists in this rack" : "Section not found");
      reference = layoutReference(path);
      const previousRows = members.reduce((max, location) => Math.max(max, locationPosition(location).row),
        configured?.rows ?? (inherited ? oldGrid.rows : Number(exists)));
      const previousColumns = members.reduce((max, location) => Math.max(max, locationPosition(location).column),
        configured?.columns ?? (inherited ? oldGrid.columns : Number(exists)));
      const removedRows = new Set(configured?.removedRows);
      const removedColumns = new Set(configured?.removedColumns);
      const removed = new Set<string>();
      if (c.targetRow !== undefined || c.rowName !== undefined) {
        const rowName = c.rowName === undefined ? undefined : required(c, "rowName");
        const savedNames = configured?.rowNames ?? {};
        const matchingName = rowName && Object.entries(savedNames).find(([, name]) => name.toLowerCase() === rowName.toLowerCase());
        const numberedName = rowName?.match(/^Row\s+(\d+)$/i);
        const row = matchingName ? Number(matchingName[0]) : numberedName ? number({ row: numberedName[1] }, "row") :
          rowName ? previousRows + 1 : number(c, "targetRow");
        const columnCount = number(c, "columnCount"), capacity = number(c, "capacity");
        const existingUnits = members.filter((location) => locationPosition(location).row === row);
        const columns = new Set(existingUnits.map((unit) => locationPosition(unit).column));
        if (columnCount < columns.size) throw Error(`Row ${row} already has ${columns.size} columns. Use Remove column to remove storage.`);
        if (members.length + columnCount - columns.size > 1000) throw Error("A section can contain up to 1,000 storage units");
        const declaredRows = configured?.rows ?? (inherited ? oldGrid.rows : 0);
        const rowNumbers = new Set(configured?.rowNumbers ??
          Array.from({ length: declaredRows }, (_, index) => index + 1).filter((index) => !removedRows.has(index)));
        for (const location of members) rowNumbers.add(locationPosition(location).row);
        rowNumbers.add(row);
        removedRows.delete(row);
        let column = Math.max(0, ...columns);
        const ids = new Set(s.locations.map((location) => location.id));
        const added = columnCount - columns.size;
        for (let index = 0; index < added; index++) {
          do { column++; } while (removedColumns.has(column));
          const key = `${layoutReference(path)}/R${row}C${column}`;
          const id = key.length > 300 || ids.has(key) ? `UNIT-${crypto.randomUUID()}` : key;
          ids.add(id);
          s.locations.push({ ...path, id, name: `R${row}C${column}`, row, column, capacity, kind: "Storage" });
        }
        s.layoutSections = [...(s.layoutSections ?? []).filter((item) => item !== configured), {
          ...path, rows: Math.max(previousRows, row), columns: Math.max(previousColumns, column),
          rowNumbers: [...rowNumbers], removedRows: [...removedRows], removedColumns: [...removedColumns],
          ...(rowName || configured?.rowNames ? { rowNames: { ...savedNames, ...(rowName ? { [row]: savedNames[row] ?? rowName } : {}) } } : {}),
        }];
        if (inherited) s.rackGrids = s.rackGrids?.filter((grid) => grid !== oldGrid);
        detail = `Added ${added} storage units to row ${row}`;
        break;
      }
      if (c.removeAxis !== undefined) {
        const axis = required(c, "removeAxis");
        if (axis !== "row" && axis !== "column") throw Error("Choose a row or column to remove");
        const index = number(c, axis, true);
        const limit = axis === "row" ? previousRows : previousColumns;
        const removedIndexes = axis === "row" ? removedRows : removedColumns;
        const selectedUnits = members.filter((location) => locationPosition(location)[axis] === index);
        if (removedIndexes.has(index) || (index === 0 ? !selectedUnits.length : index > limit))
          throw Error(`That ${axis} does not exist`);
        if (selectedUnits.some((location) => hasStoredStock(s, location)))
          throw Error(`Move all stock out before removing this ${axis}`);
        assertNoReferencedLots(s, s.lots.filter((lot) => selectedUnits.some((location) => location.id === lot.location)));
        for (const location of selectedUnits) removed.add(location.id);
        removedIndexes.add(index);
        s.layoutSections = [...(s.layoutSections ?? []).filter((item) => item !== configured), {
          ...path, rows: previousRows, columns: previousColumns, removedRows: [...removedRows], removedColumns: [...removedColumns],
          ...(configured?.rowNumbers ? { rowNumbers: configured.rowNumbers.filter((number) => axis !== "row" || number !== index) } : {}),
          ...(configured?.rowNames ? { rowNames: Object.fromEntries(Object.entries(configured.rowNames).filter(([row]) =>
            axis !== "row" || Number(row) !== index)) } : {}),
        }];
        if (inherited) s.rackGrids = s.rackGrids?.filter((grid) => grid !== oldGrid);
        detail = `Removed ${axis} ${index}`;
      } else if (c.remove === true) {
        if (members.some((location) => hasStorageAllocation(s, location)))
          throw Error("Move all stock out and clear product assignments before removing the section");
        assertNoReferencedLots(s, s.lots.filter((lot) => members.some((location) => location.id === lot.location)));
        for (const location of members) removed.add(location.id);
        s.layoutSections = s.layoutSections?.filter((item) => item !== configured);
        if (inherited) s.rackGrids = s.rackGrids?.filter((grid) => grid !== oldGrid);
        if (!s.layoutBlocks?.some((block) => block.warehouse === warehouse && block.zone === zone && block.rack === rack)) {
          const rect = c.rackRect && typeof c.rackRect === "object" ? readLayoutRect(c.rackRect as Record<string, unknown>, rack) :
            { x: 12, y: 12, width: 320, height: 108 };
          (s.layoutBlocks ??= []).push({ warehouse, zone, rack, ...rect });
        }
        detail = "Removed rack section";
      } else {
        const axis = c.appendAxis === undefined ? undefined : required(c, "appendAxis");
        if (axis !== undefined && axis !== "row" && axis !== "column") throw Error("Choose rows or columns to add");
        const append = axis !== undefined || c.addRows !== undefined || c.addColumns !== undefined;
        const to = append || c.to === undefined ? section : required(c, "to");
        const target = { ...path, section: to };
        if (to !== section && (s.locations.some((location) => inLayoutPath(location, target)) ||
          s.layoutSections?.some((item) => layoutReference(item) === layoutReference(target)) ||
          (oldGrid && to === (oldGrid.section ?? `${rack}-01`)))) throw Error("Section ID already exists in this rack");
        const restore = !append && c.restoreUnit === true;
        const addRows = axis === "row" ? number(c, "count") : number({ addRows: c.addRows ?? 0 }, "addRows", true);
        const addColumns = axis === "column" ? number(c, "count") : number({ addColumns: c.addColumns ?? 0 }, "addColumns", true);
        if (append && !addRows && !addColumns) throw Error("Add at least one row or column");
        const needsRow = !addRows && [...removedRows].filter((index) => index > 0 && index <= previousRows).length === previousRows;
        const needsColumn = !addColumns && [...removedColumns].filter((index) => index > 0 && index <= previousColumns).length === previousColumns;
        const rows = append ? previousRows + addRows + Number(needsRow) :
          restore ? configured?.rows ?? (inherited ? oldGrid.rows : 0) : number(c, "rows");
        const columns = append ? previousColumns + addColumns + Number(needsColumn) :
          restore ? configured?.columns ?? (inherited ? oldGrid.columns : 0) : number(c, "columns");
        if (!rows || !columns || rows * columns > 1000) throw Error("A section can contain up to 1,000 storage units");
        const restoreRow = restore ? number(c, "row") : 0;
        const restoreColumn = restore ? number(c, "column") : 0;
        if (restoreRow > rows || restoreColumn > columns) throw Error("Storage unit position is outside the section");
        const ids = new Set(s.locations.map((location) => location.id));
        const retained = new Set<string>();
        for (const location of members) {
          const position = locationPosition(location);
          const row = Math.max(1, position.row), column = Math.max(1, position.column);
          if (row > rows || column > columns) {
            if (hasStorageAllocation(s, location)) throw Error(`Clear stock and product assignments from ${location.id} before resizing`);
            removed.add(location.id);
          } else {
            if (!append) Object.assign(location, { zone, rack, section: to, row, column });
            retained.add(`${row}:${column}`);
          }
        }
        const sectionCapacity = restore || append ? 0 : number(c, "capacity");
        const retainedUnits = members.filter((location) => !removed.has(location.id));
        const newUnitCapacity = append ? number(c, "capacity") : restore
          ? Math.max(1, Math.round(retainedUnits.reduce((sum, location) => sum + location.capacity, 0) / Math.max(1, retainedUnits.length)))
          : Math.max(1, Math.floor(sectionCapacity / (rows * columns)));
        const additions: Location[] = [];
        for (let row = 1; row <= rows; row++) {
          for (let column = 1; column <= columns; column++) {
            if (removedRows.has(row) || removedColumns.has(column)) continue;
            if (append && row <= previousRows && column <= previousColumns) continue;
            if (restore && (row !== restoreRow || column !== restoreColumn)) continue;
            if (retained.has(`${row}:${column}`)) continue;
            const key = `${layoutReference(target)}/R${row}C${column}`;
            const unitId = key.length > 300 || ids.has(key) ? `UNIT-${crypto.randomUUID()}` : key;
            ids.add(unitId);
            additions.push({ id: unitId, name: `R${row}C${column}`, warehouse, zone, rack, section: to, row, column,
              capacity: restore && inherited ? oldGrid.capacity : newUnitCapacity, kind: "Storage" });
          }
        }
        if (!restore && !append) setLayoutCapacity(s, [...retainedUnits, ...additions], sectionCapacity);
        s.locations.push(...additions);
        s.layoutSections = [...(s.layoutSections ?? []).filter((item) => item !== configured), {
          ...target, rows, columns,
          ...(removedRows.size ? { removedRows: [...removedRows] } : {}),
          ...(removedColumns.size ? { removedColumns: [...removedColumns] } : {}),
        }];
        if (inherited) s.rackGrids = s.rackGrids?.filter((grid) => grid !== oldGrid);
        detail = append ? `Added ${rows - previousRows} rows and ${columns - previousColumns} columns (${additions.length} storage units)` :
          restore ? `Restored unit R${restoreRow}C${restoreColumn}` : `Configured section ${to} with ${rows} rows and ${columns} columns`;
      }
      s.locations = s.locations.filter((location) => !removed.has(location.id));
      break;
    }
    case "setLayoutRowCapacity": {
      const path = readLayoutPath(c);
      if (!path.rack || !path.section || path.row === undefined) throw Error("Choose an exact storage row");
      setLayoutCapacity(s, s.locations.filter((location) => inLayoutPath(location, path)), number(c, "capacity"));
      reference = layoutReference(path);
      detail = "Updated row capacity";
      break;
    }
    case "configureRack": {
      const warehouse = required(c, "warehouse"), zone = required(c, "zone"), rack = required(c, "rack");
      find(s.warehouses, warehouse);
      const existing = rackGridFor(s, warehouse, zone, rack);
      if (c.newZone === true && (s.rackGrids?.some((grid) => grid.warehouse === warehouse && grid.zone === zone) ||
        s.locations.some((location) => location.warehouse === warehouse && locationPosition(location).zone === zone)))
        throw Error("That zone already exists in this warehouse");
      const members = s.locations.filter((location) => {
        const position = locationPosition(location);
        return location.warehouse === warehouse && position.zone === zone && position.rack === rack;
      });
      if (c.layout === true && !hasLayoutGroup(s, { warehouse, zone })) throw Error("Choose an existing zone");
      if (c.create !== true && s.layoutSections?.some((section) => section.warehouse === warehouse && section.zone === zone && section.rack === rack))
        throw Error("Configure rows and columns in the individual rack sections");
      if (c.create === true && hasLayoutGroup(s, { warehouse, zone, rack })) throw Error("That rack already exists in this zone");
      if (c.create !== true && !existing && !members.length) throw Error("Rack not found");
      const restore = c.restoreRow !== undefined;
      if (restore && !existing) throw Error("Configure the rack before adding individual units");
      const rows = restore && existing ? existing.rows : number(c, "rows");
      const columns = restore && existing ? existing.columns : number(c, "columns");
      const capacity = restore && existing ? existing.capacity : number(c, "capacity");
      const restoreRow = restore ? number(c, "restoreRow") : 0;
      const restoreColumn = restore ? number(c, "restoreColumn") : 0;
      if (restoreRow > rows || restoreColumn > columns) throw Error("Storage unit position is outside the rack");
      if (rows * columns > 1000) throw Error("A rack can contain at most 1,000 storage units");
      const coordinates = rackCoordinates(members);
      const retained = new Set<string>();
      const removed = new Set<string>();
      for (const location of members) {
        const { row, column } = coordinates.get(location.id)!;
        if (row > rows || column > columns) {
          if (hasStorageAllocation(s, location)) throw Error(`Clear stock and product assignments from ${location.id} before resizing`);
          removed.add(location.id);
        } else {
          Object.assign(location, { zone, rack, row, column, section: existing?.section, shelf: 1 });
          retained.add(`${row}:${column}`);
        }
      }
      s.locations = s.locations.filter((location) => !removed.has(location.id));
      const ids = new Set(s.locations.map((location) => location.id));
      for (let row = 1; row <= rows; row++) {
        for (let column = 1; column <= columns; column++) {
          if (restore && (row !== restoreRow || column !== restoreColumn)) continue;
          if (retained.has(`${row}:${column}`)) continue;
          const reference = storageUnitReference(warehouse, zone, rack, row, column);
          const unitId = reference.length > 300 || ids.has(reference) ? `UNIT-${crypto.randomUUID()}` : reference;
          s.locations.push({ id: unitId, name: `R${row}C${column}`, warehouse, zone, rack, row, column, capacity, section: existing?.section, kind: "Storage" });
          ids.add(unitId);
        }
      }
      if (existing) Object.assign(existing, { rows, columns, capacity });
      else (s.rackGrids ??= []).push({ warehouse, zone, rack, rows, columns, capacity });
      reference = `${warehouse} / ${zone} / ${rack}`;
      detail = restore ? `Restored storage unit R${restoreRow}C${restoreColumn}` : `Configured rack as ${rows} rows by ${columns} columns`;
      break;
    }
    case "master": {
      const entity = required(c, "entity");
      const entityId = required(c, "id");
      reference = entityId;
      const name = required(c, "name");
      if (entity === "Product") {
        const defaults = productDefaultDates(c);
        if (
          s.products.some(
            (p) => p.id === entityId || p.barcode === required(c, "barcode"),
          )
        )
          throw Error("SKU or barcode already exists");
        s.products.push({
          id: entityId,
          name,
          category: required(c, "category"),
          barcode: required(c, "barcode"),
          minimum: number(c, "minimum", true),
          price: money(c),
          promotion: String(c.promotion || ""),
          unit: String(c.unit || "unit"),
          brand: String(c.brand || ""),
          productType: (["Perishable", "Non-perishable", "Serialized"].includes(String(c.productType)) ? String(c.productType) : "Non-perishable") as Product["productType"],
          expiryTracking: c.expiryTracking !== false && c.expiryTracking !== "false",
          serialTracking: c.serialTracking === true || c.serialTracking === "true",
          ...defaults,
        });
      } else if (entity === "Warehouse") {
        if (s.warehouses.some((w) => w.id === entityId))
          throw Error("Warehouse already exists");
        s.warehouses.push({ id: entityId, name });
      } else if (entity === "Location") {
        if (
          s.locations.some((l) => l.id === entityId) ||
          entityId === "RECEIVING"
        )
          throw Error("Location ID unavailable");
        find(s.warehouses, required(c, "warehouse"));
        const kind = required(c, "kind");
        if (!["Storage", "Pick face"].includes(kind))
          throw Error("Invalid location kind");
        const location: Location = {
          id: entityId,
          name,
          warehouse: required(c, "warehouse"),
          capacity: number(c, "capacity"),
          kind: kind as Location["kind"],
          zone: String(c.zone || entityId.split("-")[0]).trim(),
          rack: String(c.rack || entityId.split("-")[1] || "").trim(),
          section: String(c.section || "").trim() || undefined,
          row: c.row === undefined || c.row === "" ? undefined : number(c, "row", true),
          column: c.column === undefined || c.column === "" ? undefined : number(c, "column", true),
          shelf: c.shelf === undefined ? undefined : number(c, "shelf"),
          blocked: c.blocked === "Blocked" || undefined,
        };
        if (c.mapCreate === true) {
          location.zone = required(c, "zone");
          location.rack = required(c, "rack");
          const position = locationPosition(location);
          const peers = s.locations.filter((other) => other.warehouse === location.warehouse && locationPosition(other).zone === position.zone);
          if (c.mapMode === "zone" && peers.length) throw Error("That zone already exists");
          if (c.mapMode === "rack" && peers.some((other) => locationPosition(other).rack === position.rack))
            throw Error("That rack already exists in this zone");
          if (c.mapMode === "section" && peers.some((other) => locationPosition(other).rack === position.rack && locationPosition(other).section === position.section))
            throw Error("That section already exists in this rack");
          validateMapLocation(s.locations, location);
        }
        const position = locationPosition(location);
        if (rackGridFor(s, location.warehouse, position.zone, position.rack) || s.layoutSections?.some((section) => inLayoutPath(location, section)))
          throw Error("Manage storage units through the rack grid");
        s.locations.push(location);
      } else if (entity === "Supplier") {
        if (s.suppliers.some((x) => x.id === entityId))
          throw Error("Supplier already exists");
        s.suppliers.push({ id: entityId, name });
      } else throw Error("Invalid master type");
      detail = `Created ${entity}: ${name}`;
      break;
    }
    case "sampleProduct": {
      const action = String(c.action || "create");
      const idValue = required(c, "id");
      const barcode = required(c, "barcode");
      if (action === "delete") {
        const index = s.sampleProducts.findIndex((p) => p.id === idValue);
        if (index < 0) throw Error("Sample product not found");
        s.sampleProducts.splice(index, 1);
        reference = idValue; detail = `Deleted sample product ${idValue}`;
      } else {
        if (s.products.some((p) => p.barcode === barcode) || s.sampleProducts.some((p) => p.barcode === barcode && p.id !== idValue)) throw Error("Barcode already assigned");
        const next: SampleProduct = { id: idValue, name: required(c, "name"), category: required(c, "category"), barcode, unit: String(c.unit || "unit"), brand: String(c.brand || ""), productType: (["Perishable", "Non-perishable", "Serialized"].includes(String(c.productType)) ? String(c.productType) : "Non-perishable") as SampleProduct["productType"], expiryTracking: c.expiryTracking === true || c.expiryTracking === "true", serialTracking: c.serialTracking === true || c.serialTracking === "true", warehouse: String(c.warehouse || s.warehouses[0]?.id || ""), batch: String(c.batch || ""), manufacturingDate: historicalDate(c.manufacturingDate, "Manufacturing date"), expiry: historicalDate(c.expiry, "Expiry date"), sample: true };
        const existing = s.sampleProducts.find((p) => p.id === idValue);
        if (existing) Object.assign(existing, next); else s.sampleProducts.push(next);
        reference = idValue; detail = `${existing ? "Updated" : "Created"} sample product ${idValue}`;
      }
      break;
    }
    case "registerSampleProducts": {
      if (!s.sampleProducts.length) throw Error("No Sample Dataset products to register");
      for (const sample of s.sampleProducts) {
        if (s.products.some((product) => product.id === sample.id || product.barcode === sample.barcode))
          throw Error(`Cannot register ${sample.name}: its SKU or barcode is already in Product Master`);
      }
      const registered = s.sampleProducts.map((sample): Product => ({
        id: sample.id,
        name: sample.name,
        category: sample.category,
        barcode: sample.barcode,
        minimum: 0,
        price: sample.price || 0,
        promotion: sample.promotion || "",
        unit: sample.unit || "unit",
        brand: sample.brand || "",
        productType: sample.productType || "Non-perishable",
        expiryTracking: sample.expiryTracking !== false,
        serialTracking: sample.serialTracking === true,
        ...(sample.manufacturingDate ? { defaultManufacturingDate: sample.manufacturingDate } : {}),
        ...(sample.expiry ? { defaultExpiry: sample.expiry } : {}),
      }));
      s.products.push(...registered);
      s.sampleProducts = [];
      reference = "SAMPLE-DATASET";
      detail = `Registered ${registered.length} Sample Dataset product${registered.length === 1 ? "" : "s"}`;
      break;
    }
    case "deleteMaster": {
      const entity = required(c, "entity"), key = required(c, "id");
      if (entity !== "Location") throw Error("Only locations can be deleted here");
      const location = find(s.locations, key);
      const locationLots = s.lots.filter((lot) => lot.location === key);
      const activeLot = locationLots.find((lot) => lot.qty > 0 || lot.reserved > 0);
      if (activeLot || hasStorageAllocation(s, location))
        throw Error("Move all stock out and clear product assignments before deleting this location");
      assertNoReferencedLots(s, locationLots);
      s.lots = s.lots.filter((lot) => lot.location !== key);
      if (c.preserveLayout === true) {
        const { zone, rack, section } = locationPosition(location);
        const path = { warehouse: location.warehouse, zone, rack, section };
        if (!s.layoutSections?.some((item) => layoutReference(item) === layoutReference(path))) {
          const grid = rackGridFor(s, location.warehouse, zone, rack);
          const members = s.locations.filter((unit) => inLayoutPath(unit, path)).map(locationPosition);
          const rows = Math.max(grid?.rows ?? 1, ...members.map((position) => position.row));
          const columns = Math.max(grid?.columns ?? 1, ...members.map((position) => position.column));
          (s.layoutSections ??= []).push({ ...path, rows, columns });
          if (grid && section === (grid.section ?? `${rack}-01`)) s.rackGrids = s.rackGrids?.filter((item) => item !== grid);
        }
      }
      s.locations = s.locations.filter((item) => item.id !== key);
      reference = key;
      detail = `Deleted location: ${location.id}`;
      break;
    }
    case "editMapGroup": {
      const warehouse = required(c, "warehouse"), zone = required(c, "zone");
      const rack = c.rack === undefined ? undefined : required(c, "rack");
      const locations = s.locations.filter((location) => location.warehouse === warehouse);
      const inZone = locations.filter((location) => locationPosition(location).zone === zone);
      const members = rack === undefined ? inZone : inZone.filter((location) => locationPosition(location).rack === rack);
      const grids = (s.rackGrids || []).filter((grid) => grid.warehouse === warehouse && grid.zone === zone && (rack === undefined || grid.rack === rack));
      const groups = (item: { warehouse: string; zone: string; rack?: string }) =>
        item.warehouse === warehouse && item.zone === zone && (rack === undefined || item.rack === rack);
      if (!hasLayoutGroup(s, { warehouse, zone, rack })) throw Error("Map group not found");
      reference = rack === undefined ? zone : `${zone} / ${rack}`;
      if (c.remove === true) {
        const ids = new Set(members.map((location) => location.id));
        if (members.some((location) => c.stockOnly === true ? hasStoredStock(s, location) : hasStorageAllocation(s, location)))
          throw Error(c.stockOnly === true ? "Move all stock out before removing this group" : "Move all stock out and clear product assignments before removing this group");
        assertNoReferencedLots(s, s.lots.filter((lot) => members.some((location) => location.id === lot.location)));
        s.locations = s.locations.filter((location) => !ids.has(location.id));
        s.rackGrids = s.rackGrids?.filter((grid) => !grids.includes(grid));
        s.layoutBlocks = s.layoutBlocks?.filter((block) => !groups(block));
        s.layoutSections = s.layoutSections?.filter((section) => !groups(section));
        detail = `Removed ${reference}`;
      } else {
        const to = required(c, "to");
        if (hasLayoutGroup(s, { warehouse, zone: rack === undefined ? to : zone, rack: rack === undefined ? undefined : to }))
          throw Error("That name is already in use");
        if (rack !== undefined) {
          for (const grid of grids) grid.section ??= `${rack}-01`;
        }
        for (const item of [...grids, ...(s.layoutBlocks ?? []).filter(groups), ...(s.layoutSections ?? []).filter(groups)]) {
          if (rack === undefined) item.zone = to;
          else item.rack = to;
        }
        for (const location of members) {
          const position = locationPosition(location);
          location.rack = position.rack;
          location.section = position.section;
          if (rack === undefined) location.zone = to;
          else location.rack = to;
        }
        if (members.some((location) => location.assignedProduct && !followsProductOrder(s, location, location.assignedProduct)))
          throw Error("This change would move an assigned location out of alphabetical order");
        detail = `Renamed ${reference} to ${to}`;
      }
      break;
    }
    case "renameZone": {
      const from = required(c, "from"), to = required(c, "to");
      if ([...(s.rackGrids ?? []), ...(s.layoutBlocks ?? []), ...(s.layoutSections ?? [])].some((grid) => grid.zone === from || grid.zone === to))
        throw Error("Use the warehouse map to rename configured zones");
      if (from === to) throw Error("Choose a different zone name");
      const matches = s.locations.filter((location) => (location.zone || location.id.split("-")[0]) === from);
      if (!matches.length) throw Error("Zone not found");
      if (s.locations.some((location) => (location.zone || location.id.split("-")[0]) === to)) throw Error("Zone name already exists");
      matches.forEach((location) => { location.zone = to; });
      reference = from;
      detail = `Renamed zone ${from} to ${to}`;
      break;
    }
    case "renameRack": {
      const zone = required(c, "zone"), from = required(c, "from"), to = required(c, "to");
      if (from === to) throw Error("Choose a different rack name");
      if ([...(s.rackGrids ?? []), ...(s.layoutBlocks ?? []), ...(s.layoutSections ?? [])].some((grid) => grid.zone === zone && grid.rack && [from, to].includes(grid.rack)))
        throw Error("Use the warehouse map to rename configured racks");
      const matches = s.locations.filter((location) => (location.zone || location.id.split("-")[0]) === zone && (location.rack || location.id.split("-")[1]) === from);
      if (!matches.length) throw Error("Rack not found");
      if (s.locations.some((location) => (location.zone || location.id.split("-")[0]) === zone && (location.rack || location.id.split("-")[1]) === to))
        throw Error("Rack name already exists in this zone");
      matches.forEach((location) => { location.rack = to; });
      reference = `${zone}-${from}`;
      detail = `Renamed rack ${from} to ${to} in zone ${zone}`;
      break;
    }
    case "updateMaster": {
      const entity = required(c, "entity"),
        key = required(c, "id");
      reference = key;
      if (entity === "Product") {
        const row = find(s.products, key);
        const defaults = productDefaultDates(c, row);
        const barcode = required(c, "barcode");
        if (s.products.some((p) => p.id !== key && p.barcode === barcode))
          throw Error("Barcode already assigned");
        Object.assign(row, {
          name: required(c, "name"),
          category: required(c, "category"),
          barcode,
          minimum: number(c, "minimum", true),
          price: money(c),
          promotion: String(c.promotion || ""),
          unit: String(c.unit || row.unit || "unit"),
          brand: String(c.brand || row.brand || ""),
          productType: c.productType ? String(c.productType) as Product["productType"] : row.productType,
          expiryTracking: c.expiryTracking === undefined ? row.expiryTracking : c.expiryTracking === true || c.expiryTracking === "true",
          serialTracking: c.serialTracking === undefined ? row.serialTracking : c.serialTracking === true || c.serialTracking === "true",
          ...defaults,
        });
      } else if (entity === "Supplier")
        find(s.suppliers, key).name = required(c, "name");
      else if (entity === "Warehouse")
        find(s.warehouses, key).name = required(c, "name");
      else if (entity === "Location") {
        const row = find(s.locations, key);
        const position = locationPosition(row);
        const nextZone = c.zone === undefined ? position.zone : required(c, "zone");
        const nextRack = c.rack === undefined ? position.rack : required(c, "rack");
        if ((rackGridFor(s, row.warehouse, position.zone, position.rack) ||
          rackGridFor(s, row.warehouse, nextZone, nextRack) || s.layoutSections?.some((section) => section.warehouse === row.warehouse &&
            ((section.zone === position.zone && section.rack === position.rack) || (section.zone === nextZone && section.rack === nextRack)))) &&
          [c.zone, c.rack, c.row, c.column, c.shelf].some((value) => value !== undefined))
          throw Error("Change storage unit positions through the rack grid");
        const cap = number(c, "capacity");
        if (
          s.lots
            .filter((l) => l.location === key)
            .reduce((n, l) => n + l.qty, 0) > cap
        )
          throw Error("Capacity cannot be below occupied units");
        row.capacity = cap;
        if (c.name !== undefined) row.name = required(c, "name");
        if (c.kind !== undefined) {
          const kind = required(c, "kind");
          if (kind !== "Storage" && kind !== "Pick face") throw Error("Invalid location kind");
          row.kind = kind;
        }
        if (c.shelf !== undefined) row.shelf = number(c, "shelf");
        if (c.blocked !== undefined) row.blocked = c.blocked === "Blocked";
        if (c.assignedProduct !== undefined) {
          const sku = String(c.assignedProduct).trim();
          if (sku) {
            find(s.products, sku);
            if (s.lots.some((lot) => lot.location === key && lot.qty > 0 && lot.product !== sku))
              throw Error("Move other SKUs out before assigning this location");
          }
          row.assignedProduct = sku || undefined;
        }
        if (c.zone !== undefined) row.zone = required(c, "zone");
        if (c.rack !== undefined) row.rack = required(c, "rack");
        if (c.row !== undefined && c.row !== "") row.row = number(c, "row", true);
        if (c.column !== undefined && c.column !== "") row.column = number(c, "column", true);
        if ([c.zone, c.rack, c.row, c.column, c.shelf].some((value) => value !== undefined)) {
          validateMapLocation(s.locations, row);
          if (row.assignedProduct && !followsProductOrder(s, row, row.assignedProduct))
            throw Error("This assignment is outside the alphabetical order of storage");
        }
      } else throw Error("Unknown master type");
      detail = `Updated ${entity}`;
      break;
    }
    case "connector": {
      const connector = s.connectors.find(
        (x) => x.system === required(c, "system"),
      );
      if (!connector) throw Error("Unknown connector");
      connector.enabled = c.enabled === true;
      reference = connector.system;
      detail = `Manual exchange ${connector.enabled ? "enabled" : "disabled"}`;
      break;
    }
    case "import": {
      const system = required(c, "system");
      const key = required(c, "key");
      const connector = s.connectors.find((x) => x.system === system);
      if (!connector?.enabled) throw Error("Enable the manual connector first");
      if (
        s.syncs.some(
          (x) =>
            x.system === system && x.key === key && x.status === "Completed",
        )
      )
        throw Error("This external event has already been processed");
      const payload = c.payload as Record<string, unknown>;
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw Error("Payload must be a JSON object");
      const entity = String(payload.entity);
      const p = {
        ...payload,
        type:
          (entity === "Product" &&
            s.products.some((p) => p.id === payload.id)) ||
            (entity === "Supplier" &&
              s.suppliers.some((p) => p.id === payload.id))
            ? "updateMaster"
            : "master",
      } as Command;
      if (system === "ERP" && (entity === "Product" || entity === "Supplier")) {
        const next = execute(s, p, actor);
        Object.assign(s, next);
      } else if (
        (system === "ERP" && entity === "Sales order") ||
        (system === "POS" && entity === "Sale")
      ) {
        reference = reserve(
          required(p, "customer"),
          required(p, "product"),
          number(p, "qty"),
          "Customer Order",
          required(p, "warehouse"),
        ).id;
      } else if (system === "ERP" && entity === "Purchase order") {
        const poid = required(p, "id");
        if (s.purchaseOrders.some((x) => x.id === poid))
          throw Error("Purchase order already exists");
        find(s.products, required(p, "product"));
        find(s.suppliers, required(p, "supplier"));
        s.purchaseOrders.push({
          id: poid,
          supplier: required(p, "supplier"),
          product: required(p, "product"),
          qty: number(p, "qty"),
          status: "Sent",
          receivedQty: 0,
          createdAt: new Date().toISOString(),
        });
      } else if (system === "POS" && entity === "Store stock") {
        const store = required(p, "store"),
          product = required(p, "product");
        find(s.products, product);
        const qty = number(p, "qty", true);
        s.storeStock = s.storeStock.filter(
          (x) => x.store !== store || x.product !== product,
        );
        s.storeStock.push({ store, product, qty });
      } else if (system === "POS" && entity === "Customer return") {
        const next = execute(s, { ...payload, type: "return" }, actor);
        Object.assign(s, next);
      } else
        throw Error(
          "Unsupported system/entity combination; see integration contracts",
        );
      s.syncs.unshift({
        id: id("SYNC"),
        system,
        key,
        status: "Completed",
        detail: `${entity} imported`,
        at: new Date().toISOString(),
        attempts:
          (s.syncs.find((x) => x.system === system && x.key === key)
            ?.attempts || 0) + 1,
      });
      reference = reference || key;
      detail = `${system}: ${entity} imported (${key})`;
      break;
    }
    default:
      throw Error("Unknown operation");
  }
  audit(c.type, reference, detail);
  const previousOccupancy = occupiedByLocation(original.lots);
  const currentOccupancy = occupiedByLocation(s.lots);
  const previousCapacities = new Map(original.locations.map((location) => [location.id, location.capacity]));
  for (const location of s.locations) {
    const occupied = currentOccupancy.get(location.id) ?? 0;
    if (occupied <= location.capacity) continue;
    const previousCapacity = previousCapacities.get(location.id);
    const previousExcess = previousCapacity === undefined ? 0 : (previousOccupancy.get(location.id) ?? 0) - previousCapacity;
    if (occupied - location.capacity > previousExcess)
      throw Error(`Location ${location.id} capacity exceeded (${occupied} occupied / ${location.capacity} capacity)`);
  }
  for (const l of s.lots) {
    if (
      !Number.isSafeInteger(l.qty) ||
      l.qty < 0 ||
      l.reserved < 0 ||
      l.reserved > l.qty
    )
      throw Error("Stock invariant failed");
    const orderAllocated = s.orders
      .filter((o) => ["Reserved", "Picking", "Picked", "Packing", "Packed", "Short picked"].includes(o.status))
      .flatMap((o) => o.allocations)
      .filter((a) => a.lot === l.id)
      .reduce((n, a) => n + a.qty, 0);
    const transferAllocated = s.transfers
      .filter((transfer) => transfer.sourceType === "Warehouse" && ["Draft", "Approved", "Picked", "Packed"].includes(transfer.status))
      .flatMap((transfer) => transfer.allocations || [])
      .filter((a) => a.lot === l.id)
      .reduce((n, a) => n + a.qty, 0);
    if (l.reserved !== orderAllocated + transferAllocated) throw Error("Reservation ledger mismatch");
  }
  return s;
}
