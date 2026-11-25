"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { AlertTriangle, Boxes, Crosshair, Hand, MapPin, Package, Plus, Truck, X } from "lucide-react";
import {
  can, compareZones, evaluateProductCompliance, expectedZoneForProduct, hasStoredStock, inLayoutPath, isSingleLetterZone, layoutReference, locationPosition, lotWarehouse, naturalSort, normalizeZone, placementEvaluations, today,
  receivingReceipt, storageOccupancy, storageTone, warehouseStorageTotals, type PlacementEvaluation, type ProductLocationCompliance, type StorageOccupancy, type Command, type LayoutBlock, type LayoutPath,
  type Location, type Lot, type Role, type State,
} from "@/lib/wms";
import type { Field } from "./warehouse-dashboard";
import styles from "./warehouse-space-map.module.css";

type MapState = Pick<State, "locations" | "warehouses" | "products" | "lots" | "receipts" | "suppliers" | "rackGrids" | "layoutBlocks" | "layoutSections">;
type Selection = { path: LayoutPath; unit?: string };
type StorageRow = { number: number; name: string; units: Location[] };
type Section = { id: string; units: Location[]; rows: number; columns: number; configured: boolean; rowGroups: StorageRow[]; removedRows?: number[]; rowNumbers?: number[]; rowNames?: Record<number, string> };
type Rack = { id: string; sections: Section[] };
type Zone = { id: string; racks: Rack[] };
type Props = {
  state: MapState;
  role: Role;
  pendingId: string | null;
  setPendingId: (id: string | null) => void;
  open: (title: string, type: string, fields: Field[], extra?: Record<string, unknown>) => void;
  action: (command: Command) => Promise<boolean>;
  warehouseScope: string;
  onWarehouseScopeChange: (scope: string) => void;
};
type PanGesture = { pointer: number; x: number; y: number; left: number; top: number };

const formatQuantity = new Intl.NumberFormat("en").format;
const legend = [["available", "Available"], ["partial", "Occupied"], ["full", "Full"], ["blocked", "Blocked"]];
const placementLegend = [["best", "Best match"], ["compatible", "Compatible"], ["partial", "Partial fit"], ["not-possible", "Not possible"]];
const choices = (values: string[]) => values.map((value) => ({ value, label: value }));
const sortById = <T extends { id: string }>(items: Iterable<T>) => naturalSort([...items], (item) => item.id);
const numericField = (key: string, label: string, value: number): Field => ({ key, label, kind: "number", value: String(value) });

function buildZones(state: MapState, warehouse: string): Zone[] {
  const zones = new Map<string, Map<string, Map<string, Section>>>();
  function add(zone: string, rack?: string, section?: string) {
    const racks = zones.get(zone) ?? new Map<string, Map<string, Section>>();
    zones.set(zone, racks);
    if (rack === undefined) return;
    const sections = racks.get(rack) ?? new Map<string, Section>();
    racks.set(rack, sections);
    if (section === undefined) return;
    const group = sections.get(section) ?? { id: section, units: [], rows: 1, columns: 1, configured: false, rowGroups: [] };
    sections.set(section, group);
    return group;
  }
  for (const block of state.layoutBlocks ?? []) {
    if (block.warehouse === warehouse) add(block.zone, block.rack);
  }
  for (const grid of state.rackGrids ?? []) {
    if (grid.warehouse === warehouse) add(grid.zone, grid.rack);
  }
  for (const section of state.layoutSections ?? []) {
    if (section.warehouse !== warehouse) continue;
    Object.assign(add(section.zone, section.rack, section.section)!, { rows: section.rows, columns: section.columns, configured: true, removedRows: section.removedRows, rowNumbers: section.rowNumbers, rowNames: section.rowNames });
  }
  for (const unit of state.locations) {
    if (unit.warehouse !== warehouse) continue;
    const position = locationPosition(unit);
    const section = add(position.zone, position.rack, position.section)!;
    section.units.push(unit);
    if (!section.configured) {
      section.rows = Math.max(section.rows, position.row);
      section.columns = Math.max(section.columns, position.column);
    }
  }
  return [...zones].map(([zone, racks]) => ({
    id: zone, racks: sortById([...racks].map(([id, sections]) => {
      const grid = state.rackGrids?.find((grid) => grid.warehouse === warehouse && grid.zone === zone && grid.rack === id);
      if (grid) {
        const original = add(zone, id, grid.section ?? `${id}-01`)!;
        original.rows = Math.max(original.rows, grid.rows);
        original.columns = Math.max(original.columns, grid.columns);
        original.configured = true;
      }
      for (const section of sections.values()) {
        const rows = new Map<number, Location[]>();
        if (section.configured) {
          const shown = section.rowNumbers ?? Array.from({ length: section.rows }, (_, index) => index + 1);
          for (const number of shown) if (!section.removedRows?.includes(number)) rows.set(number, []);
        }
        for (const unit of section.units) {
          const { row } = locationPosition(unit);
          const units = rows.get(row) ?? [];
          units.push(unit);
          rows.set(row, units);
        }
        section.rowGroups = [...rows].sort(([left], [right]) => left - right).map(([number, units]) => ({
          number, name: section.rowNames?.[number] ?? `Row ${number}`,
          units: units.sort((a, b) => locationPosition(a).column - locationPosition(b).column || locationPosition(a).shelf - locationPosition(b).shelf),
        }));
      }
      return { id, sections: sortById(sections.values()) };
    })),
  })).sort((a, b) => compareZones(a.id, b.id));

}

function defaultRackHeight(rack: Rack, width: number) {
  const unitColumns = Math.max(1, Math.floor((width - 116) / 48));
  const content = rack.sections.reduce((height, section) => height + 35 + section.rowGroups.reduce((sum, row) =>
    sum + Math.max(48, Math.ceil(row.units.length / unitColumns) * 24 + 8), 0), 0);
  return Math.max(108, Math.min(550, 50 + content));
}

