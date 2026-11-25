"use client";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  Boxes,
  ChevronRight,
  ClipboardList,
  Download,
  LayoutDashboard,
  MapPin,
  Package,
  Search,
  Settings2,
  Truck,
  Users,
  Warehouse,
  X,
  ShieldCheck,
  RefreshCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  available,
  can,
  lotWarehouse,
  recordWarehouse,
  today,
  naturalSort,
  productAvailability,
  warehouseStorageTotals,
  warehouseTotals,
  type State,
  type Role,
  type Command,
  type Order,
} from "@/lib/wms";
import { clearReceivingDraft, commitReceivingDraft, draftStorageKey, pendingBatchDuplicateErrors, playReceivingTone, readReceivingDraft, scannerKey, validateReceivingLine, writeReceivingDraft, type ScannerBuffer } from "@/lib/receiving-scan";
import { DEFAULT_GLOBAL_SHELF_LIFE_DAYS, resolveReceivingDates } from "@/lib/receiving-dates";
import WarehouseSpaceMap from "./warehouse-space-map";
import DashboardWarehouseMap from "./dashboard-warehouse-map";
import ConsolidatedPicking from "./consolidated-picking";

type PublicState = Omit<State, "users"> & {
  users: Omit<State["users"][number], "password">[];
};
type Session = { id: string; name: string; role: Role };
export type Field = {
  key: string;
  label: string;
  options?: { value: string; label: string }[];
  kind?: string;
  value?: string;
  optional?: boolean;
  hint?: string;
};
type OrderLineDraft = { product: string; qty: string };
type ReconciliationLine = { product: string; barcode: string; batch: string; manufacturingDate: string; expiry: string; received: number; damaged: number; accepted: number; warehouse: string; datesDefault?: boolean; editedManufacturingDate?: boolean; editedExpiry?: boolean; batchEdited?: boolean; error?: string; batchNote?: string };
const navigation = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Receiving", icon: Download },
  { label: "Warehouse", icon: Warehouse },
  { label: "Inventory", icon: Boxes },
  { label: "Order", icon: ClipboardList },
  { label: "Picking & Packing", icon: Package },
  { label: "Dispatch", icon: Truck },
  { label: "Return", icon: RefreshCw },
  { label: "Store Transfer", icon: Truck },
  { label: "Team", icon: Users },
  { label: "Integrations", icon: Settings2 },
  { label: "Reports", icon: Activity },
  { label: "Master Data", icon: Settings2 },
];
function Badge({ children }: { children: ReactNode }) {
  return <span className="status healthy">{children}</span>;
}
function dashboardStatusTone(value: string) {
  return /cancel|failed|rejected|critical|expired/i.test(value)
    ? "critical"
    : /reserved|picking|short|pending|hold|low/i.test(value)
      ? "low-stock"
      : "healthy";
}
function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((x, i) => (
              <th key={i}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, i) => (
              <tr key={i}>
                {row.map((x, j) => (
                  <td key={j}>{x}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length} className="empty-state">
                No records yet. Use the actions above to start.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function Panel({
  title,
  description,
  actions,
  className,
  banner,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`panel wms-panel ${className || ""} ${title === "Receiving list" ? "receiving-list-panel" : ""}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <div className="inline-actions">{actions}</div>
      </div>
      {banner}
      {children}
    </section>
  );
}
function download(name: string, rows: unknown) {
  const json = typeof rows === "string" ? rows : JSON.stringify(rows, null, 2);
  const url = URL.createObjectURL(
    new Blob([json], {
      type: name.endsWith(".csv") ? "text/csv" : "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "No records";
  const keys = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    let s = typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
    if (/^[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return [keys, ...rows.map((r) => keys.map((k) => r[k]))]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
export default function WarehouseDashboard() {
  const [active, setActive] = useState("Dashboard"),
    [state, setState] = useState<PublicState | null>(null),
    [user, setUser] = useState<Session | null>(null),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [warehouseScope, setWarehouseScope] = useState("ALL");
  const [modal, setModal] = useState<{
      title: string;
      type: string;
      fields: Field[];
      extra?: Record<string, unknown>;
    } | null>(null),
    [documentOrder, setDocumentOrder] = useState<Order | null>(null),
    [orderLines, setOrderLines] = useState<OrderLineDraft[]>([{ product: "", qty: "1" }]),
    [transferLines, setTransferLines] = useState<OrderLineDraft[]>([{ product: "", qty: "1" }]),
    [transferReceiveLines, setTransferReceiveLines] = useState<OrderLineDraft[]>([{ product: "", qty: "0" }]),
    [orderWarehouse, setOrderWarehouse] = useState(""),
    [reconcileBarcode, setReconcileBarcode] = useState(""),
    [reconcileProductId, setReconcileProductId] = useState(""),
    [reconcileBatch, setReconcileBatch] = useState(""),
    [reconcileReceived, setReconcileReceived] = useState(""),
    [reconcileDamaged, setReconcileDamaged] = useState("0"),
    [reconcileManufacturingDate, setReconcileManufacturingDate] = useState(""),
    [reconcileExpiry, setReconcileExpiry] = useState(""),
    [reconcilePending, setReconcilePending] = useState<ReconciliationLine[]>([]),
    [editingBatchIndex, setEditingBatchIndex] = useState<number | null>(null),
    [reconcileSupplier, setReconcileSupplier] = useState(""),
    [reconcileWarehouse, setReconcileWarehouse] = useState(""),
    [reconcileError, setReconcileError] = useState(""),
    [reconcileDateEdited, setReconcileDateEdited] = useState(false),
    [manualProductId, setManualProductId] = useState(""),
    [manualProductSearch, setManualProductSearch] = useState(""),
    [manualBatch, setManualBatch] = useState(""),
    [manualManufacturingDate, setManualManufacturingDate] = useState(""),
    [manualExpiry, setManualExpiry] = useState(""),
    [manualReceived, setManualReceived] = useState(""),
    [manualDamaged, setManualDamaged] = useState("0"),
    [manualError, setManualError] = useState(""),
    [pendingPlacementLotId, setPendingPlacementLotId] = useState<string | null>(null),
    [showAlerts, setShowAlerts] = useState(false);
  const scannerBuffer = useRef<ScannerBuffer>({ text: "", lastAt: null, fast: true });
  const commitCurrentRef = useRef<() => void>(() => undefined);
  const lookupBarcodeRef = useRef<(barcode: string) => void>(() => undefined);
  const editableScanSnapshot = useRef<string | null>(null);
  const [receivingMode, setReceivingMode] = useState<"scan" | "manual">("scan"),
    [soundMuted, setSoundMuted] = useState(false),
    [draftNotice, setDraftNotice] = useState("");
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/wms");
      if (res.ok) {
        const data = await res.json();
        setState(data.state);
        setUser(data.user);
      } else if (res.status === 401) {
        setState(null);
        setUser(null);
      } else throw Error("Could not load warehouse");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    if (!modal && !documentOrder) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,[tabindex="0"]',
        ) || [],
      );
    focusable()[0]?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModal(null);
        setDocumentOrder(null);
      }
      if (e.key === "Tab") {
        const items = focusable(),
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [modal, documentOrder]);
  useEffect(() => {
    if (active !== "Receiving" || modal) return;
    const handler = (event: KeyboardEvent) => {
      const editable = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || (event.target instanceof HTMLElement && event.target.isContentEditable);
      if (editable && event.target instanceof HTMLInputElement && event.key.length === 1 && editableScanSnapshot.current === null) editableScanSnapshot.current = event.target.value;
      const result = scannerKey(scannerBuffer.current, event.key, performance.now());
      scannerBuffer.current = result.buffer;
      if (!result.handled) return;
      if (result.barcode) {
        event.preventDefault();
        if (editable && editableScanSnapshot.current !== null && event.target instanceof HTMLInputElement) {
          if (event.target.dataset.receivingField === "quantity") setReconcileReceived(editableScanSnapshot.current);
          if (event.target.dataset.receivingField === "batch") setReconcileBatch(editableScanSnapshot.current);
        }
        editableScanSnapshot.current = null;
        commitCurrentRef.current();
        setReceivingMode("scan");
        setReconcileBarcode(result.barcode);
        lookupBarcodeRef.current(result.barcode);
      } else if (!editable) {
        event.preventDefault();
      }
      if (event.key === "Enter" && !result.barcode) editableScanSnapshot.current = null;
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [active, modal]);
  useEffect(() => {
    if (!state || active !== "Receiving") return;
    if (reconcileWarehouse) return;
    let remembered = "";
    try { remembered = window.localStorage.getItem("stockroom.lastReceivingWarehouse") || ""; } catch { /* blocked storage */ }
    const next = state.warehouses.some((w) => w.id === remembered) ? remembered : state.warehouses.length === 1 ? state.warehouses[0].id : "";
    if (next) setReconcileWarehouse(next);
  }, [state, active, reconcileWarehouse]);
  const isValidReceivingLine = (value: unknown): value is ReconciliationLine => {
    if (!value || typeof value !== "object") return false;
    const line = value as Partial<ReconciliationLine>;
    return typeof line.product === "string" && typeof line.barcode === "string" && typeof line.batch === "string" && typeof line.manufacturingDate === "string" && typeof line.expiry === "string" && Number.isSafeInteger(line.received) && Number.isSafeInteger(line.damaged) && Number.isSafeInteger(line.accepted) && typeof line.warehouse === "string";
  };
  useEffect(() => {
    if (!state || active !== "Receiving" || !reconcileWarehouse) return;
    try { window.localStorage.setItem("stockroom.lastReceivingWarehouse", reconcileWarehouse); } catch { /* blocked storage */ }
    const restored = readReceivingDraft<ReconciliationLine>(window.localStorage, reconcileWarehouse, isValidReceivingLine);
    if (reconcilePending.length === 0 && restored.lines.length) {
      setReconcilePending(restored.lines.map((line) => ({ ...line, datesDefault: false, editedManufacturingDate: true, editedExpiry: true })));
      setDraftNotice(restored.dropped ? `Restored draft; dropped ${restored.dropped} invalid line${restored.dropped === 1 ? "" : "s"}.` : "Restore unsaved list?");
    }
  }, [state, active, reconcileWarehouse]);
  useEffect(() => {
    if (active === "Receiving" && reconcileWarehouse && reconcilePending.length) writeReceivingDraft(window.localStorage, reconcileWarehouse, reconcilePending);
  }, [active, reconcileWarehouse, reconcilePending]);
  async function action(c: Command, finish = true, onFailure?: (message: string) => void, onSuccess?: (result: { detail?: string }) => void) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/wms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
      });
      const result = await res.json();
      if (!res.ok) throw Error(result.error);
      if (c.type === "logout") {
        setState(null);
        setUser(null);
      } else {
        setState(result.state);
        setUser(result.user);
      }
      if (finish) setModal(null);
      onSuccess?.(result);
      if (c.type === "receiveReconciliation") playReceivingTone("success", soundMuted);
      if ((c.type === "putaway" || c.type === "putawayRow") &&
        !result.state.lots.some((lot: State["lots"][number]) => lot.id === c.lot && lot.location === "RECEIVING" && lot.qty > 0))
        setPendingPlacementLotId(null);
      setMessage(
        c.type === "logout" ? "Signed out" : "Saved successfully",
      );
      setTimeout(() => setMessage(""), 3500);
      return true;
    } catch (e) {
      if (c.type === "receiveReconciliation") playReceivingTone("error", soundMuted);
      const message = e instanceof Error ? e.message : "Request failed";
      setError(message);
      onFailure?.(message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function open(
    title: string,
    type: string,
    fields: Field[],
    extra?: Record<string, unknown>,
  ) {
    setError("");
    setModal({ title, type, fields, extra });
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal) return;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    let payload: unknown;
    try {
      if (data.payload) payload = JSON.parse(String(data.payload));
    } catch {
      setError("Payload is not valid JSON");
      return;
    }
    if (modal.extra?.multiProduct === "order") {
      if (!orderWarehouse) { setError("Choose a warehouse first"); return; }
      const lines = orderLines.filter((line) => line.product && line.qty);
      if (!lines.length) { setError("Add at least one order product"); return; }
      const availability = productAvailability(s, orderWarehouse);
      if (lines.some((line) => !Number.isSafeInteger(Number(line.qty)) || Number(line.qty) < 1 || !availability.get(line.product) || Number(line.qty) > availability.get(line.product)!.available)) {
        setError("Each order quantity must be a whole number within the selected warehouse availability"); return;
      }
      action({ type: "order", ...data, lines: JSON.stringify(lines.map((line) => ({ product: line.product, qty: Number(line.qty) }))) });
      return;
    }
    if (modal.extra?.multiProduct === "transfer") {
      const lines = transferLines.filter((line) => line.product && line.qty);
      if (!lines.length) { setError("Add at least one transfer product"); return; }
      action({ type: "transfer", ...data, lines: JSON.stringify(lines.map((line) => ({ product: line.product, qty: Number(line.qty) }))) });
      return;
    }
    if (modal.extra?.multiProduct === "transferWarehouse") {
      const lines = transferLines.filter((line) => line.product && line.qty);
      if (!lines.length) { setError("Add at least one transfer product"); return; }
      action({ type: "transfer", ...data, lines: JSON.stringify(lines.map((line) => ({ product: line.product, qty: Number(line.qty) }))) });
      return;
    }
    if (modal.extra?.multiProduct === "transferReceive") {
      const lines = transferReceiveLines.filter((line) => line.product && line.qty !== "");
      action({ type: "transfer", ...data, received: JSON.stringify(lines.map((line) => ({ product: line.product, qty: Number(line.qty) }))) });
      return;
    }
    action({
      type: modal.type,
      ...data,
      ...modal.extra,
      ...(payload ? { payload } : {}),
    });
  }
  if (loading)
    return (
      <div className="login-page">
        <div className="panel login-card">Loading Stockroom…</div>
      </div>
    );
  if (!state || !user)
    return (
      <div className="login-page">
        <div className="panel login-card">
          <h1>Unable to load Stockroom</h1>
          <p className="error" role="alert">{error || "The warehouse data could not be loaded."}</p>
          <button className="primary-button" type="button" onClick={refresh}>Retry</button>
        </div>
      </div>
    );
  const s = state;
  const storageTotals = warehouseStorageTotals(s, warehouseScope);
  const scannedProductionProduct = s.products.find((p) => p.barcode === reconcileBarcode);
  const scannedSampleProduct = s.sampleProducts.find((p) => p.barcode === reconcileBarcode);
  const scannedProduct = scannedProductionProduct || scannedSampleProduct;
  const scannedBatches = scannedProductionProduct
    ? [...s.receipts.filter((r) => r.product === scannedProductionProduct.id && recordWarehouse(s, r) === reconcileWarehouse).map((r) => ({ batch: r.batch, manufacturingDate: r.manufacturingDate || "", expiry: r.expiry, warehouse: recordWarehouse(s, r) })), ...s.lots.filter((l) => l.product === scannedProductionProduct.id && lotWarehouse(s, l) === reconcileWarehouse).map((l) => ({ batch: l.batch, manufacturingDate: "", expiry: l.expiry, warehouse: lotWarehouse(s, l) }))].filter((row, index, rows) => rows.findIndex((other) => other.batch === row.batch && other.expiry === row.expiry) === index)
    : scannedSampleProduct?.batch ? [{ batch: scannedSampleProduct.batch, manufacturingDate: scannedSampleProduct.manufacturingDate || "", expiry: scannedSampleProduct.expiry || "", warehouse: scannedSampleProduct.warehouse || reconcileWarehouse }] : [];
  const selectedBatch = scannedBatches.find((row) => row.batch === reconcileBatch);
  const usableScannedBatches = scannedBatches.filter((row) => row.expiry && row.expiry >= today());
  const globalShelfLifeDays = s.settings?.receivingDefaultShelfLifeDays ?? DEFAULT_GLOBAL_SHELF_LIFE_DAYS;
  const manualProduct = s.products.find((item) => item.id === manualProductId);
  const manualBatches = manualProduct ? [...s.receipts.filter((r) => r.product === manualProduct.id && recordWarehouse(s, r) === reconcileWarehouse).map((r) => ({ batch: r.batch, expiry: r.expiry, manufacturingDate: r.manufacturingDate || "" })), ...s.lots.filter((l) => l.product === manualProduct.id && lotWarehouse(s, l) === reconcileWarehouse).map((l) => ({ batch: l.batch, expiry: l.expiry, manufacturingDate: "" }))].filter((row, index, rows) => rows.findIndex((other) => other.batch === row.batch) === index) : [];
  const usableManualBatches = manualBatches.filter((row) => row.expiry >= today());
  const manualSelectedBatch = manualBatches.find((row) => row.batch === manualBatch);
  const batchStockNote = (product: string, batch: string, warehouse: string, incoming: number) => {
    const stock = s.lots.filter((lot) => lot.product === product && lot.batch === batch && lotWarehouse(s, lot) === warehouse && lot.expiry >= today())
      .reduce((sum, lot) => sum + lot.qty, 0);
    if (!stock) return "";
    const name = s.warehouses.find((item) => item.id === warehouse)?.name || warehouse;
    return `Batch exists in ${name}: ${stock} in stock. This adds ${incoming}.`;
  };
  const defaultDateCount = reconcilePending.filter((line) => line.datesDefault && !line.editedManufacturingDate && !line.editedExpiry).length;
  const lookupBarcode = (barcode: string) => {
    const production = s.products.find((p) => p.barcode === barcode);
    const sample = s.sampleProducts.find((p) => p.barcode === barcode);
    const match = production || sample;
    setReconcileBarcode(barcode);
    setReconcileError("");
    if (!match) { setReconcileProductId(""); setReconcileBatch(""); setReconcileManufacturingDate(""); setReconcileExpiry(""); return; }
    setReconcileProductId(match.id);
    const batches = production ? [...s.receipts.filter((r) => r.product === production.id && recordWarehouse(s, r) === reconcileWarehouse).map((r) => ({ batch: r.batch, manufacturingDate: r.manufacturingDate || "", expiry: r.expiry, warehouse: recordWarehouse(s, r) })), ...s.lots.filter((l) => l.product === production.id && lotWarehouse(s, l) === reconcileWarehouse).map((l) => ({ batch: l.batch, manufacturingDate: "", expiry: l.expiry, warehouse: lotWarehouse(s, l) }))].filter((row, index, rows) => rows.findIndex((other) => other.batch === row.batch && other.expiry === row.expiry) === index) : [];
    const usable = batches.filter((row) => row.expiry && row.expiry >= today());
    const batch = production && usable.length === 1 ? usable[0] : sample?.batch ? { batch: sample.batch, manufacturingDate: sample.manufacturingDate || "", expiry: sample.expiry || "", warehouse: sample.warehouse || reconcileWarehouse } : undefined;
    setReconcileBatch("");
    const resolved = production ? resolveReceivingDates(production, globalShelfLifeDays) : { manufacturingDate: "", expiry: "" };
    setReconcileManufacturingDate(resolved.manufacturingDate);
    setReconcileExpiry(resolved.expiry);
    setReconcileDateEdited(false);
    if (batch?.warehouse) setReconcileWarehouse(batch.warehouse);
  };
  lookupBarcodeRef.current = lookupBarcode;
  const addReconciliationLine = () => {
    setReconcileError("");
    if (!scannedProduct) { setReconcileError("Unknown barcode. Register the product before adding it."); playReceivingTone("error", soundMuted); return; }
    if (!scannedProductionProduct) { setReconcileError("This barcode is from the Sample Dataset. Register it in Product Master before confirming production inventory."); playReceivingTone("error", soundMuted); return; }
    const received = Number(reconcileReceived), damaged = Number(reconcileDamaged || 0);
    if (!Number.isSafeInteger(received) || received < 1) { setReconcileError("Received quantity must be a positive whole number."); playReceivingTone("error", soundMuted); return; }
    if (!Number.isSafeInteger(damaged) || damaged < 0 || damaged > received) { setReconcileError("Damaged quantity must be non-negative and cannot exceed received quantity."); playReceivingTone("error", soundMuted); return; }
    try {
      const receivingWarehouse = reconcileWarehouse || s.warehouses[0]?.id || "";
      const next = commitReceivingDraft(reconcilePending, { product: scannedProductionProduct.id, barcode: scannedProductionProduct.barcode, batch: "", manufacturingDate: reconcileManufacturingDate, expiry: reconcileExpiry, received, damaged, warehouse: receivingWarehouse, datesDefault: Boolean(reconcileManufacturingDate && reconcileExpiry) } as ReconciliationLine);
      setReconcilePending(next as ReconciliationLine[]);
    } catch (e) { setReconcileError(e instanceof Error ? e.message : "Could not add scan"); playReceivingTone("error", soundMuted); return; }
    playReceivingTone("success", soundMuted);
    setReconcileReceived(""); setReconcileDamaged("0");
    setReconcileDateEdited(false);
  };
  commitCurrentRef.current = addReconciliationLine;
  const addManualLine = () => {
    setManualError("");
    const product = s.products.find((item) => item.id === manualProductId);
    const received = Number(manualReceived), damaged = Number(manualDamaged || 0);
    if (!product) { setManualError("Select an existing product."); playReceivingTone("error", soundMuted); return; }
    const finalExpiry = manualExpiry;
    if (!Number.isSafeInteger(received) || received < 1) { setManualError("Received quantity must be a positive whole number."); playReceivingTone("error", soundMuted); return; }
    if (!Number.isSafeInteger(damaged) || damaged < 0 || damaged > received) { setManualError("Damaged quantity must be non-negative and cannot exceed received quantity."); playReceivingTone("error", soundMuted); return; }
    const receivingWarehouse = reconcileWarehouse || s.warehouses[0]?.id || "";
    setReconcilePending([...reconcilePending, { product: product.id, barcode: product.barcode, batch: "", manufacturingDate: manualManufacturingDate, expiry: finalExpiry, received, damaged, accepted: received - damaged, warehouse: receivingWarehouse, datesDefault: Boolean(manualManufacturingDate && finalExpiry) }]);
    playReceivingTone("success", soundMuted);
    setManualProductId(""); setManualProductSearch(""); setManualBatch(""); setManualManufacturingDate(""); setManualExpiry(""); setManualReceived(""); setManualDamaged("0");
  };
  const options = (rows: { id: string; name?: string }[]) =>
    naturalSort(rows, (x) => x.name || x.id).map((x) => ({
      value: x.id,
      label: `${x.id}${x.name ? " · " + x.name : ""}`,
    }));
  const selectManualProduct = (id: string) => {
    const product = s.products.find((item) => item.id === id);
    const rows = product ? [...s.receipts.filter((r) => r.product === product.id && recordWarehouse(s, r) === reconcileWarehouse).map((r) => ({ batch: r.batch, expiry: r.expiry, manufacturingDate: r.manufacturingDate || "" })), ...s.lots.filter((l) => l.product === product.id && lotWarehouse(s, l) === reconcileWarehouse).map((l) => ({ batch: l.batch, expiry: l.expiry, manufacturingDate: "" }))].filter((row, index, all) => all.findIndex((other) => other.batch === row.batch) === index).filter((row) => row.expiry >= today()) : [];
    const only = rows.length === 1 ? rows[0] : undefined;
    setManualProductId(id);
    setManualProductSearch(id);
    setManualBatch("");
    const resolved = product ? resolveReceivingDates(product, globalShelfLifeDays) : { manufacturingDate: "", expiry: "" };
    setManualManufacturingDate(resolved.manufacturingDate);
    setManualExpiry(resolved.expiry);
    setManualError("");
  };
  const productField: Field = {
      key: "product",
      label: "Product",
      options: naturalSort(s.products, (p) => p.name).map((p) => ({ value: p.id, label: `${p.name} · ${p.id}` })),
    },
    qtyField: Field = { key: "qty", label: "Quantity", kind: "number" },
    reasonField: Field = { key: "reason", label: "Reason" },
    orderOptions = (statuses: string[]) =>
      s.orders
        .filter((o) => statuses.includes(o.status))
        .sort((a,b) => a.id.localeCompare(b.id, undefined, {numeric:true}))
        .map((o) => ({
          value: o.id,
          label: `${o.id} · ${o.customer} · ${o.status}`,
        }));
  const lotOptions = s.lots
    .filter((l) => l.qty > 0)
    .map((l) => ({
      value: l.id,
      label: `${l.id} · ${l.product} · ${l.location} · ${l.qty} units`,
    }));
  const destField: Field = {
    key: "destination",
    label: "Destination location / location barcode",
    options: options(s.locations),
  };
  const button = (label: string, type: string, fn: () => void) =>
    can(user.role, type) ? (
      <button className="secondary-button" onClick={fn}>
        {label}
      </button>
    ) : null;
  const editProduct = (p: PublicState["products"][number]) =>
    open(
      "Edit product",
      "updateMaster",
      [
        { key: "name", label: "Product name", value: p.name },
        { key: "category", label: "Category", value: p.category },
        { key: "barcode", label: "Barcode", value: p.barcode },
        {
          key: "minimum",
          label: "Low-stock threshold",
          kind: "number",
          value: String(p.minimum),
        },
        {
          key: "price",
          label: "Price (INR)",
          kind: "decimal",
          value: String(p.price),
        },
        {
          key: "promotion",
          label: "Promotion",
          optional: true,
          value: p.promotion,
        },
        { key: "defaultManufacturingDate", label: "Default production date", kind: "date", optional: true, value: p.defaultManufacturingDate || "" },
        { key: "defaultExpiry", label: "Default expiry", kind: "date", optional: true, value: p.defaultExpiry || "", hint: p.defaultExpiry && p.defaultExpiry < today() ? "This expiry has already passed" : undefined },
        { key: "defaultShelfLifeDays", label: "Default shelf life (days)", kind: "number", optional: true, value: p.defaultShelfLifeDays && p.defaultShelfLifeDays > 0 ? String(p.defaultShelfLifeDays) : "", hint: p.defaultShelfLifeDays === 0 ? "Set a value above 0 to set the expiry when receiving." : "Used to set the expiry when receiving." },
      ],
      { entity: "Product", id: p.id },
    );
  const newProductForm = (initialBarcode = "") => open("Register new product", "master", [
    { key: "entity", label: "Entity", value: "Product" },
    { key: "id", label: "Unique product ID" },
    { key: "name", label: "Product name" },
    { key: "barcode", label: "Barcode", value: initialBarcode },
    { key: "category", label: "Category" },
    { key: "brand", label: "Brand", optional: true },
    { key: "unit", label: "Unit of measurement", value: "unit" },
    { key: "productType", label: "Product type", options: ["Perishable", "Non-perishable", "Serialized"].map((x) => ({ value: x, label: x })) },
    { key: "expiryTracking", label: "Expiry tracking", options: [{ value: "true", label: "Required" }, { value: "false", label: "Not required" }] },
    { key: "serialTracking", label: "Serial tracking", options: [{ value: "true", label: "Required" }, { value: "false", label: "Not required" }] },
    { key: "minimum", label: "Low-stock threshold", kind: "number", value: "0" },
    { key: "price", label: "Price (INR)", kind: "decimal", value: "0" },
    { key: "promotion", label: "Promotion", optional: true },
    { key: "defaultManufacturingDate", label: "Default production date", kind: "date", optional: true },
    { key: "defaultExpiry", label: "Default expiry", kind: "date", optional: true, hint: "This expiry has already passed" },
    { key: "defaultShelfLifeDays", label: "Default shelf life (days)", kind: "number", optional: true, hint: "When set, this takes priority over fixed dates." },
  ]);
  const inventoryForm = (kind: string) =>
    open(
      `${kind} — request approval`,
      "request",
      [
        { key: "lot", label: "Stock lot", options: lotOptions },
        {
          ...qtyField,
          label:
            kind === "Cycle count"
              ? "Counted physical quantity"
              : kind === "Adjustment"
                ? "Quantity to remove"
                : qtyField.label,
        },
        ...(["Transfer", "Replenishment"].includes(kind) ? [destField] : []),
        reasonField,
      ],
      { kind },
    );
  const changeOrderWarehouse = (warehouse: string) => {
    if (orderLines.some((line) => line.product) && warehouse !== orderWarehouse &&
      !window.confirm("Changing warehouse will clear the order lines. Continue?")) return;
    if (warehouse !== orderWarehouse) setOrderLines([{ product: "", qty: "1" }]);
    setOrderWarehouse(warehouse);
  };
  const reserveForm = () =>
    (setOrderLines([{ product: "", qty: "1" }]), setOrderWarehouse(""), open("Create order and reserve stock", "order", [
      { key: "warehouse", label: "Warehouse", options: options(s.warehouses) },
      { key: "orderType", label: "Order type", options: ["Customer Order", "Personal Shop Order"].map((x) => ({ value: x, label: x })) },
      { key: "customer", label: "Customer (Customer Order only)", optional: true },
      { key: "shop", label: "Company shop (Personal Shop Order only)", options: options(s.stores), optional: true },
    ], { multiProduct: "order" }));
  const totals = warehouseTotals(s, warehouseScope),
    total = totals.physical,
    reserved = totals.reserved,
    free = totals.available,
    packed = totals.readyToShip,
    receivedBucket = totals.receiving,
    expiredBucket = totals.expired,
    quarantineBucket = s.returns.filter((r) => r.disposition === "Quarantine").reduce((n, r) => n + r.qty, 0),
    inTransitBucket = s.transfers.filter((t) => ["In Transit", "Dispatched"].includes(t.status)).reduce((n, t) => n + t.lines.reduce((sum, line) => sum + line.qty, 0), 0);
  const inScopeLot = (lot: (typeof s.lots)[number]) => warehouseScope === "ALL" || lotWarehouse(s, lot) === warehouseScope;
  const scopedOrders = s.orders.filter((order) => warehouseScope === "ALL" || order.allocations.some((allocation) => {
    const lot = s.lots.find((item) => item.id === allocation.lot);
    return lot ? inScopeLot(lot) : false;
  }));
  const scopeLabel = warehouseScope === "ALL"
    ? "All warehouses"
    : s.warehouses.find((warehouse) => warehouse.id === warehouseScope)?.name || warehouseScope;
  const alerts = s.products
    .filter(
      (p) =>
        s.lots
          .filter((l) => l.product === p.id && inScopeLot(l))
          .reduce((n, l) => n + available(l), 0) < p.minimum,
    )
    .map((p) => `Low available stock: ${p.name}`)
    .concat(
      s.lots
        .filter(
          (l) =>
            inScopeLot(l) &&
            l.qty > 0 &&
            l.expiry <=
              new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        )
        .map(
          (l) =>
            `${l.expiry < today() ? "Expired" : "Expiring soon"}: ${l.id} (${l.batch})`,
        ),
    )
    .concat(
      s.receipts
        .filter(
          (r) =>
            (warehouseScope === "ALL" || r.warehouse === warehouseScope) &&
            (r.received < r.expected || r.damaged || r.status === "Quality hold"),
        )
        .map((r) => `Receiving exception: ${r.id}`),
    )
    .concat(
      s.orders
        .filter(
          (o) =>
            scopedOrders.includes(o) &&
            ((o.status === "Picked" && o.picked < o.qty) ||
              o.status === "Short picked" || o.delivery === "Delivery exception"),
        )
        .map((o) => `Order exception: ${o.id}`),
    )
    .concat(
      s.syncs
        .filter((x) => x.status === "Failed")
        .map((x) => `Integration failed: ${x.system} / ${x.key}`),
    );
  const filtered = <T,>(rows: T[]) =>
    rows.filter((x) =>
      JSON.stringify(x).toLowerCase().includes(query.toLowerCase()),
    );
  const lotTable = (
    <Table
      headers={[
        "Lot / SKU",
        "Batch / Expiry",
        "Location",
        "Physical",
        "Reserved",
        "Available",
        "Status",
      ]}
      rows={filtered(s.lots.filter((l) => l.qty > 0)).map((l) => [
        <>
          <strong>{l.id}</strong>
          <br />
          {l.product}
        </>,
        <>
          {l.batch}
          <br />
          {l.expiry}
        </>,
        l.location,
        l.qty,
        l.reserved,
        available(l),
        <div className="inline-actions">
          <Badge>
            {l.expiry < today()
              ? "Expired"
              : l.location === "RECEIVING"
                ? "Awaiting put away"
                : "Stored"}
          </Badge>
          {l.expiry < today() && l.qty > 0 && can(user.role, "quarantine") &&
            <button className="row-link" onClick={() => {
              if (window.confirm(`Move lot ${l.id} (${l.qty} units) to quarantine?`))
                void action({ type: "quarantineLot", lot: l.id });
            }}>Move to quarantine</button>}
        </div>,
      ])}
    />
  );
  const orderTable = (statuses?: string[], dashboardStatus = false) => (
    <Table
      headers={[
        "Order / Customer",
        "Warehouse",
        "Product",
        "Ordered / Picked",
        "Status",
        "Picker",
        "Actions",
      ]}
      rows={filtered(
        s.orders.filter((o) => !statuses || statuses.includes(o.status)),
      ).map((o) => [
        <>
          <strong>{o.id}</strong>
          <br />
          {o.customer}
        </>,
        o.warehouse ? s.warehouses.find((warehouse) => warehouse.id === o.warehouse)?.name || o.warehouse : "Legacy",
        o.product,
        `${o.qty} / ${o.picked}`,
        <span className={dashboardStatus ? `status ${dashboardStatusTone(o.status)}` : "status healthy"}>{o.status}</span>,
        o.assignee || "Unassigned",
        <div className="inline-actions">
          <button className="row-link" onClick={() => setDocumentOrder(o)}>
            Documents
          </button>
          {["Reserved", "Picked", "Packed"].includes(o.status) &&
            button("Cancel", "cancel", () =>
              open("Cancel and release reservation", "cancel", [reasonField], {
                order: o.id,
              }),
            )}
        </div>,
      ])}
    />
  );
  const report = () =>
    download(`stockroom-${today()}.json`, {
      generatedAt: new Date().toISOString(),
      summary: {
        physical: total,
        reserved,
        available: free,
        readyToShip: packed,
      },
      inventory: s.lots,
      orders: s.orders,
      receipts: s.receipts,
      returns: s.returns,
      approvals: s.approvals,
      events: s.events,
    });
  let content: ReactNode;
  if (active === "Dashboard")
    content = (
      <>
        <Panel title="Warehouse map" description="Row and column view of locations. Select a cell to inspect stored products.">
          <DashboardWarehouseMap state={s} onOpenWarehouse={(warehouse) => { setWarehouseScope(warehouse); setActive("Warehouse"); }} />
        </Panel>
        <Panel
          title="Warehouse operations"
          description="Every movement updates the inventory ledger"
        >
          <div className="flow-strip">
            {[
              "Receiving",
              "Put Away",
              "Inventory",
              "Picking",
              "Packing",
              "Dispatch",
            ].map((step, i) => (
              <button key={step} onClick={() => setActive(step === "Put Away" ? "Warehouse" : step)}>
                <span>{i + 1}</span>
                {step === "Inventory" ? "Available Stock" : step}
                <strong>
                  {step === "Receiving"
                    ? s.receipts.length
                    : step === "Put Away"
                      ? s.lots.filter(
                          (l) => l.location === "RECEIVING" && l.qty > 0,
                        ).length
                      : step === "Inventory"
                        ? free
                        : s.orders.filter(
                            (o) =>
                              o.status ===
                              (step === "Picking"
                                ? "Reserved"
                                : step === "Packing"
                                  ? "Picked"
                                  : "Packed"),
                          ).length}
                </strong>
              </button>
            ))}
          </div>
        </Panel>
        <div className="main-grid">
          <Panel
            title="Warehouse activity"
            description="Recorded operations by day — current local data"
          >
            <div className="real-chart">
              {Array.from({ length: 14 }, (_, i) => {
                const day = (offset: number) =>
                  new Date(Date.now() - offset * 86400000).toLocaleDateString(
                    "en-CA",
                    { timeZone: "Asia/Kolkata" },
                  );
                const date = day(13 - i);
                const count = s.events.filter(
                  (e) =>
                    new Date(e.at).toLocaleDateString("en-CA", {
                      timeZone: "Asia/Kolkata",
                    }) === date,
                ).length;
                const max = Math.max(
                  1,
                  ...Array.from(
                    { length: 14 },
                    (_, j) =>
                      s.events.filter(
                        (e) =>
                          new Date(e.at).toLocaleDateString("en-CA", {
                            timeZone: "Asia/Kolkata",
                          }) === day(13 - j),
                      ).length,
                  ),
                );
                return (
                  <div key={date} title={`${date}: ${count} operations`}>
                    <strong>{count}</strong>
                    <i
                      style={{
                        height: `${Math.max(2, (count / max) * 125)}px`,
                      }}
                    />
                    <small>{date.slice(5)}</small>
                  </div>
                );
              })}
            </div>
          </Panel>
          <Panel
            title="Recent orders"
            description="Live order fulfillment status"
            actions={
              <button className="row-link" onClick={() => setActive("Order")}>
                View all <ArrowRight size={13} />
              </button>
            }
          >
            {orderTable(undefined, true)}
          </Panel>
          <Panel
            title="Inventory overview"
            description="Available stock excludes reservations and receiving holds"
          >
            <Table
              headers={["Product", "SKU", "Physical", "Available", "Status"]}
              rows={s.products.map((p) => {
                const lots = s.lots.filter((l) => l.product === p.id),
                  qty = lots.reduce((n, l) => n + available(l), 0);
                return [
                  <div className="product-cell">
                    <div className="product-image">
                      <Package size={16} />
                    </div>
                    <strong>{p.name}</strong>
                  </div>,
                  p.id,
                  lots.reduce((n, l) => n + l.qty, 0),
                  qty,
                  <span
                    className={`status ${qty < p.minimum ? "low-stock" : "healthy"}`}
                  >
                    {qty < p.minimum ? "Low stock" : "Healthy"}
                  </span>,
                ];
              })}
            />
          </Panel>
          <Panel
            title="Live activity"
            description="Latest persisted audit events"
          >
            {s.events.slice(0, 5).map((e) => (
              <div className="activity-item" key={e.id}>
                <div className="activity-symbol green">
                  <ShieldCheck size={15} />
                </div>
                <div>
                  <strong>
                    {e.action} · {e.reference}
                  </strong>
                  <p>{e.detail}</p>
                  <span>
                    {e.actor} ·{" "}
                    {new Date(e.at).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}
                  </span>
                </div>
              </div>
            ))}
            {!s.events.length && (
              <p className="empty-state">
                Receive goods or create an order to begin.
              </p>
            )}
          </Panel>
        </div>
      </>
    );
  else if (active === "Receiving")
    content = (
      <>
        <section className="panel wms-panel receiving-setup-card"><div className="receiving-toolbar"><label className="receiving-control"><span>Receiving warehouse</span><select aria-label="Receiving warehouse" value={reconcileWarehouse || (s.warehouses.length === 1 ? s.warehouses[0].id : "")} disabled={Boolean(reconcilePending.length)} onChange={(e) => setReconcileWarehouse(e.target.value)}>{s.warehouses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><div className="receiving-tabs" role="tablist"><button type="button" className={receivingMode === "scan" ? "primary-button" : "secondary-button"} onClick={() => setReceivingMode("scan")} role="tab" aria-selected={receivingMode === "scan"}>Barcode Scan</button><button type="button" className={receivingMode === "manual" ? "primary-button" : "secondary-button"} onClick={() => setReceivingMode("manual")} role="tab" aria-selected={receivingMode === "manual"}>Manual Enter Product</button></div><button type="button" className="receiving-sound-button" aria-label={soundMuted ? "Unmute sound" : "Mute sound"} title={soundMuted ? "Unmute sound" : "Mute sound"} onClick={() => setSoundMuted(!soundMuted)}>{soundMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button></div><p className="receiving-status">{!reconcileWarehouse ? "Select warehouse" : receivingMode === "manual" ? "Select a product" : scannedProduct ? "Enter quantity" : "Scan a barcode"}</p></section>
        {receivingMode === "scan" && <Panel title="Barcode Scan" className="receiving-input-card">
          <label className="receiving-scan-field">Scan input<input aria-label="Scan input" autoFocus readOnly value={reconcileBarcode || "Ready — scan a barcode"} /></label>
          {reconcileBarcode && !scannedProduct && <div className="error" role="alert">Barcode not found <button type="button" className="row-link" onClick={() => newProductForm(reconcileBarcode)}>Register product</button></div>}
          {scannedProduct && <div className="line-editor"><h3>Product Info</h3><p><strong>{scannedProduct.name}</strong> · SKU {scannedProduct.id} · {scannedProduct.category} · Image unavailable</p>{scannedSampleProduct && !scannedProductionProduct ? <p className="sample-product-warning" role="alert">Sample Dataset product. Register it in Product Master before receiving production inventory. {can(user.role, "master") && <button type="button" className="row-link" onClick={() => newProductForm(scannedSampleProduct.barcode)}>Register product</button>}</p> : <><label className="receiving-quantity-field">Quantity<input data-receiving-field="quantity" type="number" min="1" step="1" value={reconcileReceived} onChange={(e) => setReconcileReceived(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addReconciliationLine(); } }} /></label><button type="button" className="secondary-button" onClick={addReconciliationLine}>Add more product</button></>}</div>}
          {reconcileError && <p className="error" role="alert">{reconcileError}</p>}
        </Panel>}
        {receivingMode === "manual" && <Panel title="Manual Enter Product"><label>Product<select autoFocus value={manualProductId} onChange={(e) => selectManualProduct(e.target.value)}><option value="">Select a product</option>{naturalSort(s.products, (p) => p.name).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}</select></label><label>Quantity<input type="number" min="1" step="1" value={manualReceived} onChange={(e) => setManualReceived(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManualLine(); } }} /></label><button type="button" className="secondary-button" onClick={addManualLine}>Add more product</button>{manualError && <p className="error" role="alert">{manualError}</p>}</Panel>}
        {defaultDateCount > 0 && <p className="receiving-default-banner">{defaultDateCount} {defaultDateCount === 1 ? "item uses" : "items use"} default dates. Check them before confirming.</p>}
        <Panel title="Receiving list" description={`${reconcilePending.length} items · ${reconcilePending.reduce((n, line) => n + line.received, 0)} units`} actions={can(user.role, "receiveScan") ? <button className="primary-button" disabled={busy || !reconcilePending.length} onClick={async () => { const invalid = reconcilePending.map((line) => validateReceivingLine(line, today())); const duplicateErrors = pendingBatchDuplicateErrors(reconcilePending); if (invalid.some(Boolean) || duplicateErrors.some(Boolean)) { setReconcilePending(reconcilePending.map((line, index) => ({ ...line, error: invalid[index] || duplicateErrors[index] || "" }))); playReceivingTone("error", soundMuted); return; } if (!reconcilePending.length) return; const count = reconcilePending.length, units = reconcilePending.reduce((n, line) => n + line.received, 0); let assignedDetail = ""; const ok = await action({ type: "receiveReconciliation", ...(reconcileSupplier ? { supplier: reconcileSupplier } : {}), warehouse: reconcileWarehouse || s.warehouses[0]?.id || "", lines: JSON.stringify(reconcilePending) }, false, (message) => { const match = message.match(/Receiving line (\d+)/); if (match) { const index = Number(match[1]) - 1; setReconcilePending(reconcilePending.map((line, rowIndex) => ({ ...line, error: rowIndex === index ? message : line.error || "" }))); } }, (result) => { assignedDetail = result.detail || ""; }); if (ok) { clearReceivingDraft(window.localStorage, reconcileWarehouse); setReconcilePending([]); setMessage(assignedDetail || `Received ${count} items, ${units} units`); } }}>Confirm receiving</button> : null}>
          <div className="receiving-list-scroll"><Table headers={["Product", "Barcode", "Batch", "Production date", "Expiry date", "Received", "Damaged", "Accepted", "Actions"]} rows={reconcilePending.map((line, index) => { const update = (changes: Partial<ReconciliationLine>) => { const next = reconcilePending.map((item, i) => i === index ? { ...item, ...changes, accepted: Math.max(0, (changes.received ?? item.received) - (changes.damaged ?? item.damaged)), error: validateReceivingLine({ ...item, ...changes }, today(), s.products.find((p) => p.id === item.product)?.name || item.product) } : item); setReconcilePending(next); }; const updateBatch = (value: string) => { const batch = value.trim(); const existing = batch && s.receipts.find((receipt) => receipt.product === line.product && receipt.batch === batch && receipt.warehouse === line.warehouse && receipt.expiry !== line.expiry); const error = !batch ? "Batch cannot be empty." : batch.length > 100 ? "Batch must be 100 characters or fewer." : existing ? `${s.products.find((p) => p.id === line.product)?.name || line.product}, batch ${batch} already exists in ${s.warehouses.find((w) => w.id === line.warehouse)?.name || line.warehouse} with expiry ${existing.expiry}. You entered ${line.expiry}.` : validateReceivingLine({ ...line, batch }, today(), s.products.find((p) => p.id === line.product)?.name || line.product); setReconcilePending(reconcilePending.map((item, i) => i === index ? { ...item, batch: value, batchEdited: true, batchNote: batch ? batchStockNote(line.product, batch, line.warehouse, line.received) : "", error } : item)); }; return [s.products.find((p) => p.id === line.product)?.name || line.product, line.barcode, <div>{editingBatchIndex === index ? <input aria-label={`Pending batch ${index + 1}`} maxLength={100} value={line.batch} onChange={(e) => updateBatch(e.target.value)} onBlur={() => setEditingBatchIndex(null)} autoFocus /> : <>{line.batch || "Auto"} {!line.batch && <small>Assigned on confirm</small>}<button type="button" className="row-link" onClick={() => setEditingBatchIndex(index)}>Edit</button></>}{line.batchNote && <small>{line.batchNote}</small>}</div>, <label><input aria-label={`Pending production date ${index + 1}`} type="date" value={line.manufacturingDate} onChange={(e) => update({ manufacturingDate: e.target.value, editedManufacturingDate: true, datesDefault: false })} />{line.datesDefault && !line.editedManufacturingDate && <small>Default</small>}{line.editedManufacturingDate && <small>Edited</small>}</label>, <label><input aria-label={`Pending expiry ${index + 1}`} type="date" min={today()} value={line.expiry} onChange={(e) => update({ expiry: e.target.value, editedExpiry: true, datesDefault: false })} />{line.datesDefault && !line.editedExpiry && <small>Default</small>}{line.editedExpiry && <small>Edited</small>}</label>, <input aria-label={`Pending received ${index + 1}`} type="number" min="1" step="1" value={line.received} onChange={(e) => update({ received: Number(e.target.value) })} />, <input aria-label={`Pending damaged ${index + 1}`} type="number" min="0" step="1" value={line.damaged} onChange={(e) => update({ damaged: Number(e.target.value) })} />, line.accepted, <div><button type="button" className="row-link" onClick={() => setReconcilePending(reconcilePending.filter((_, i) => i !== index))}>Remove</button>{line.error && <small className="error" role="alert">{line.error}</small>}</div>]; })} /></div>
        </Panel>
      </>
    );
  else if (active === "Warehouse")
    content = <WarehouseSpaceMap state={s} role={user.role} pendingId={pendingPlacementLotId}
      setPendingId={setPendingPlacementLotId} open={open} action={action}
      warehouseScope={warehouseScope} onWarehouseScopeChange={setWarehouseScope} />;
  else if (active === "Inventory")
    content = (
      <>
        <Panel title="Inventory buckets" description="Physical stock is separated into receiving, available, reserved, in-transit, and quarantine balances.">
          <div className="bucket-grid">
            {[["Receiving", receivedBucket], ["Available", free], ["Reserved", reserved], ["Expired", expiredBucket], ["In transit", inTransitBucket], ["Quarantine", quarantineBucket]].map(([label, value]) => <div className="bucket-card" key={String(label)}><span>{label}</span><strong>{value}</strong><small>units</small></div>)}
          </div>
        </Panel>
        <Panel
          title="Stock ledger"
          description="FEFO allocation · physical stock is deducted at dispatch only"
          actions={
            <>
              {["Adjustment", "Cycle count", "Transfer", "Replenishment"].map(
                (k) => (
                  <span key={k}>
                    {button(k, "request", () => inventoryForm(k))}
                  </span>
                ),
              )}
            </>
          }
        >
          {lotTable}
        </Panel>
        <Panel
          title="Approval queue"
          description="Requests require a different supervisor or admin. Capacity and reservations are rechecked at approval."
        >
          <Table
            headers={[
              "Request",
              "Operation",
              "Lot",
              "Quantity",
              "Destination",
              "Requested by",
              "Status",
              "Review",
            ]}
            rows={s.approvals.map((a) => [
              a.id,
              a.kind,
              a.lot,
              a.qty,
              a.destination || "—",
              a.requestedBy,
              <Badge>{a.status}</Badge>,
              a.status === "Pending"
                ? button("Review", "approve", () =>
                    open(
                      "Review inventory request",
                      "approve",
                      [
                        {
                          key: "decision",
                          label: "Decision",
                          options: [
                            { value: "Approve", label: "Approve" },
                            { value: "Reject", label: "Reject" },
                          ],
                        },
                        reasonField,
                      ],
                      { request: a.id },
                    ),
                  )
                : null,
            ])}
          />
        </Panel>
      </>
    );
  else if (active === "Order")
    content = (
      <><Panel
        title="Order management"
        description="Creating an order reserves eligible stock immediately. Cancellation releases it."
        actions={button("Create order", "order", reserveForm)}
      >{orderTable()}</Panel></>
    );
  else if (active === "Picking & Packing")
    content = (
      <>
        <ConsolidatedPicking
          state={s}
          user={user}
          action={action}
          refresh={refresh}
        />
        <Panel
          title="Packing station"
          description="Verify products and quantities before generating package labels."
          actions={button("Pack order", "pack", () =>
            open("Verify and pack", "pack", [
              {
                key: "order",
                label: "Picked order",
                options: orderOptions(["Picking", "Picked"]),
              },
              { key: "productBarcode", label: "Product barcode" },
              { ...qtyField, label: "Verified packed quantity" },
              { key: "material", label: "Packaging material" },
              { key: "dimensions", label: "Dimensions (L × W × H in cm)" },
              { key: "weight", label: "Weight in kg", kind: "decimal" },
            ]),
          )}
        >
          {orderTable(["Picked", "Packed"])}
        </Panel>
      </>
    );
  else if (active === "Dispatch")
    content = (
      <>
        <Panel
          title="Dispatch and shipping"
          description="Verify packed quantities, record carrier details and track delivery exceptions."
          actions={
            <>
              {button("Dispatch order", "dispatch", () =>
                open("Dispatch packed order", "dispatch", [
                  {
                    key: "order",
                    label: "Packed order",
                    options: orderOptions(["Packed"]),
                  },
                  { ...qtyField, label: "Verified packed quantity" },
                  { key: "courier", label: "Courier / transport" },
                  { key: "tracking", label: "Tracking / shipment reference" },
                  { key: "vehicleNumber", label: "Vehicle number", optional: true },
                  { key: "receiverStore", label: "Receiver store / destination", optional: true },
                  { key: "dispatchNote", label: "Dispatch note", optional: true },
                ]),
              )}
              {button("Update delivery", "delivery", () =>
                open("Update shipping status", "delivery", [
                  {
                    key: "order",
                    label: "Dispatched order",
                    options: orderOptions(["Dispatched"]),
                  },
                  {
                    key: "delivery",
                    label: "Delivery status",
                    options: [
                      "In transit",
                      "Delivered",
                      "Delivery exception",
                    ].map((x) => ({ value: x, label: x })),
                  },
                ]),
              )}
            </>
          }
        >
          {orderTable(["Packed", "Dispatched"])}
        </Panel>
        <Panel title="Shipment tracking">
          <Table
            headers={["Order", "Carrier", "Tracking", "Delivery"]}
            rows={s.orders
              .filter((o) => o.status === "Dispatched")
              .map((o) => [
                o.id,
                o.courier,
                o.tracking,
                <Badge>{o.delivery}</Badge>,
              ])}
          />
        </Panel>
      </>
    );
  else if (active === "Return")
    content = (
      <Panel
        title="Returns management"
        description="Restocked returns re-enter Receiving and require put away. Quarantined returns are excluded from usable stock."
        actions={button("Register return", "return", () =>
          open("Inspect customer return", "return", [
            {
              key: "order",
              label: "Dispatched order",
              options: orderOptions(["Dispatched"]),
            },
            productField,
            qtyField,
            {
              key: "disposition",
              label: "Inspection decision",
              options: [
                {
                  value: "Restock",
                  label: "Passed — restock through receiving",
                },
                { value: "Quarantine", label: "Failed — quarantine" },
              ],
            },
            {
              key: "batch",
              label: "Returned batch (restock only)",
              optional: true,
            },
            {
              key: "expiry",
              label: "Expiry (restock only)",
              kind: "date",
              optional: true,
            },
            reasonField,
          ]),
        )}
      >
        <Table
          headers={["Return", "Order", "Quantity", "Disposition", "Reason"]}
          rows={filtered(s.returns).map((r) => [
            r.id,
            r.order,
            r.qty,
            <Badge>{r.disposition}</Badge>,
            r.reason,
          ])}
        />
      </Panel>
    );
  else if (active === "Master Data")
    content = (
      <>
        <Panel
          title="Warehouse and location masters"
          description="Location IDs also act as scanner barcodes; capacity is measured in units."
          actions={
            <>
              {button("Add warehouse", "master", () =>
                open(
                  "New warehouse",
                  "master",
                  [
                    { key: "id", label: "Warehouse ID" },
                    { key: "name", label: "Warehouse name" },
                  ],
                  { entity: "Warehouse" },
                ),
              )}
              {button("Add location", "master", () =>
                open(
                  "New storage location",
                  "master",
                  [
                    { key: "id", label: "Location ID / barcode" },
                    { key: "name", label: "Location name" },
                    {
                      key: "warehouse",
                      label: "Warehouse",
                      options: options(s.warehouses),
                    },
                    { key: "zone", label: "Zone (alphabetic)", optional: true },
                    { key: "rack", label: "Rack", optional: true },
                    { key: "row", label: "Row", kind: "number", optional: true },
                    { key: "column", label: "Column", kind: "number", optional: true },
                    {
                      key: "capacity",
                      label: "Capacity in units",
                      kind: "number",
                    },
                    {
                      key: "kind",
                      label: "Location type",
                      options: ["Storage", "Pick face"].map((x) => ({
                        value: x,
                        label: x,
                      })),
                    },
                  ],
                  { entity: "Location" },
                ),
              )}
            </>
          }
        >
          <Table
            headers={[
              "Location / Barcode",
              "Warehouse",
              "Type",
              "Used / Capacity",
              "Utilization",
              "Actions",
            ]}
            rows={s.locations.map((l) => {
              const used = s.lots
                .filter((x) => x.location === l.id)
                .reduce((n, x) => n + x.qty, 0);
              return [
                l.id,
                s.warehouses.find((w) => w.id === l.warehouse)?.name ||
                  l.warehouse,
                l.kind,
                `${used} / ${l.capacity}`,
                `${Math.round((used / l.capacity) * 100)}%`,
                <div className="inline-actions"><button className="secondary-button" onClick={() => open(
                    "Edit location capacity",
                    "updateMaster",
                    [
                      {
                        key: "capacity",
                        label: "Capacity in units",
                        kind: "number",
                        value: String(l.capacity),
                      },
                    ],
                    { entity: "Location", id: l.id },
                  )}>Capacity</button><button className="secondary-button danger-button" disabled={used > 0} title={used > 0 ? "Move stock before deleting" : "Delete empty location"} onClick={() => { if (window.confirm(`Delete location ${l.id}?`)) action({ type: "deleteMaster", entity: "Location", id: l.id }); }}>Delete</button></div>,
              ];
            })}
          />
        </Panel>
        <Panel title="Receiving settings" description="Used to set the expiry when a product has no shelf life of its own" actions={can(user.role, "master") ? <button className="secondary-button" onClick={() => open("Global receiving settings", "receivingSettings", [{ key: "days", label: "Global receiving shelf life (days)", kind: "number", value: String(s.settings?.receivingDefaultShelfLifeDays ?? DEFAULT_GLOBAL_SHELF_LIFE_DAYS), hint: "Whole number above 0; maximum 3650 days." }])}>Edit setting</button> : null}>
          <p className="panel-note">Current value: {s.settings?.receivingDefaultShelfLifeDays ?? DEFAULT_GLOBAL_SHELF_LIFE_DAYS} days</p>
        </Panel>
        <Panel
          title="Product master"
          actions={<div className="inline-actions">{s.sampleProducts.length > 0 && <button className="secondary-button" onClick={() => { if (window.confirm(`Register all ${s.sampleProducts.length} Sample Dataset products in Product Master?`)) action({ type: "registerSampleProducts" }); }}>Register all sample products</button>}{button("Add product", "master", () =>
            open(
              "New product",
              "master",
              [
                { key: "id", label: "SKU" },
                { key: "name", label: "Product name" },
                { key: "category", label: "Category" },
                { key: "barcode", label: "Product barcode" },
                {
                  key: "minimum",
                  label: "Low-stock threshold",
                  kind: "number",
                },
                { key: "price", label: "Price (INR)", kind: "number" },
                { key: "promotion", label: "Promotion", optional: true },
                { key: "defaultManufacturingDate", label: "Default production date", kind: "date", optional: true },
                { key: "defaultExpiry", label: "Default expiry", kind: "date", optional: true },
                { key: "defaultShelfLifeDays", label: "Default shelf life (days)", kind: "number", optional: true, hint: "Takes priority over fixed production and expiry dates." },
              ],
              { entity: "Product" },
            ),
          )}</div>}
        >
          {s.sampleProducts.length > 0 && <p className="sample-product-warning">{s.sampleProducts.length} Sample Dataset product{s.sampleProducts.length === 1 ? "" : "s"} are not registered for production receiving.</p>}
          <Table
            headers={[
              "SKU",
              "Product",
              "Barcode",
              "Category",
              "Minimum",
              "Price / Promotion",
              "Edit",
            ]}
            rows={filtered(s.products).map((p) => [
              p.id,
              <span>{p.name} {p.defaultExpiry && p.defaultExpiry < today() && <Badge>Default expiry passed</Badge>}</span>,
              p.barcode,
              p.category,
              p.minimum,
              `₹${p.price} ${p.promotion}`,
              button("Edit", "updateMaster", () => editProduct(p)),
            ])}
          />
        </Panel>
        <Panel title="Warehouses">
          <Table
            headers={["ID", "Name", "Edit"]}
            rows={s.warehouses.map((w) => [
              w.id,
              w.name,
              button("Edit", "updateMaster", () =>
                open(
                  "Edit warehouse",
                  "updateMaster",
                  [{ key: "name", label: "Warehouse name", value: w.name }],
                  { entity: "Warehouse", id: w.id },
                ),
              ),
            ])}
          />
        </Panel>
        <Panel
          title="Supplier master"
          actions={button("Add supplier", "master", () =>
            open(
              "New supplier",
              "master",
              [
                { key: "id", label: "Supplier ID" },
                { key: "name", label: "Supplier name" },
              ],
              { entity: "Supplier" },
            ),
          )}
        >
          <Table
            headers={["ID", "Supplier", "Edit"]}
            rows={s.suppliers.map((x) => [
              x.id,
              x.name,
              button("Edit", "updateMaster", () =>
                open(
                  "Edit supplier",
                  "updateMaster",
                  [{ key: "name", label: "Supplier name", value: x.name }],
                  { entity: "Supplier", id: x.id },
                ),
              ),
            ])}
          />
        </Panel>
      </>
    );
  else if (active === "Team")
    content = (
      <Panel
        title="Users and access roles"
        description="Admin: configuration; Supervisor: fulfillment and approvals; Operator: receiving, put away, assigned picking, packing and requests; Viewer: read only."
        actions={button("Add user", "user", () =>
          open("Create warehouse user", "user", [
            { key: "id", label: "User ID" },
            { key: "name", label: "Full name" },
            {
              key: "role",
              label: "Role",
              options: ["Admin", "Supervisor", "Operator", "Viewer"].map(
                (x) => ({ value: x, label: x }),
              ),
            },
          ]),
        )}
      >
        <Table
          headers={["User ID", "Name", "Role", "Status", "Manage"]}
          rows={s.users.map((u) => [
            u.id,
            u.name,
            <Badge>{u.role}</Badge>,
            u.active ? "Active" : "Disabled",
            button("Edit", "userUpdate", () =>
              open(
                "Manage user",
                "userUpdate",
                [
                  { key: "name", label: "Full name", value: u.name },
                  {
                    key: "role",
                    label: "Role",
                    value: u.role,
                    options: ["Admin", "Supervisor", "Operator", "Viewer"].map(
                      (x) => ({ value: x, label: x }),
                    ),
                  },
                  {
                    key: "active",
                    label: "Account status",
                    value: u.active ? "Active" : "Disabled",
                    options: ["Active", "Disabled"].map((x) => ({
                      value: x,
                      label: x,
                    })),
                  },
                ],
                { id: u.id },
              ),
            ),
          ])}
        />
      </Panel>
    );
  else if (active === "Integrations")
    content = (
      <>
        <Panel
          title="Integration contracts"
          description="Manual file adapters. No live ERP, POS or ESL endpoint is connected."
        >
          <Table
            headers={[
              "System",
              "Ownership",
              "Direction / Schedule",
              "Status",
              "Actions",
            ]}
            rows={s.connectors.map((x) => [
              <strong>{x.system}</strong>,
              <span className="wrap-cell">{x.owner}</span>,
              <span className="wrap-cell">
                {x.direction}
                <br />
                {x.frequency}
              </span>,
              <Badge>
                {x.enabled ? "Manual exchange enabled" : "Disabled"}
              </Badge>,
              <div className="inline-actions">
                {button(x.enabled ? "Disable" : "Enable", "connector", () =>
                  action({
                    type: "connector",
                    system: x.system,
                    enabled: !x.enabled,
                  }),
                )}
                {x.system !== "ESL" &&
                  button("Import / retry", "import", () =>
                    open(
                      `Import ${x.system} event`,
                      "import",
                      [
                        {
                          key: "key",
                          label: "External event ID (same ID for retries)",
                        },
                        {
                          key: "payload",
                          label: "JSON payload",
                          kind: "textarea",
                          value:
                            x.system === "ERP"
                              ? JSON.stringify(
                                  {
                                    entity: "Purchase order",
                                    id: "PO-100",
                                    supplier: "SUP-01",
                                    product: "WH-2401-BLK",
                                    qty: 10,
                                  },
                                  null,
                                  2,
                                )
                              : JSON.stringify(
                                  {
                                    entity: "Store stock",
                                    store: "STORE-01",
                                    product: "WH-2401-BLK",
                                    qty: 20,
                                  },
                                  null,
                                  2,
                                ),
                        },
                      ],
                      { system: x.system },
                    ),
                  )}
                <button
                  disabled={!x.enabled}
                  className="secondary-button"
                  onClick={() =>
                    download(
                      `${x.system.toLowerCase()}-feed.json`,
                      x.system === "ESL"
                        ? s.products.map((p) => ({
                            sku: p.id,
                            price: p.price,
                            promotion: p.promotion,
                            shelfStock: s.lots
                              .filter(
                                (l) =>
                                  l.product === p.id &&
                                  s.locations.find((x) => x.id === l.location)
                                    ?.kind === "Pick face",
                              )
                              .reduce((n, l) => n + available(l), 0),
                          }))
                        : {
                            stock: s.lots,
                            movements: s.events,
                            storeStock: s.storeStock,
                          },
                    )
                  }
                >
                  Export feed
                </button>
              </div>,
            ])}
          />
          <p className="panel-note">
            ERP accepts Product, Supplier, Purchase order and Sales order
            events. POS accepts Sale, Customer return and Store stock. External
            event IDs prevent duplicate processing. Failed imports are logged
            and can be retried with the same ID after correction.
          </p>
        </Panel>
        <Panel
          title="Sync history"
          description="Failed imports leave inventory unchanged; successful events are idempotent."
        >
          <Table
            headers={[
              "System",
              "Event ID",
              "Result",
              "Attempts",
              "Details",
              "Time",
            ]}
            rows={s.syncs.map((x) => [
              x.system,
              x.key,
              <Badge>{x.status}</Badge>,
              x.attempts,
              <span className="wrap-cell">{x.detail}</span>,
              new Date(x.at).toLocaleString("en-IN"),
            ])}
          />
        </Panel>
        <Panel title="Store stock">
          <Table
            headers={["Store", "SKU", "Quantity"]}
            rows={s.storeStock.map((x) => [x.store, x.product, x.qty])}
          />
        </Panel>
      </>
    );
  else if (active === "Store Transfer")
    content = (
      <>
        <Panel title="Warehouse and store transfers" description="Transfers require approval, warehouse picks and packs, dispatch into transit, and destination discrepancy confirmation." actions={<div className="inline-actions">{button("Create shop transfer", "transfer", () => { setTransferLines([{ product: "", qty: "1" }]); open("Create shop transfer", "transfer", [
          { key: "action", label: "Action", value: "create" },
          { key: "source", label: "Source shop", options: options(s.stores) },
          { key: "destination", label: "Destination shop", options: options(s.stores) },
        ], { multiProduct: "transfer" }); })}{button("Create warehouse → store", "transfer", () => { setTransferLines([{ product: "", qty: "1" }]); open("Create warehouse to store transfer", "transfer", [
          { key: "action", label: "Action", value: "createWarehouse" }, { key: "sourceWarehouse", label: "Source warehouse", options: options(s.warehouses) }, { key: "destination", label: "Destination store", options: options(s.stores) },
        ], { multiProduct: "transferWarehouse" }); })}</div>}>
          <Table headers={["Reference", "Source", "Destination", "Lines", "Status", "Actions"]} rows={s.transfers.map((transfer) => [transfer.id, transfer.sourceType === "Warehouse" ? `${transfer.source} (warehouse)` : transfer.source, transfer.destination, transfer.lines.map((line) => `${line.product} × ${line.qty}`).join(" · "), <Badge>{transfer.status}</Badge>, <div className="inline-actions">{transfer.status === "Draft" && button("Approve", "transfer", () => action({ type: "transfer", action: "approve", transfer: transfer.id }))}{transfer.sourceType === "Warehouse" && transfer.status === "Approved" && button("Pick", "transfer", () => action({ type: "transfer", action: "pick", transfer: transfer.id }))}{transfer.sourceType === "Warehouse" && transfer.status === "Picked" && button("Pack", "transfer", () => action({ type: "transfer", action: "pack", transfer: transfer.id }))}{((transfer.sourceType === "Warehouse" && transfer.status === "Packed") || (transfer.sourceType !== "Warehouse" && transfer.status === "Approved")) && button("Dispatch", "transfer", () => action({ type: "transfer", action: "dispatch", transfer: transfer.id }))}{["In Transit", "Dispatched"].includes(transfer.status) && button("Confirm receipt", "transfer", () => { setTransferReceiveLines(transfer.lines.map((line) => ({ product: line.product, qty: String(line.qty) }))); open("Confirm transfer receipt", "transfer", [{ key: "action", label: "Action", value: "receive" }, { key: "transfer", label: "Transfer", value: transfer.id }, { key: "reason", label: "Discrepancy reason", optional: true }], { multiProduct: "transferReceive" }); })}</div>])}/>
        </Panel>
        <Panel title="Shop stock" description="In-transit stock is excluded until the destination confirms receipt."><Table headers={["Shop", "SKU", "Quantity"]} rows={s.storeStock.map((x) => [x.store, x.product, x.qty])}/></Panel>
      </>
    );
  else
    content = (
      <>
        <Panel
          title="Operational reports"
          description="Reports reflect current persisted records. Export for reconciliation."
          actions={
            <>
              <button className="secondary-button" onClick={report}>
                Export full report
              </button>
              <button
                className="secondary-button"
                onClick={() => download("inventory.csv", csv(s.lots))}
              >
                Inventory CSV
              </button>
              <button
                className="secondary-button"
                onClick={() => download("movements.csv", csv(s.events))}
              >
                Movements CSV
              </button>
            </>
          }
        >
          <Table
            headers={["Metric", "Value"]}
            rows={[
              ["Physical stock", total],
              ["Reserved stock", reserved],
              ["Available stock", free],
              [
                "Shipped units",
                s.orders
                  .filter((o) => o.status === "Dispatched")
                  .reduce((n, o) => n + o.picked, 0),
              ],
              [
                "Completed dispatch rate",
                `${s.orders.length ? Math.round((s.orders.filter((o) => o.status === "Dispatched").length / s.orders.length) * 100) : 0}%`,
              ],
              [
                "Pending approvals",
                s.approvals.filter((a) => a.status === "Pending").length,
              ],
              ["Exceptions / alerts", alerts.length],
            ]}
          />
        </Panel>
        <Panel title="Exception alerts">
          {alerts.length ? (
            alerts.map((a, i) => (
              <p className="alert-row" key={i}>
                {a}
              </p>
            ))
          ) : (
            <p className="empty-state">No active exceptions.</p>
          )}
        </Panel>
        <Panel title="Audit and stock movement history">
          <Table
            headers={[
              "Time (IST)",
              "Actor",
              "Action",
              "Reference",
              "Movement / Detail",
            ]}
            rows={filtered(s.events).map((e) => [
              new Date(e.at).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
              }),
              e.actor,
              e.action,
              e.reference,
              <span className="wrap-cell">{e.detail}</span>,
            ])}
          />
        </Panel>
      </>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setActive("Dashboard");
          }}
          className="brand"
          aria-label="Stockroom home"
        >
          <div className="brand-mark">
            <Boxes size={21} />
          </div>
          <span>
            stockroom<span className="brand-period">.</span>
          </span>
        </a>
        <div className="workspace-switch">
          <div className="warehouse-thumb">
            <Warehouse size={17} />
          </div>
          <div className="workspace-copy">
            <span>Workspace</span>
            <strong>Northstar Supply</strong>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              title={item.label}
              key={item.label}
              onClick={() => {
                setActive(item.label);
                setQuery("");
                setError("");
              }}
              className={`nav-item ${active === item.label ? "active" : ""}`}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
              {item.label === "Order" && (
                <small>
                  {
                    s.orders.filter(
                      (o) => !["Dispatched", "Cancelled"].includes(o.status),
                    ).length
                  }
                </small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="storage-card">
            <div className="storage-head">
              <span>Storage capacity</span>
              <span>
                {Math.round((storageTotals.occupied / Math.max(1, storageTotals.capacity)) * 100)}
                %
              </span>
            </div>
            <div className="storage-track">
              <i
                style={{
                  width: `${Math.min(
                    100,
                    (storageTotals.occupied / Math.max(1, storageTotals.capacity)) * 100,
                  )}%`,
                }}
              />
            </div>
            <p>
              {s.locations.length} locations · {s.warehouses.length} warehouses · {storageTotals.quarantine} quarantine units
            </p>
            <button onClick={() => setActive("Warehouse")}>
              Manage warehouse <ArrowRight size={13} />
            </button>
          </div>
          <div className="profile">
            <div className="profile-avatar">
              {user.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </div>
            <div className="profile-copy">
              <strong>{user.name}</strong>
              <span>{user.role}</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="crumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{active}</strong>
          </div>
          <div className="staff-selector-badge" style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "#f8fafc", padding: "4px 10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}>
            <Users size={16} style={{ color: "#475569" }} />
            <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>Staff:</span>
            <select
              aria-label="Active staff selector"
              value={user.id}
              onChange={async (e) => {
                const selectedId = e.target.value;
                try {
                  const res = await fetch("/api/wms", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type: "selectUser", id: selectedId }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setState(data.state);
                    setUser(data.user);
                  }
                } catch (err) {
                  setError(String(err));
                }
              }}
              style={{
                background: "#ffffff",
                border: "1px solid #94a3b8",
                borderRadius: "6px",
                padding: "4px 8px",
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "#0f172a",
                cursor: "pointer",
              }}
            >
              {s.users.filter((u) => u.active).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
          </div>
          <div className="top-actions">
            <label className="search-box">
              <Search size={16} />
              <input
                aria-label="Search current module"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search current module…"
              />
            </label>
            <button
              className="icon-button"
              aria-label="View exception alerts"
              onClick={() => setShowAlerts(!showAlerts)}
            >
              <Bell size={17} />
              {alerts.length > 0 && <i />}
            </button>
            <button
              className="icon-button"
              aria-label="Refresh warehouse data"
              onClick={refresh}
            >
              <RefreshCw size={16} />
            </button>
            <div className="date-picker">
              <span className="live-dot" />
              {new Date().toLocaleDateString("en-IN", {
                timeZone: "Asia/Kolkata",
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </div>
          </div>
        </header>
        <main className="dashboard">
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="live-dot" /> WAREHOUSE OPERATIONS
              </div>
              <h1>
                {active === "Dashboard"
                  ? `Welcome back, ${user.name.split(" ")[0]}`
                  : active}
                <span> ✳</span>
              </h1>
              <p>
                {active === "Dashboard"
                  ? "Here's what's happening across your warehouse today."
                  : "Connected operations. Accurate inventory. Every movement recorded."}
              </p>
            </div>
            <div className="heading-actions">
              {active !== "Receiving" && <label>Warehouse scope
                <select aria-label="Warehouse scope" value={warehouseScope} onChange={(event) => setWarehouseScope(event.target.value)}>
                  <option value="ALL">All warehouses</option>
                  {s.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                </select>
              </label>}
              {active !== "Receiving" && <span className="panel-note">Active: {scopeLabel}</span>}
              <button className="secondary-button" onClick={report}>
                <Download size={15} />
                Export report
              </button>
              {button("Create order", "order", reserveForm)}
            </div>
          </section>
          {error && !modal && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {active !== "Receiving" && showAlerts && (
            <Panel
              title={`${alerts.length} exception alerts`}
              actions={
                <button
                  aria-label="Close alerts"
                  className="row-more"
                  onClick={() => setShowAlerts(false)}
                >
                  <X size={16} />
                </button>
              }
            >
              {alerts.map((a, i) => (
                <p key={i} className="alert-row">
                  {a}
                </p>
              ))}
              {!alerts.length && (
                <p className="empty-state">No active exceptions.</p>
              )}
            </Panel>
          )}
          {active !== "Receiving" && <section className="metrics-grid">
            {[
              {
                title: "Physical inventory",
                value: total,
                caption: "Across receiving and storage",
                icon: Boxes,
              },
              {
                title: "Available stock",
                value: free,
                caption: `${reserved} units reserved`,
                icon: Package,
              },
              {
                title: "Expired stock",
                value: expiredBucket,
                caption: "Excluded from availability",
                icon: ShieldCheck,
              },
              {
                title: "Open orders",
                value: totals.openOrders,
                caption: "Reserved, picking and packing",
                icon: ClipboardList,
              },
              {
                title: "Ready to ship",
                value: packed,
                caption: "Packed and verified",
                icon: Truck,
              },
            ].map((m) => (
              <article className="metric-card" key={m.title}>
                <div className="metric-top">
                  <span>{m.title}</span>
                  <div className="metric-icon">
                    <m.icon size={17} />
                  </div>
                </div>
                <div className="metric-value">{m.value.toLocaleString()}</div>
                <div className="metric-foot">{m.caption}</div>
                <div className="metric-foot">Scope: {scopeLabel}</div>
              </article>
            ))}
          </section>}
          <div className="module-content">{content}</div>
          <footer className="dashboard-footer">
            <span>
              <MapPin size={13} />
              Northstar Supply · {s.warehouses.length} warehouses
            </span>
            <span>{user.role} · IST</span>
          </footer>
        </main>
      </div>
      {message && (
        <div className="toast" role="status">
          <ShieldCheck size={16} />
          {message}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="form-title"
            className="panel form-dialog"
          >
            <div className="panel-heading">
              <h2 id="form-title">{modal.title}</h2>
              <button
                className="icon-button"
                aria-label="Close form"
                onClick={() => setModal(null)}
              >
                <X size={17} />
              </button>
            </div>
            <form onSubmit={submit}>
              <div className="form-grid">
                {modal.fields.map((f) => (
                  <label key={f.key}>
                    {f.label}
                    {f.options ? (
                      <select
                        name={f.key}
                        required={!f.optional}
                        {...(modal.extra?.multiProduct === "order" && f.key === "warehouse"
                          ? { value: orderWarehouse, onChange: (event: ChangeEvent<HTMLSelectElement>) => changeOrderWarehouse(event.target.value) }
                          : { defaultValue: f.value || "" })}
                      >
                        <option value="" disabled={!f.optional}>
                          {f.optional ? "None" : "Select…"}
                        </option>
                        {f.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : f.kind === "textarea" ? (
                      <textarea
                        name={f.key}
                        defaultValue={f.value}
                        required={!f.optional}
                        rows={9}
                      />
                    ) : (
                      <input
                        name={f.key}
                        type={
                          f.kind === "decimal" ? "number" : f.kind || "text"
                        }
                        step={
                          f.kind === "decimal"
                            ? "0.001"
                            : f.kind === "number"
                              ? "1"
                              : undefined
                        }
                        min={
                          ["number", "decimal"].includes(f.kind || "")
                            ? "0"
                            : f.kind === "date"
                              ? today()
                              : undefined
                        }
                        defaultValue={f.value}
                        required={!f.optional}
                        autoFocus={f === modal.fields[0]}
                        maxLength={f.kind === "password" ? 128 : 300}
                      />
                    )}
                    {f.hint && <small>{f.hint}</small>}
                  </label>
                ))}
              </div>
              {modal.extra?.multiProduct === "order" && (
                <div className="line-editor">
                  <div className="line-editor-heading">
                    <div><h3>Selected order products</h3><p>Choose products from the catalogue and adjust requested quantities.</p></div>
                    <button type="button" className="secondary-button" onClick={() => setOrderLines([...orderLines, { product: "", qty: "1" }])}>Add product</button>
                  </div>
                  {orderLines.map((line, index) => {
                    const product = s.products.find((p) => p.id === line.product);
                    const orderAvailability = productAvailability(s, orderWarehouse);
                    const availableQty = product ? orderAvailability.get(product.id)?.available || 0 : 0;
                    return <div className="line-editor-row order-line-row" key={index}>
                      <select aria-label={`Order product ${index + 1}`} disabled={!orderWarehouse} value={line.product} onChange={(e) => setOrderLines(orderLines.map((x, i) => i === index ? { ...x, product: e.target.value } : x))}>
                        <option value="">Select product…</option>
                        {naturalSort(s.products.filter((p) => orderAvailability.has(p.id)), (p) => p.name).map((p) => {
                          const summary = orderAvailability.get(p.id)!;
                          return <option key={p.id} value={p.id}>{p.id} · {p.name} · {summary.available} available{summary.earliestExpiry ? ` · earliest expiry ${summary.earliestExpiry}` : ""}</option>;
                        })}
                      </select>
                      <input aria-label={`Order quantity ${index + 1}`} type="number" min="1" max={availableQty || undefined} step="1" value={line.qty} onChange={(e) => setOrderLines(orderLines.map((x, i) => i === index ? { ...x, qty: e.target.value } : x))} />
                      <span className="line-availability">Max {availableQty} available</span>
                      {product && (!Number.isSafeInteger(Number(line.qty)) || Number(line.qty) < 1 || Number(line.qty) > availableQty) && <span className="error">Enter a whole number from 1 to {availableQty}.</span>}
                      <button type="button" className="icon-button" aria-label={`Remove order product ${index + 1}`} disabled={orderLines.length === 1} onClick={() => setOrderLines(orderLines.filter((_, i) => i !== index))}><X size={15} /></button>
                    </div>;
                  })}
                </div>
              )}
              {(modal.extra?.multiProduct === "transfer" || modal.extra?.multiProduct === "transferWarehouse") && (
                <div className="line-editor">
                  <div className="line-editor-heading">
                    <div><h3>Transfer products</h3><p>Select products and set the quantity to move.</p></div>
                    <button type="button" className="secondary-button" onClick={() => setTransferLines([...transferLines, { product: "", qty: "1" }])}>Add product</button>
                  </div>
                  {transferLines.map((line, index) => <div className="line-editor-row" key={index}>
                    <select aria-label={`Transfer product ${index + 1}`} value={line.product} onChange={(e) => setTransferLines(transferLines.map((x, i) => i === index ? { ...x, product: e.target.value } : x))}>
                      <option value="">Select product…</option>
                      {naturalSort(s.products, (p) => p.name).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}
                    </select>
                    <input aria-label={`Transfer quantity ${index + 1}`} type="number" min="1" value={line.qty} onChange={(e) => setTransferLines(transferLines.map((x, i) => i === index ? { ...x, qty: e.target.value } : x))} />
                    <button type="button" className="icon-button" aria-label={`Remove transfer product ${index + 1}`} disabled={transferLines.length === 1} onClick={() => setTransferLines(transferLines.filter((_, i) => i !== index))}><X size={15} /></button>
                  </div>)}
                </div>
              )}
              {modal.extra?.multiProduct === "transferReceive" && (
                <div className="line-editor">
                  <div className="line-editor-heading"><div><h3>Received transfer quantities</h3><p>Adjust received quantity for each dispatched product. Use zero for a missing line.</p></div></div>
                  {transferReceiveLines.map((line, index) => <div className="line-editor-row" key={index}>
                    <select aria-label={`Received transfer product ${index + 1}`} value={line.product} disabled>
                      {s.products.filter((p) => p.id === line.product).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}
                    </select>
                    <input aria-label={`Received transfer quantity ${index + 1}`} type="number" min="0" value={line.qty} onChange={(e) => setTransferReceiveLines(transferReceiveLines.map((x, i) => i === index ? { ...x, qty: e.target.value } : x))} />
                  </div>)}
                </div>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="dialog-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button disabled={busy} className="primary-button">
                  {busy ? "Saving…" : "Save and record"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {documentOrder && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Order documents"
            className="panel form-dialog document-dialog"
          >
            <div className="panel-heading">
              <h2>Order documents</h2>
              <div className="inline-actions">
                <button
                  className="secondary-button"
                  onClick={() => window.print()}
                >
                  Print documents
                </button>
                <button
                  className="icon-button"
                  aria-label="Close documents"
                  onClick={() => setDocumentOrder(null)}
                >
                  <X size={17} />
                </button>
              </div>
            </div>
            <div className="print-document">
              <div className="brand">stockroom.</div>
              <h2>Picking list · Package label · Dispatch note</h2>
              <h3>{documentOrder.id}</h3>
              <p>Customer: {documentOrder.customer}</p>
              <p>
                SKU: {documentOrder.product} · Barcode:{" "}
                {
                  s.products.find((p) => p.id === documentOrder.product)
                    ?.barcode
                }
              </p>
              <p>
                Ordered: {documentOrder.qty} · Picked / packed:{" "}
                {documentOrder.picked} · Status: {documentOrder.status}
              </p>
              <p>Picker: {documentOrder.assignee || "Not assigned"}</p>
              <Table
                headers={["Lot", "Batch", "Pick location", "Quantity"]}
                rows={documentOrder.allocations.map((a) => {
                  const l = s.lots.find((l) => l.id === a.lot);
                  return [a.lot, l?.batch, l?.location, a.qty];
                })}
              />
              <p>
                Material: {documentOrder.material || "—"} · Dimensions (cm):{" "}
                {documentOrder.dimensions || "—"} · Weight:{" "}
                {documentOrder.weight} kg
              </p>
              <p>
                Carrier: {documentOrder.courier || "—"} · Tracking:{" "}
                {documentOrder.tracking || "—"} · Delivery:{" "}
                {documentOrder.delivery || "—"}
              </p>
              <p>Package reference: PKG-{documentOrder.id}</p>
              <p>
                Generated{" "}
                {new Date().toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}{" "}
                IST
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