export function IncomingPlacement({ state, role, onPlace, warehouseScope }: {
  state: MapState; role: Role; onPlace: (lot: Lot) => void; warehouseScope: string;
}) {
  const incoming = naturalSort(state.lots.filter((lot) => lot.location === "RECEIVING" && lot.qty > 0 &&
    (warehouseScope === "ALL" || lotWarehouse(state, lot) === warehouseScope)),
    (lot) => state.products.find((product) => product.id === lot.product)?.name || lot.product);
  return <section className={`panel ${styles.receiving}`}>
    <h3><Truck size={16} /> Incoming receipts (Receiving Stock)</h3>
    {incoming.length ? <div className="table-wrap"><table>
      <thead><tr>{["Receipt", "Supplier", "Warehouse", "Product", "Batch / expiry", "Awaiting placement", "Action"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{incoming.map((lot) => {
        const receipt = receivingReceipt(state, lot);
        const product = state.products.find((item) => item.id === lot.product);
        const expectedZone = product ? expectedZoneForProduct(product.name) : null;
        return <tr key={lot.id}>
          <td>{receipt?.grn || lot.id}</td>
          <td>{state.suppliers.find((supplier) => supplier.id === receipt?.supplier)?.name || receipt?.supplier || "—"}</td>
          <td>{state.warehouses.find((warehouse) => warehouse.id === receipt?.warehouse)?.name || receipt?.warehouse || "—"}</td>
          <td>
            <strong>{product?.name || lot.product}</strong>
            <small style={{ display: "block", color: "#1e5b3c" }}>
              {expectedZone ? `Recommended: Zone ${expectedZone}` : "No zone designated"}
            </small>
          </td>
          <td>{lot.batch} · {lot.expiry}</td><td>{lot.qty} units</td>
          <td>{can(role, "putaway") && <button className="primary-button" onClick={() => onPlace(lot)}>Put away</button>}</td>
        </tr>;
      })}</tbody>
    </table></div> : <p className="empty-state">No receiving stock is waiting for placement.</p>}
  </section>;
}

export default function WarehouseSpaceMap({ state, role, pendingId, setPendingId, open, action, warehouseScope, onWarehouseScopeChange }: Props) {
  const [warehouseId, setWarehouseId] = useState(state.warehouses[0]?.id || "");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [zoneFilter, setZoneFilter] = useState("");
  const [rackFilter, setRackFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [azZoneFilter, setAzZoneFilter] = useState("");
  const [azMismatchFilter, setAzMismatchFilter] = useState<"all" | "mismatch" | "correct">("all");
  const [pan, setPan] = useState(false);
  const [floorPlan, setFloorPlan] = useState(false);
  const [compactHeight, setCompactHeight] = useState(0);
  const [zoomOverride, setZoom] = useState<number>();
  const [canvasWidth, setCanvasWidth] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const drag = useRef<PanGesture | null>(null);
  const pending = state.lots.find((lot) => lot.id === pendingId && lot.location === "RECEIVING" && lot.qty > 0);
  const receipt = pending && receivingReceipt(state, pending);
  const selectedWarehouse = warehouseScope === "ALL" ? warehouseId : warehouseScope;
  const warehouse = receipt?.warehouse || (state.warehouses.some((item) => item.id === selectedWarehouse) ? selectedWarehouse : state.warehouses[0]?.id) || "";
  const warehouseName = state.warehouses.find((item) => item.id === warehouse)?.name || "Warehouse";
  const warehouseCapacity = warehouseStorageTotals(state, warehouse);
  const managing = warehouse && can(role, "configureLayoutSection") && !pending;
  const compact = !floorPlan;
  const zones = useMemo(() => buildZones(state, warehouse), [state, warehouse]);
  const locations = useMemo(() => state.locations.filter((location) => location.warehouse === warehouse), [state.locations, warehouse]);
  const products = naturalSort(state.products, (product) => product.name);
  const names = new Map(products.map((product) => [product.id, product.name]));
  const byLocation = useMemo(() => {
    const entries = new Map<string, Lot[]>();
    for (const lot of state.lots) {
      if (lot.qty <= 0) continue;
      const lots = entries.get(lot.location);
      if (lots) lots.push(lot);
      else entries.set(lot.location, [lot]);
    }
    return entries;
  }, [state.lots]);
  const occupancyIndex = useMemo(() => storageOccupancy(state), [state.locations, state.lots]);
  const placed = new Map((state.layoutBlocks ?? []).filter((block) => block.warehouse === warehouse)
    .map((block) => [layoutReference(block), block]));
  const preview = (block: LayoutBlock) => placed.get(layoutReference(block)) ?? block;
  const lanes = [24, 24];
  const zoneViews = zones.map((zone, index) => {
    const lane = index % 2;
    let nextY = 12;
    const path = { warehouse, zone: zone.id };
    const storedZone = placed.get(layoutReference(path));
    const rackWidth = Math.max(180, Math.min(364, (storedZone?.width ?? 390) - 32));
    const racks = zone.racks.map((rack) => {
      const block = preview({ ...path, rack: rack.id, x: 12, y: nextY, width: rackWidth, height: defaultRackHeight(rack, rackWidth) });
      nextY = Math.max(nextY, block.y + block.height + 10);
      return { rack, block };
    });
    const block = preview({ ...path, x: 24 + lane * 430, y: lanes[lane], width: 390, height: Math.max(166, nextY + 46) });
    lanes[lane] = Math.max(lanes[lane], block.y + block.height + 40);
    return { zone, block, racks };
  });
  const matchesProduct = (unit: Location) => !productFilter || unit.assignedProduct === productFilter ||
    byLocation.get(unit.id)?.some((lot) => lot.product === productFilter);
  const enabledZoneFilter = !pending && zoneViews.some(({ zone }) => zone.id === zoneFilter) ? zoneFilter : "";
  const filterRacks = [...new Set(zoneViews.filter(({ zone }) => !enabledZoneFilter || zone.id === enabledZoneFilter)
    .flatMap(({ racks }) => racks.map(({ rack }) => rack.id)))];
  const enabledRackFilter = !pending && filterRacks.includes(rackFilter) ? rackFilter : "";
  const visibleZones = zoneViews.filter(({ zone }) => !enabledZoneFilter || zone.id === enabledZoneFilter)
    .map((view) => ({
      ...view, racks: view.racks.filter(({ rack }) =>
        (!enabledRackFilter || rack.id === enabledRackFilter) &&
        (pending || !productFilter || rack.sections.some((section) => section.units.some(matchesProduct))))
    }))
    .filter((view) => view.racks.length || (!enabledRackFilter && (pending || !productFilter)));
  const stageWidth = compact ? Math.max(1, (canvasWidth || 320) - 2) : Math.max(440, ...zoneViews.map(({ block }) => block.x + block.width + 24));
  const stageHeight = compact ? compactHeight || 240 : Math.max(320, ...zoneViews.map(({ block }) => block.y + block.height + 40));
  const zoom = zoomOverride ?? (canvasWidth ? Math.max(25, Math.min(100, Math.floor(100 * (canvasWidth - 2) / stageWidth))) : 100);
  const selectedZone = zoneViews.find(({ zone }) => zone.id === selection?.path.zone);
  const selectedRack = selectedZone?.racks.find(({ rack }) => rack.id === selection?.path.rack);
  const selectedSection = selectedRack?.rack.sections.find((section) => section.id === selection?.path.section);
  const selectedUnit = selection?.unit ? locations.find((unit) => unit.id === selection.unit) : undefined;
  const selectedPath = selection?.path.warehouse === warehouse && selectedZone &&
    (!selection.path.rack || selectedRack) && (!selection.path.section || selectedSection) &&
    (selection.path.row === undefined || selectedSection?.rowGroups.some((row) => row.number === selection.path.row)) ? selection.path : undefined;
  const currentPath = selectedPath && (!selection?.unit || selectedUnit) ? selectedPath : undefined;
  const members = currentPath ? (selectedUnit ? [selectedUnit] : locations.filter((unit) => inLayoutPath(unit, currentPath))) : locations;
  const scope = selectedUnit ? "Unit" : currentPath?.row !== undefined ? "Row" : currentPath?.section ? "Section" :
    currentPath?.rack ? "Rack" : currentPath ? "Zone" : "Warehouse";
  const selectedRow = selectedSection?.rowGroups.find((row) => row.number === currentPath?.row);
  const currentName = selectedUnit ? selectedUnit.name || selectedUnit.id : scope === "Row" ? selectedRow?.name ?? `Row ${currentPath?.row}` :
    scope === "Section" ? `Section ${currentPath?.section}` : scope === "Rack" ? `Rack ${currentPath?.rack}` :
      scope === "Zone" ? `Zone ${currentPath?.zone}` : warehouseName;
  const summary = selectedUnit ? occupancyIndex.unit(selectedUnit.id) : occupancyIndex.group(warehouse, currentPath);
  const occupancy = summary.capacity ? Math.round(summary.occupied * 100 / summary.capacity) : 0;
  const stock = naturalSort(members.flatMap((unit) => byLocation.get(unit.id) ?? []), (lot) => names.get(lot.product) || lot.product);
  const totals = new Map<string, number>();
  for (const lot of stock) totals.set(lot.product, (totals.get(lot.product) ?? 0) + lot.qty);
  const placementSet = useMemo(() => pending ? placementEvaluations(state, pending, locations) : [], [state, pending, locations]);
  const placementByLocation = useMemo(() => new Map(placementSet.map((evaluation) => [evaluation.location.id, evaluation])), [placementSet]);
  const rowOptions = pending && currentPath?.row !== undefined && !selectedUnit
    ? placementSet.filter((evaluation) => inLayoutPath(evaluation.location, currentPath) && evaluation.tier !== "not-possible")
      .map((evaluation) => ({ location: evaluation.location, available: evaluation.free }))
    : [];
  const rowFree = rowOptions.reduce((sum, item) => sum + item.available, 0);
  const selectedEvaluation = selectedUnit ? placementByLocation.get(selectedUnit.id) : undefined;
  const placementIssue = selectedEvaluation?.issue || "";
  const pendingProduct = pending ? products.find((product) => product.id === pending.product) : undefined;
  const pendingExpectedZone = pendingProduct ? expectedZoneForProduct(pendingProduct.name) : null;
  const expectedZoneObj = pendingExpectedZone ? zones.find((zone) => normalizeZone(zone.id) === normalizeZone(pendingExpectedZone)) : undefined;
  const expectedZonePlacements = pending && pendingExpectedZone
    ? placementSet.filter((evaluation) => normalizeZone(evaluation.location.zone || locationPosition(evaluation.location).zone) === normalizeZone(pendingExpectedZone))
    : [];
  const hasEligibleInExpectedZone = expectedZonePlacements.some((evaluation) => evaluation.tier !== "not-possible");
  const suggested = pending
    ? (hasEligibleInExpectedZone
      ? expectedZonePlacements.find((evaluation) => evaluation.tier !== "not-possible")?.location
      : placementSet.find((evaluation) => evaluation.tier !== "not-possible")?.location)
    : undefined;
  const placementCounts = pending ? placementSet.reduce((counts, evaluation) => {
    if (evaluation.tier !== "not-possible") counts[evaluation.tier] += 1;
    return counts;
  }, { best: 0, compatible: 0, partial: 0 }) : { best: 0, compatible: 0, partial: 0 };

  const migrationReport = useMemo(() => {
    const list: {
      lot: Lot;
      productName: string;
      currentZone: string;
      expectedZone: string;
      locationDesc: string;
      locationId: string;
      qty: number;
      batch: string;
      expiry: string;
      compliance: ProductLocationCompliance;
    }[] = [];
    for (const lot of state.lots) {
      if (lot.qty <= 0 || lot.location === "RECEIVING") continue;
      if (warehouseScope !== "ALL" && lotWarehouse(state, lot) !== warehouse) continue;
      const loc = locations.find((l) => l.id === lot.location);
      if (!loc) continue;
      const product = state.products.find((p) => p.id === lot.product);
      if (!product) continue;
      const evaluation = evaluateProductCompliance(state, lot);
      if (evaluation.compliance === "Zone Mismatch" || evaluation.compliance === "Storage Compatibility Issue") {
        const pos = locationPosition(loc);
        list.push({
          lot,
          productName: product.name,
          currentZone: evaluation.actualZone || pos.zone,
          expectedZone: evaluation.expectedZone || "—",
          locationDesc: `Rack ${pos.rack}, R${pos.row}C${pos.column} (${loc.id})`,
          locationId: loc.id,
          qty: lot.qty,
          batch: lot.batch,
          expiry: lot.expiry,
          compliance: evaluation.compliance,
        });
      }
    }
    return naturalSort(list, (item) => item.productName);
  }, [state.lots, state.products, locations, warehouse, warehouseScope]);

  const directoryAlphabeticalGroups = useMemo(() => {
    const items = products.map((product) => {
      const expected = expectedZoneForProduct(product.name);
      const units = locations.filter((unit) =>
        unit.assignedProduct === product.id || byLocation.get(unit.id)?.some((lot) => lot.product === product.id)
      );
      const unitDetails = units.map((unit) => {
        const pos = locationPosition(unit);
        const actualZone = unit.zone || pos.zone;
        const isMatch = expected && normalizeZone(actualZone) === normalizeZone(expected);
        return {
          unit,
          actualZone,
          rack: pos.rack,
          row: pos.row,
          column: pos.column,
          isMatch,
        };
      });
      const hasMismatch = unitDetails.some((u) => !u.isMatch);
      const hasMatch = unitDetails.some((u) => u.isMatch);
      return {
        product,
        expected,
        units: unitDetails,
        hasMismatch,
        hasMatch,
      };
    }).filter(({ units, expected, hasMismatch, hasMatch }) => {
      if (!units.length) return false;
      if (azZoneFilter && !units.some((u) => normalizeZone(u.actualZone) === normalizeZone(azZoneFilter)) && normalizeZone(expected || "") !== normalizeZone(azZoneFilter)) {
        return false;
      }
      if (azMismatchFilter === "mismatch" && !hasMismatch) return false;
      if (azMismatchFilter === "correct" && !hasMatch) return false;
      return true;
    });

    const groups = new Map<string, typeof items>();
    for (const item of items) {
      const letter = expectedZoneForProduct(item.product.name) || "#";
      const list = groups.get(letter) ?? [];
      list.push(item);
      groups.set(letter, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [products, locations, byLocation, azZoneFilter, azMismatchFilter]);

  useEffect(() => {
    if (pendingId) {
      heading.current?.scrollIntoView({ block: "start" });
      heading.current?.focus({ preventScroll: true });
    }
  }, [pendingId]);

  const hasZones = zones.length > 0;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => setCanvasWidth(element.clientWidth);
    const resize = new ResizeObserver(update);
    update();
    resize.observe(element);
    return () => resize.disconnect();
  }, [hasZones]);

  useEffect(() => {
    const element = stage.current;
    if (!compact || !element) return;
    const update = () => setCompactHeight(element.offsetHeight);
    const resize = new ResizeObserver(update);
    update();
    resize.observe(element);
    return () => resize.disconnect();
  }, [compact, hasZones]);

  function changeView(nextFloorPlan: boolean) {
    setFloorPlan(nextFloorPlan);
    setZoom(undefined);
    viewport.current?.scrollTo(0, 0);
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    const element = viewport.current;
    if (!element || event.button !== 0 || (!pan && (event.target as HTMLElement).closest("[data-layout-block]"))) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
  }

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    const origin = drag.current;
    if (!origin || origin.pointer !== event.pointerId) return;
    const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
    viewport.current?.scrollTo({ left: origin.left - dx, top: origin.top - dy });
  }

  function fit() {
    const element = viewport.current;
    if (!element) return;
    setZoom(Math.max(25, Math.min(100, Math.floor(100 * Math.min(element.clientWidth / stageWidth, element.clientHeight / stageHeight)))));
    element.scrollTo(0, 0);
  }

  function addZone() {
    open("Add zone", "createLayoutZone", [{ key: "zone", label: "Zone ID" }],
      { warehouse, x: 24, y: Math.max(24, ...zoneViews.map(({ block }) => block.y + block.height + 32)), width: 390, height: 166 });
  }

  function addRack() {
    open("Add rack", "configureRack", [
      { key: "zone", label: "Zone", options: choices(zones.map((zone) => zone.id)), value: currentPath?.zone || zones[0]?.id },
      { key: "rack", label: "Rack ID" }, numericField("rows", "Rows", 2), numericField("columns", "Columns per row", 3),
      numericField("capacity", "Capacity per storage unit", 10),
    ], { warehouse, create: true, layout: true });
  }

  function addRackUnits() {
    if (!currentPath?.rack || !selectedRack) return;
    const sections = selectedRack.rack.sections;
    const section = selectedSection ?? sections[0];
    open("Add rows and columns", "configureLayoutSection", [
      ...(sections.length > 1 ? [{ key: "section", label: "Rack section", value: section?.id, options: choices(sections.map((item) => item.id)) }] : []),
      {
        key: "rowName", label: "Row name", value: selectedRow?.name ?? `Row ${(section?.rows ?? 0) + 1}`,
        hint: "Enter an existing row name to expand it, or a new name to create a row."
      },
      {
        ...numericField("columnCount", "Total columns for this row", (currentPath.row === undefined ? 0 :
          new Set(section?.rowGroups.find((row) => row.number === currentPath.row)?.units.map((unit) => locationPosition(unit).column)).size) + 1),
        hint: "For example, Row 1 with 2 columns has R1C1 and R1C2."
      },
      numericField("capacity", "Capacity per new storage unit", section?.units[0]?.capacity ?? 10),
    ], {
      warehouse, zone: currentPath.zone, rack: currentPath.rack,
      ...(sections.length <= 1 ? { section: section?.id ?? `${currentPath.rack}-01`, create: sections.length === 0 } : {}),
    });
  }

  function initiateStockRelocation(lot: Lot) {
    const product = products.find((p) => p.id === lot.product);
    if (!product) return;
    const expected = expectedZoneForProduct(product.name);
    const candidateLocs = locations.filter((l) => !l.blocked && normalizeZone(l.zone || locationPosition(l).zone) === normalizeZone(expected || ""));
    const destChoices = candidateLocs.map((l) => ({ value: l.id, label: `${l.id} (Zone ${l.zone || locationPosition(l).zone})` }));
    open(`Relocate ${product.name} to Compliant Zone ${expected || ""}`, "move", [
      { key: "lot", label: "Lot ID", value: lot.id },
      numericField("qty", `Quantity to move (max ${lot.qty})`, lot.qty),
      { key: "destination", label: `Destination in Zone ${expected || ""}`, options: destChoices.length ? destChoices : choices(locations.map((l) => l.id)), value: destChoices[0]?.value || "" },
    ], { warehouse });
  }

  function place() {
    if (!pending || !currentPath) return;
    const product = products.find((item) => item.id === pending.product);
    if (!product) return;
    const targetZone = currentPath.zone;
    const expZone = expectedZoneForProduct(product.name);
    const isMismatch = expZone && normalizeZone(targetZone) !== normalizeZone(expZone);
    if (isMismatch) {
      const confirmed = window.confirm(
        `ZONE MISMATCH WARNING:\n\nProduct "${product.name}" is designated for alphabetical Zone ${expZone}.\nThe selected destination "${currentName}" is in Zone ${targetZone}.\n\nDo you authorize this alternative zone assignment?`
      );
      if (!confirmed) return;
    }
    const barcode = selectedUnit?.id || layoutReference(currentPath);
    const max = Math.min(pending.qty, selectedUnit ? occupancyIndex.unit(selectedUnit.id).available : rowFree);
    open(`Place ${product.name} in ${currentName}`, selectedUnit ? "putaway" : "putawayRow", [
      numericField("qty", `Quantity (up to ${max})`, max),
      { key: "productBarcode", label: "Product barcode", value: product.barcode },
      { key: "locationBarcode", label: selectedUnit ? "Location barcode" : "Row reference", value: barcode },
      ...(isMismatch ? [{ key: "zoneMismatchAuthorized", label: "Authorized Alternative Zone Override", value: `Authorized override: Placing in Zone ${targetZone} (Expected: Zone ${expZone})` }] : []),
    ], { ...currentPath, lot: pending.id, ...(selectedUnit ? { destination: selectedUnit.id, fromMap: true } : {}), confirmZoneMismatch: isMismatch });
  }

  function clearFilters() {
    setZoneFilter("");
    setRackFilter("");
    setProductFilter("");
  }

  function chooseUnit(unit: Location, wholeRow = false) {
    clearFilters();
    const position = locationPosition(unit);
    const path = { warehouse, zone: position.zone, rack: position.rack, section: position.section, row: position.row };
    setSelection({ path, unit: wholeRow ? undefined : unit.id });
    requestAnimationFrame(() => document.getElementById(layoutReference(path))?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }

  const selectedColumn = selectedUnit ? locationPosition(selectedUnit).column : undefined;
  const columnUnits = selectedColumn === undefined ? [] : selectedSection?.units.filter((unit) => locationPosition(unit).column === selectedColumn) ?? [];
  const rowUnits = selectedSection?.rowGroups.find((row) => row.number === currentPath?.row)?.units ?? [];

  async function remove(axis?: "row" | "column") {
    if (!currentPath || !window.confirm(`Remove ${axis === "row" ? `row ${currentPath.row}` : axis === "column" ? `column ${selectedColumn}` : currentName}?`)) return;
    const saved = axis ? await action({
      type: "configureLayoutSection", ...currentPath, removeAxis: axis,
      ...(axis === "column" ? { column: selectedColumn } : {})
    }) :
      await action({ type: "editMapGroup", warehouse, zone: currentPath.zone, rack: currentPath.rack, remove: true, stockOnly: true });
    if (saved) setSelection(null);
  }

  const positionStyle = ({ x, y, width, height }: LayoutBlock) => ({ left: x, top: y, width, height });

  return <div className={styles.map}>
    <section className="panel">
      <header className={styles.header}>
        <div><h2 ref={heading} tabIndex={-1}><MapPin size={21} /> Warehouse Layout Builder</h2></div>
        <div className={styles.controls}>
          <select aria-label="Warehouse" value={warehouseScope} disabled={Boolean(receipt)} onChange={(event) => { const value = event.target.value; onWarehouseScopeChange(value); if (value !== "ALL") setWarehouseId(value); setSelection(null); setZoom(undefined); clearFilters(); viewport.current?.scrollTo(0, 0); }}>
            <option value="ALL">All warehouses</option>
            {state.warehouses.length ? state.warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">No warehouses</option>}
          </select>
        </div>
      </header>
      <div className={styles.toolbar}>
        <div className={styles.viewSwitch} role="group" aria-label="Warehouse view">
          <button aria-pressed={compact} onClick={() => changeView(false)}>Compact</button>
          <button aria-pressed={!compact} onClick={() => changeView(true)}>Floor plan</button>
        </div>
        <div className={styles.controls} aria-label="Canvas controls">
          <button className="secondary-button" aria-pressed={pan} onClick={() => setPan(!pan)}><Hand size={14} />Pan</button>
          <button className="secondary-button" aria-label="Zoom out" disabled={zoom <= 25} onClick={() => setZoom(Math.max(25, zoom - 15))}>&minus;</button>
          <button className="secondary-button" aria-label="Reset to automatic zoom" onClick={() => setZoom(undefined)}>{zoom}%</button>
          <button className="secondary-button" aria-label="Zoom in" disabled={zoom >= 175} onClick={() => setZoom(Math.min(175, zoom + 15))}>+</button>
          <button className="secondary-button" onClick={fit}><Crosshair size={14} />Fit</button>
        </div>
        {!pending && zones.length > 0 && <div className={`${styles.controls} ${styles.filters}`}>
          <select aria-label="Filter by zone" value={enabledZoneFilter} onChange={(event) => { setZoneFilter(event.target.value); setRackFilter(""); }}>
            <option value="">All zones</option>{zones.map((zone) => <option key={zone.id}>{zone.id}</option>)}
          </select>
          <select aria-label="Filter by rack" value={enabledRackFilter} onChange={(event) => setRackFilter(event.target.value)}>
            <option value="">All racks</option>{filterRacks.map((rack) => <option key={rack}>{rack}</option>)}
          </select>
          <select aria-label="Filter by product" value={productFilter} onChange={(event) => setProductFilter(event.target.value)}>
            <option value="">All products</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          {(enabledZoneFilter || enabledRackFilter || productFilter) && <button className="secondary-button" onClick={clearFilters}>Clear filters</button>}
        </div>}
        <div className={styles.legend}>{legend.map(([tone, label]) => <span key={tone}><i data-tone={tone} />{label}</span>)}</div>
        {pending && <div className={styles.legend}>{placementLegend.map(([tone, label]) => <span key={tone}><i data-placement={tone} />{label}</span>)}</div>}
      </div>
      {managing && <div className={styles.toolbar}>
        <div className={styles.controls}>
          <button className="secondary-button" onClick={addZone}><Plus size={14} />Add zone</button>
          <button className="secondary-button" disabled={!zones.length} onClick={addRack}><Plus size={14} />Add rack</button>
          <button className="secondary-button" disabled={!currentPath?.rack}
            onClick={addRackUnits}><Plus size={14} />Add rows and columns</button>
        </div>
      </div>}
      {pending && <div className={styles.placement} role="status">
        <span><strong>{names.get(pending.product) || pending.product}</strong> &middot; {pending.qty} awaiting placement. {placementCounts.best} best, {placementCounts.compatible} compatible, {placementCounts.partial} partial.</span>
        <div className={styles.controls}>
          {suggested ? <button className="secondary-button" onClick={() => chooseUnit(suggested, true)}>Find compatible row</button> : <strong>No compatible capacity</strong>}
          {!placementCounts.best && !placementCounts.compatible && placementCounts.partial > 0 && <strong>No single location fits the full quantity.</strong>}
          <button className="secondary-button" onClick={() => setPendingId(null)}>Cancel placement</button>
        </div>
      </div>}
      {pending && pendingExpectedZone && (
        !expectedZoneObj ? (
          <div className={styles.zoneAlert} data-type="error" role="alert">
            <span><strong>Zone Exception:</strong> Recommended Zone {pendingExpectedZone} for &quot;{pendingProduct?.name}&quot; does not exist in {warehouseName}. Please configure Zone {pendingExpectedZone} or designate an authorized alternative zone.</span>
          </div>
        ) : !hasEligibleInExpectedZone ? (
          <div className={styles.zoneAlert} data-type="warning" role="alert">
            <span><strong>Zone Full Warning:</strong> Recommended Zone {pendingExpectedZone} has no compatible storage space for {pending.qty} units of &quot;{pendingProduct?.name}&quot;. Alternative zone assignment is permitted only after warning and confirmation.</span>
          </div>
        ) : (
          <div className={styles.zoneAlert} data-type="recommended">
            <span><strong>Recommended Zone:</strong> Zone {pendingExpectedZone} (Alphabetical allocation for &quot;{pendingProduct?.name}&quot;). Compatible capacity available.</span>
            {expectedZonePlacements.find((e) => e.tier !== "not-possible")?.location && (
              <button className="secondary-button" onClick={() => chooseUnit(expectedZonePlacements.find((e) => e.tier !== "not-possible")!.location, true)}>
                Navigate to Zone {pendingExpectedZone} Bin
              </button>
            )}
          </div>
        )
      )}
      <div className={styles.workspace}>
        <div className={styles.plan}>
          <div className={styles.canvasTitle}><strong>{warehouseName}</strong><span>{zones.length} zones &middot; {zoneViews.reduce((sum, view) => sum + view.racks.length, 0)} racks</span></div>
          {zones.length > 0 && (
            <div className={styles.zoneNavIndex} role="navigation" aria-label="Alphabetical Zone Index">
              <span className={styles.zoneNavLabel}>Zone Index:</span>
              {zones.map((zone) => {
                const isSelected = scope === "Zone" && currentPath?.zone === zone.id;
                const isAlpha = isSingleLetterZone(zone.id);
                return (
                  <button
                    key={zone.id}
                    className={styles.zoneNavChip}
                    data-selected={isSelected}
                    data-alpha={isAlpha}
                    onClick={() => {
                      const zonePath = { warehouse, zone: zone.id };
                      setSelection({ path: zonePath });
                      const el = document.getElementById(layoutReference(zonePath));
                      el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
                    }}
                    title={`Navigate to Zone ${zone.id}`}
                  >
                    Zone {zone.id}
                  </button>
                );
              })}
            </div>
          )}
          {zones.length ? <div ref={viewport} className={styles.viewport} data-pan={pan} style={{ "--canvas-height": `${Math.ceil(stageHeight * zoom / 100) + 2}px` } as CSSProperties} aria-label="Warehouse layout canvas" tabIndex={0}
            onPointerDown={startPan} onPointerMove={movePointer} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
            <div className={styles.scaledBounds} style={{ width: stageWidth * zoom / 100, height: stageHeight * zoom / 100 }}>
              <div ref={stage} className={styles.stage} data-compact={compact} style={{ width: stageWidth, height: compact ? undefined : stageHeight, transform: `scale(${zoom / 100})` }}>
                {!visibleZones.length && <p className={styles.filterEmpty}>No racks match the filters.</p>}
                {visibleZones.map(({ zone, block, racks }) => {
                  const zonePath = { warehouse, zone: zone.id };
                  const zoneStats = occupancyIndex.group(warehouse, zonePath);
                  return <section key={zone.id} id={layoutReference(zonePath)} className={styles.zoneBlock} data-layout-block data-selected={scope === "Zone" && currentPath?.zone === zone.id} style={compact ? undefined : positionStyle(block)} aria-label={`Zone ${zone.id}`}>
                    <div className={styles.zoneHeading}>
                      <button onClick={() => setSelection({ path: zonePath })}><strong>Zone {zone.id}</strong><small>{zoneStats.occupied}/{zoneStats.capacity} occupied{zoneStats.excess > 0 && " · Over capacity"}</small></button>
                    </div>
                    <div className={styles.zoneInterior}>
                      {racks.map(({ rack, block: rackBlock }) => {
                        const rackPath = { ...zonePath, rack: rack.id };
                        const rackStats = occupancyIndex.group(warehouse, rackPath);
                        return <article key={rack.id} className={styles.rackBlock} data-layout-block data-selected={scope === "Rack" && currentPath?.zone === zone.id && currentPath.rack === rack.id}
                          style={compact ? undefined : positionStyle(rackBlock)} aria-label={`Rack ${rack.id}`}>
                          <div className={styles.rackHeading}>
                            <button onClick={() => setSelection({ path: rackPath })}><strong>Rack {rack.id}</strong><small>{rackStats.occupied}/{rackStats.capacity} occupied{rackStats.excess > 0 && " · Over capacity"}</small></button>
                          </div>
                          <div className={styles.sections}>
                            {rack.sections.some((section) => section.rowGroups.length) ? rack.sections.map((section) => {
                              const sectionPath = { ...rackPath, section: section.id };
                              return <div className={styles.sectionBlock} key={section.id}>
                                {section.rowGroups.map(({ number: row, name, units }) => {
                                  const path = { ...sectionPath, row };
                                  const reference = layoutReference(path);
                                  const rowStats = occupancyIndex.group(warehouse, path);
                                  const rowPlacements = pending ? units.map((unit) => placementByLocation.get(unit.id)).filter((evaluation): evaluation is PlacementEvaluation => Boolean(evaluation)) : [];
                                  const rowPlacement = rowPlacements.find((evaluation) => evaluation.tier === "best") || rowPlacements.find((evaluation) => evaluation.tier === "compatible") || rowPlacements.find((evaluation) => evaluation.tier === "partial") || rowPlacements[0];
                                  return <div key={row} role="group" aria-label={`Storage row ${reference}`} className={styles.rowStrip} id={reference} data-tone={storageTone(rowStats)}>
                                    <button className={styles.rowButton} aria-pressed={scope === "Row" && currentPath && layoutReference(currentPath) === layoutReference(path)}
                                      data-placement={rowPlacement?.tier} title={pending && rowPlacement ? `${reference}: ${rowPlacement.reason}${rowPlacement.warning ? ` · ${rowPlacement.warning}` : ""}` : reference} onClick={() => setSelection({ path })}><strong>{name}</strong>
                                      {rowStats.excess > 0 && <small>Over capacity</small>}
                                    </button>
                                    <div className={styles.unitStrip}>
                                      {units.map((unit) => {
                                        const position = locationPosition(unit);
                                        const unitStats = occupancyIndex.unit(unit.id);
                                        const placement = pending ? placementByLocation.get(unit.id) : undefined;
                                        return <button key={unit.id} className={styles.unitChip} data-tone={storageTone(unitStats)}
                                          data-placement={placement?.tier} aria-pressed={selectedUnit?.id === unit.id} data-muted={!pending && !matchesProduct(unit)} title={pending && placement ? `${unit.id}: ${placement.reason}${placement.warning ? ` · ${placement.warning}` : ""}` : unit.id} onClick={() => setSelection({ path, unit: unit.id })}>R{row}C{position.column}{position.shelf > 1 ? `/${position.shelf}` : ""}</button>;
                                      })}
                                      {!units.length && <small className={styles.emptyRow}>Empty row</small>}
                                    </div>
                                  </div>;
                                })}
                              </div>;
                            }) : <p className={styles.emptyRow}>No rows in this rack.</p>}
                          </div>
                        </article>;
                      })}
                      {!racks.length && <p className={styles.emptyRow}>Add a rack to this zone.</p>}
                    </div>
                  </section>;
                })}
              </div>
            </div>
          </div> : <div className={styles.empty}><MapPin size={28} /><strong>{warehouse ? "No zones in this warehouse" : "No warehouses configured"}</strong>
          </div>}
        </div>
        <aside className={styles.detail} aria-label="Layout inspector">
          <div className={styles.detailHeader}><h3><span className={styles.inspectorIcon}><Boxes size={18} aria-hidden="true" /></span>{currentName}</h3>{selection && <button aria-label="Clear selection" onClick={() => setSelection(null)}><X size={17} /></button>}</div>
          <nav className={styles.breadcrumb} aria-label="Storage location path">
            <button onClick={() => setSelection(null)}>{warehouseName}</button>
            {currentPath && <button onClick={() => setSelection({ path: { warehouse, zone: currentPath.zone } })}>{currentPath.zone}</button>}
            {currentPath?.rack && <button onClick={() => setSelection({ path: { warehouse, zone: currentPath.zone, rack: currentPath.rack } })}>{currentPath.rack}</button>}
            {currentPath?.section && <button onClick={() => setSelection({ path: { ...currentPath, row: undefined } })}>{currentPath.section}</button>}
            {currentPath?.row !== undefined && <button onClick={() => setSelection({ path: currentPath })}>{selectedRow?.name ?? `Row ${currentPath.row}`}</button>}
          </nav>
          <div className={styles.stats}>
            <div className={styles.ring} data-over={summary.excess > 0} style={{ "--occupancy": `${Math.min(100, occupancy)}%` } as CSSProperties}><span><strong>{occupancy}%</strong><small>occupied</small></span></div>
            <dl>
              <dt>Total capacity</dt><dd>{formatQuantity(summary.capacity)}</dd>
              <dt>Occupied</dt><dd>{formatQuantity(summary.occupied)}</dd>
              <dt>Available</dt><dd className={styles.availableValue}>{formatQuantity(summary.available)}</dd>
              {!selectedUnit && <><dt>Quarantine units</dt><dd>{formatQuantity(warehouseCapacity.quarantine)}</dd></>}
            </dl>
          </div>
          {summary.excess > 0 && <p className={styles.capacityAlert} role="alert">
            Capacity exceeded in {selectedUnit ? "this unit" : "one or more storage units"}. Move or reconcile {summary.excess} excess {summary.excess === 1 ? "unit" : "units"}, or increase capacity.
          </p>}
          {currentPath && <div className={styles.detailSection}>
            <h4>{scope} details</h4><p className={styles.reference}>{selectedUnit?.id || layoutReference(currentPath)}</p>
            {selectedUnit?.assignedProduct && <p>Assigned to {names.get(selectedUnit.assignedProduct) || selectedUnit.assignedProduct}</p>}
            {selectedSection && scope === "Section" && <p>{selectedSection.rows} rows &middot; {selectedSection.columns} columns</p>}
            {pending && selectedUnit && selectedEvaluation && <p>{selectedEvaluation.reason}{selectedEvaluation.warning ? ` · ${selectedEvaluation.warning}` : ""}</p>}
            {pending && currentPath.row !== undefined && !selectedUnit && !rowFree ?
              <p>No compatible capacity in this row</p> : null}
            {pending && currentPath.row !== undefined && (selectedUnit ? !placementIssue : rowFree > 0) &&
              <button className="primary-button" onClick={place}>{selectedUnit ? "Place in this unit" : "Place in this row"}</button>}
            {managing && (scope === "Zone" || scope === "Rack" || currentPath.row !== undefined) && <div className={styles.controls}>
              {(scope === "Zone" || scope === "Rack") && summary.occupied > 0 &&
                <p className={styles.actionHint}>Move stored stock before removing this {scope.toLowerCase()}.</p>}
              {(scope === "Zone" || scope === "Rack") && <button className="secondary-button danger-button"
                disabled={members.some((unit) => hasStoredStock(state, unit))} onClick={() => void remove()}>Remove {scope.toLowerCase()}</button>}
              {currentPath.row !== undefined && <button className="secondary-button danger-button"
                disabled={rowUnits.some((unit) => hasStoredStock(state, unit))} onClick={() => void remove("row")}>Remove row</button>}
              {selectedColumn !== undefined && <button className="secondary-button danger-button"
                disabled={columnUnits.some((unit) => hasStoredStock(state, unit))} onClick={() => void remove("column")}>Remove column</button>}
            </div>}
          </div>}
          <div className={styles.detailSection}><h4>Stored products</h4>
            {stock.length ? <ul className={styles.stockList}>{[...totals].map(([sku, total]) => <li key={sku} className={styles.productCard}>
              <div className={styles.productHeading}>
                <Package size={16} aria-hidden="true" />
                <div><strong>{names.get(sku) || sku}</strong><small>SKU {sku}</small></div>
                <span className={styles.stockQuantity}>{formatQuantity(total)} units</span>
              </div>
              <ul className={styles.batchList}>{stock.filter((lot) => lot.product === sku).map((lot) => {
                const compliance = evaluateProductCompliance(state, lot);
                return <li key={lot.id}>
                  <div className={styles.batchHeading}>
                    <strong>{formatQuantity(lot.qty)} units</strong>
                    {lot.reserved > 0 && <span>{formatQuantity(lot.reserved)} reserved</span>}
                  </div>
                  <dl>
                    {lot.batch && <><dt>Batch</dt><dd>{lot.batch}</dd></>}
                    {lot.expiry && <><dt>Expiry</dt><dd>{lot.expiry}</dd></>}
                    <dt>Expected Zone</dt><dd>Zone {compliance.expectedZone || "—"}</dd>
                    <dt>Actual Zone</dt><dd>Zone {compliance.actualZone || "—"}</dd>
                    <dt>Compliance</dt>
                    <dd>
                      <span className={styles.complianceBadge} data-compliance={compliance.compliance}>
                        {compliance.compliance}
                      </span>
                    </dd>
                  </dl>
                  {compliance.compliance === "Zone Mismatch" && (
                    <div className={styles.mismatchAlert} role="alert">
                      ⚠️ Zone Mismatch: Belongs in Zone {compliance.expectedZone}, currently stored in Zone {compliance.actualZone}.
                    </div>
                  )}
                  {compliance.compliance === "Storage Compatibility Issue" && (
                    <div className={styles.issueAlert} role="alert">
                      ⚠️ Storage Issue: {compliance.issueDetail}
                    </div>
                  )}
                  {lot.expiry < today() && lot.qty > 0 && can(role, "quarantine") && (
                    <button className="row-link" onClick={() => {
                      if (window.confirm(`Move lot ${lot.id} (${lot.qty} units) to quarantine?`))
                        void action({ type: "quarantineLot", lot: lot.id });
                    }}>Move to quarantine</button>
                  )}
                </li>;
              })}</ul>
            </li>)}</ul> : <p className={styles.stockEmpty}>No stock stored here.</p>}
          </div>
        </aside>
      </div>

      <details className={styles.migrationPanel}>
        <summary className={styles.migrationSummary}>
          <AlertTriangle size={15} /> Location Compliance &amp; Migration Report
          {migrationReport.length > 0 ? ` (${migrationReport.length} mismatches found)` : " (All Compliant)"}
        </summary>
        <div className={styles.migrationBody}>
          <p className={styles.migrationNote}>
            This reviewable report highlights stored inventory lots that do not conform to the alphabetical product-to-zone allocation rule or have storage compatibility issues. Existing inventory is not automatically relocated; any physical movement must be confirmed via the standard stock movement workflow.
          </p>
          {migrationReport.length ? (
            <div className={styles.migrationTableWrap}>
              <table className={styles.migrationTable}>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Current Zone</th>
                    <th>Expected Zone</th>
                    <th>Location</th>
                    <th>Quantity</th>
                    <th>Batch</th>
                    <th>Expiry</th>
                    <th>Compliance</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {migrationReport.map(({ lot, productName, currentZone, expectedZone, locationDesc, qty, batch, expiry, compliance }) => (
                    <tr key={lot.id}>
                      <td><strong>{productName}</strong><br /><small>{lot.product}</small></td>
                      <td>Zone {currentZone}</td>
                      <td><strong>Zone {expectedZone}</strong></td>
                      <td>{locationDesc}</td>
                      <td>{formatQuantity(qty)}</td>
                      <td>{batch || "—"}</td>
                      <td>{expiry || "—"}</td>
                      <td>
                        <span className={styles.complianceBadge} data-compliance={compliance}>
                          {compliance}
                        </span>
                      </td>
                      <td>
                        {can(role, "move") && (
                          <button className={styles.relocateBtn} onClick={() => initiateStockRelocation(lot)}>
                            Relocate stock
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.migrationEmpty}>
              ✓ All stored products in this warehouse match their expected alphabetical zones.
            </div>
          )}
        </div>
      </details>

      <details className={styles.directory}>
        <summary>Product locations A–Z</summary>
        <div className={styles.directoryFilters}>
          <label>
            Filter by zone:
            <select value={azZoneFilter} onChange={(e) => setAzZoneFilter(e.target.value)}>
              <option value="">All zones</option>
              {zones.map((zone) => <option key={zone.id} value={zone.id}>Zone {zone.id}</option>)}
            </select>
          </label>
          <label>
            Compliance status:
            <select value={azMismatchFilter} onChange={(e) => setAzMismatchFilter(e.target.value as "all" | "mismatch" | "correct")}>
              <option value="all">All statuses</option>
              <option value="mismatch">Zone mismatches only</option>
              <option value="correct">Correct locations only</option>
            </select>
          </label>
        </div>
        {directoryAlphabeticalGroups.length ? (
          directoryAlphabeticalGroups.map(([letter, groupItems]) => (
            <div key={letter} className={styles.directoryGroup}>
              <div className={styles.directoryGroupTitle}>Group {letter}</div>
              <ul className={styles.directoryList}>
                {groupItems.map(({ product, expected, units }) => (
                  <li key={product.id} className={styles.directoryItem}>
                    <div className={styles.directoryItemHeading}>
                      <div>
                        <strong>{product.name}</strong> <small>SKU: {product.id}</small>
                      </div>
                      <span className={styles.stockQuantity}>
                        Expected: Zone {expected || "—"}
                      </span>
                    </div>
                    <div className={styles.directoryLocations}>
                      {units.map(({ unit, actualZone, rack, row, column, isMatch }) => (
                        <button
                          key={unit.id}
                          className={`${styles.directoryLocationChip} ${isMatch ? styles.badgeCorrect : styles.badgeMismatch}`}
                          onClick={() => chooseUnit(unit)}
                          title={`Go to ${unit.id}: Rack ${rack}, Row ${row}, Col ${column} (Zone ${actualZone})`}
                        >
                          <span>{isMatch ? "✓" : "⚠️"} {unit.id} (Zone {actualZone} &middot; R{row}C{column})</span>
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p className={styles.filterEmpty}>No products match the selected A–Z filters.</p>
        )}
      </details>
    </section>
    <IncomingPlacement state={state} role={role} warehouseScope={warehouseScope} onPlace={(lot) => { setSelection(null); setPendingId(lot.id); }} />
  </div>;
}
