"use client";

import { useMemo, useState, useEffect, type ReactNode } from "react";
import {
  Calendar,
  CheckSquare,
  Square,
  ArrowUpDown,
  Layers,
  Package,
  MapPin,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Boxes,
  Truck,
  CheckCircle2,
  FileText,
  UserCheck,
} from "lucide-react";
import type { State, Order, Command, Role } from "@/lib/wms";
import { lotWarehouse, today } from "@/lib/wms";
import styles from "./picking-packing-workflow.module.css";

export type PublicState = Omit<State, "users"> & {
  users: Omit<State["users"][number], "password">[];
};

export type Session = { id: string; name: string; role: Role };

export type Field = {
  key: string;
  label: string;
  options?: { value: string; label: string }[];
  kind?: string;
  value?: string;
  optional?: boolean;
  hint?: string;
};

export interface PickingPackingWorkflowProps {
  state: PublicState;
  user: Session;
  warehouseScope: string;
  action: (
    command: Command,
    finish?: boolean,
    onFailure?: (err: string) => void,
    onSuccess?: (res: { detail?: string }) => void
  ) => Promise<boolean>;
  open: (
    title: string,
    type: string,
    fields: Field[],
    extra?: Record<string, unknown>
  ) => void;
  setDocumentOrder: (order: Order | null) => void;
  orderOptions: (statuses: string[]) => { value: string; label: string }[];
  qtyField: Field;
  reasonField: Field;
  button: (label: string, type: string, fn: () => void) => ReactNode;
}

export type SortCriterion = "date" | "product" | "both";
export type SortDirection = "asc" | "desc";
export type CombinedPriority = "date-first" | "product-first";

export interface ContributingOrderLine {
  orderId: string;
  customer: string;
  orderDate: string;
  requiredQty: number;
  pickedQty: number;
  packedQty: number;
  status: string;
  assignee: string;
  warehouse: string;
  order: Order;
}

export interface StorageLocationAllocation {
  lotId: string;
  zone: string;
  rack: string;
  bin: string;
  batch: string;
  expiry: string;
  allocatedQty: number;
  isExpired: boolean;
  warehouse: string;
}

export interface ConsolidatedPickItem {
  productId: string;
  sku: string;
  productName: string;
  barcode: string;
  totalRequired: number;
  totalPicked: number;
  remaining: number;
  earliestOrderDate: string;
  warehouse: string;
  locations: StorageLocationAllocation[];
  contributingOrders: ContributingOrderLine[];
  hasShortage: boolean;
  shortageReason?: string;
}

export default function PickingPackingWorkflow({
  state: s,
  user,
  warehouseScope,
  action,
  open,
  setDocumentOrder,
  orderOptions,
  qtyField,
  reasonField,
  button,
}: PickingPackingWorkflowProps) {
  // Sorting options
  const [sortCriterion, setSortCriterion] = useState<SortCriterion>("both");
  const [dateDirection, setDateDirection] = useState<SortDirection>("asc"); // Oldest first
  const [productDirection, setProductDirection] = useState<SortDirection>("asc"); // A-Z
  const [combinedPriority, setCombinedPriority] =
    useState<CombinedPriority>("date-first");

  // Selection state
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    new Set()
  );

  // Accordion state for consolidated items
  const [expandedSkus, setExpandedSkus] = useState<Set<string>>(new Set());

  // Products map for O(1) lookups
  const productMap = useMemo(() => {
    const map = new Map<string, (typeof s.products)[number]>();
    for (const p of s.products) {
      map.set(p.id, p);
    }
    return map;
  }, [s.products]);

  // Warehouse lookup
  const warehouseMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of s.warehouses) {
      map.set(w.id, w.name);
    }
    return map;
  }, [s.warehouses]);

  // Helper: test if lot is in current warehouse scope
  const isLotInScope = (lot: (typeof s.lots)[number]) =>
    warehouseScope === "ALL" || lotWarehouse(s, lot) === warehouseScope;

  // Helper: test if order belongs to current warehouse scope
  const isOrderInScope = (order: Order) => {
    if (warehouseScope === "ALL") return true;
    if (order.warehouse) return order.warehouse === warehouseScope;
    return order.allocations.some((allocation) => {
      const lot = s.lots.find((item) => item.id === allocation.lot);
      return lot ? isLotInScope(lot) : false;
    });
  };

  // Eligible pending orders for picking: status Reserved or Picking, in warehouse scope, not Cancelled/Dispatched/Packed
  const eligiblePendingOrders = useMemo(() => {
    return s.orders.filter(
      (o) =>
        ["Reserved", "Picking"].includes(o.status) &&
        !["Cancelled", "Dispatched", "Packed"].includes(o.status) &&
        isOrderInScope(o)
    );
  }, [s.orders, warehouseScope]);

  // Default selection: select all eligible pending orders when list changes
  useEffect(() => {
    const nextSelected = new Set<string>();
    for (const o of eligiblePendingOrders) {
      nextSelected.add(o.id);
    }
    setSelectedOrderIds(nextSelected);
  }, [eligiblePendingOrders]);

  // Multi-criteria sorting function for orders
  const sortOrders = useMemo(() => {
    return (orders: Order[]): Order[] => {
      return [...orders].sort((a, b) => {
        // Date comparison
        const dateA = a.createdAt || "";
        const dateB = b.createdAt || "";
        let dateCmp = dateA.localeCompare(dateB);
        if (dateDirection === "desc") dateCmp = -dateCmp;

        // Product comparison (using primary product name or first line item)
        const prodIdA = a.lines?.[0]?.product || a.product || "";
        const prodIdB = b.lines?.[0]?.product || b.product || "";
        const nameA = productMap.get(prodIdA)?.name || prodIdA;
        const nameB = productMap.get(prodIdB)?.name || prodIdB;
        let prodCmp = nameA.localeCompare(nameB, undefined, {
          sensitivity: "base",
          numeric: true,
        });
        if (productDirection === "desc") prodCmp = -prodCmp;

        if (sortCriterion === "date") return dateCmp;
        if (sortCriterion === "product") return prodCmp;

        // Both: tie breaking
        if (combinedPriority === "date-first") {
          return dateCmp !== 0 ? dateCmp : prodCmp;
        } else {
          return prodCmp !== 0 ? prodCmp : dateCmp;
        }
      });
    };
  }, [sortCriterion, dateDirection, productDirection, combinedPriority, productMap]);

  // Sorted eligible orders
  const sortedEligibleOrders = useMemo(() => {
    return sortOrders(eligiblePendingOrders);
  }, [eligiblePendingOrders, sortOrders]);

  // Selection handlers
  const handleSelectAll = () => {
    const next = new Set<string>();
    for (const o of eligiblePendingOrders) {
      next.add(o.id);
    }
    setSelectedOrderIds(next);
  };

  const handleDeselectAll = () => {
    setSelectedOrderIds(new Set());
  };

  const toggleOrderSelection = (orderId: string) => {
    const next = new Set(selectedOrderIds);
    if (next.has(orderId)) {
      next.delete(orderId);
    } else {
      next.add(orderId);
    }
    setSelectedOrderIds(next);
  };

  const toggleSkuExpanded = (sku: string) => {
    const next = new Set(expandedSkus);
    if (next.has(sku)) {
      next.delete(sku);
    } else {
      next.add(sku);
    }
    setExpandedSkus(next);
  };

  // Build Consolidated Picking List from selected orders
  const consolidatedPickingList = useMemo((): ConsolidatedPickItem[] => {
    const selectedOrders = eligiblePendingOrders.filter((o) =>
      selectedOrderIds.has(o.id)
    );

    const skuMap = new Map<
      string,
      {
        productId: string;
        productName: string;
        barcode: string;
        totalRequired: number;
        totalPicked: number;
        contributingOrders: ContributingOrderLine[];
        locationsMap: Map<string, StorageLocationAllocation>;
        earliestOrderDate: string;
      }
    >();

    for (const order of selectedOrders) {
      const orderDate = order.createdAt || "";
      const lines = order.lines?.length
        ? order.lines
        : [{ product: order.product, qty: order.qty, picked: order.picked || 0, packed: 0 }];

      for (const line of lines) {
        const sku = line.product;
        const prod = productMap.get(sku);
        const prodName = prod?.name || sku;
        const barcode = prod?.barcode || "";

        let entry = skuMap.get(sku);
        if (!entry) {
          entry = {
            productId: sku,
            productName: prodName,
            barcode,
            totalRequired: 0,
            totalPicked: 0,
            contributingOrders: [],
            locationsMap: new Map(),
            earliestOrderDate: orderDate,
          };
          skuMap.set(sku, entry);
        }

        entry.totalRequired += line.qty;
        entry.totalPicked += line.picked || 0;
        if (!entry.earliestOrderDate || (orderDate && orderDate < entry.earliestOrderDate)) {
          entry.earliestOrderDate = orderDate;
        }

        entry.contributingOrders.push({
          orderId: order.id,
          customer: order.customer,
          orderDate,
          requiredQty: line.qty,
          pickedQty: line.picked || 0,
          packedQty: line.packed || 0,
          status: order.status,
          assignee: order.assignee || "Unassigned",
          warehouse: order.warehouse || "",
          order,
        });

        // Resolve storage locations from order allocations for this line
        const lineAllocations = (order.allocations || []).filter(
          (a) => a.product === sku
        );

        for (const alloc of lineAllocations) {
          const lot = s.lots.find((l) => l.id === alloc.lot);
          if (!lot) continue;
          const loc = s.locations.find((l) => l.id === lot.location);
          const locWarehouseId = lotWarehouse(s, lot);
          const zone = loc?.zone || "Unassigned";
          const rack = loc?.rack || "";
          const bin = loc ? loc.section || `R${loc.row}C${loc.column}` : lot.location;
          const isExpired = lot.expiry < today();

          const key = `${lot.id}-${lot.location}`;
          const existingLoc = entry.locationsMap.get(key);
          if (existingLoc) {
            existingLoc.allocatedQty += alloc.qty;
          } else {
            entry.locationsMap.set(key, {
              lotId: lot.id,
              zone,
              rack,
              bin,
              batch: lot.batch,
              expiry: lot.expiry,
              allocatedQty: alloc.qty,
              isExpired,
              warehouse: locWarehouseId || "",
            });
          }
        }
      }
    }

    // Convert map to array and evaluate shortages
    const items: ConsolidatedPickItem[] = [];

    for (const [sku, data] of skuMap.entries()) {
      const locations = Array.from(data.locationsMap.values());
      const remaining = Math.max(0, data.totalRequired - data.totalPicked);

      // Check physical stock shortage: sum physical qty across lots for this SKU in warehouse
      const matchingLots = s.lots.filter(
        (l) => l.product === sku && isLotInScope(l) && l.expiry >= today()
      );
      const totalPhysicalInScope = matchingLots.reduce(
        (sum, l) => sum + l.qty,
        0
      );

      const hasExpiredAllocations = locations.some((l) => l.isExpired);
      const hasInsufficientStock = remaining > totalPhysicalInScope;
      const hasShortage = hasExpiredAllocations || hasInsufficientStock;

      let shortageReason: string | undefined;
      if (hasExpiredAllocations) {
        shortageReason = "Allocated batch has expired. Requires re-reservation.";
      } else if (hasInsufficientStock) {
        shortageReason = `Physical stock shortage: ${remaining} required, but only ${totalPhysicalInScope} available.`;
      }

      items.push({
        productId: sku,
        sku,
        productName: data.productName,
        barcode: data.barcode,
        totalRequired: data.totalRequired,
        totalPicked: data.totalPicked,
        remaining,
        earliestOrderDate: data.earliestOrderDate,
        warehouse: warehouseScope === "ALL" ? "All Warehouses" : (warehouseMap.get(warehouseScope) || warehouseScope),
        locations,
        contributingOrders: data.contributingOrders,
        hasShortage,
        shortageReason,
      });
    }

    // Sort consolidated items using the same multi-criteria sorting rules
    return items.sort((a, b) => {
      const dateA = a.earliestOrderDate || "";
      const dateB = b.earliestOrderDate || "";
      let dateCmp = dateA.localeCompare(dateB);
      if (dateDirection === "desc") dateCmp = -dateCmp;

      let prodCmp = a.productName.localeCompare(b.productName, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (productDirection === "desc") prodCmp = -prodCmp;

      if (sortCriterion === "date") return dateCmp;
      if (sortCriterion === "product") return prodCmp;

      if (combinedPriority === "date-first") {
        return dateCmp !== 0 ? dateCmp : prodCmp;
      } else {
        return prodCmp !== 0 ? prodCmp : dateCmp;
      }
    });
  }, [
    eligiblePendingOrders,
    selectedOrderIds,
    productMap,
    warehouseMap,
    warehouseScope,
    s.lots,
    s.locations,
    sortCriterion,
    dateDirection,
    productDirection,
    combinedPriority,
  ]);

  // Orders for the Packing Station: Picked, Picking, Packing, Packed
  const packingOrders = useMemo(() => {
    return s.orders
      .filter((o) => {
        if (!isOrderInScope(o)) return false;
        if (["Cancelled", "Dispatched"].includes(o.status)) return false;
        // Include orders where picking has started or finished, or ready to pack
        return ["Picked", "Picking", "Packing", "Packed"].includes(o.status);
      })
      .sort((a, b) => {
        // Show Picked / Ready to pack first, then Packing, then Picking
        const statusScore = (st: string) => {
          if (st === "Picked") return 1;
          if (st === "Packing") return 2;
          if (st === "Picking") return 3;
          return 4;
        };
        return statusScore(a.status) - statusScore(b.status);
      });
  }, [s.orders, warehouseScope]);

  // Pick action helper
  const handlePickOrderLine = (
    order: Order,
    sku: string,
    remainingQty: number
  ) => {
    const prod = productMap.get(sku);
    open("Confirm picked quantity", "pick", [
      {
        key: "order",
        label: "Order",
        options: orderOptions(["Reserved", "Picking"]),
        value: order.id,
      },
      {
        key: "productBarcode",
        label: "Product barcode",
        value: prod?.barcode || "",
      },
      {
        ...qtyField,
        label: "Actual picked quantity (0 for unavailable)",
        value: String(remainingQty),
      },
      { key: "reason", label: "Short-pick reason", optional: true },
    ]);
  };

  // Pack action helper
  const handlePackOrder = (order: Order) => {
    const firstLine = order.lines?.[0];
    const prod = firstLine ? productMap.get(firstLine.product) : undefined;
    open("Verify and pack", "pack", [
      {
        key: "order",
        label: "Picked order",
        options: orderOptions(["Picking", "Picked"]),
        value: order.id,
      },
      {
        key: "productBarcode",
        label: "Product barcode",
        value: prod?.barcode || "",
      },
      {
        ...qtyField,
        label: "Verified packed quantity",
        value: String(firstLine?.picked || order.picked),
      },
      { key: "material", label: "Packaging material", value: "Standard Corrugated Box" },
      { key: "dimensions", label: "Dimensions (L × W × H in cm)", value: "30 × 20 × 15" },
      { key: "weight", label: "Weight in kg", kind: "decimal", value: "1.5" },
    ]);
  };

  return (
    <div className={styles.workflowContainer}>
      {/* 1. User-Controlled Sorting & Selection Toolbar */}
      <div className={styles.toolbarCard}>
        <div className={styles.toolbarHeader}>
          <div className={styles.toolbarTitle}>
            <ArrowUpDown size={18} />
            <span>Pickup & Packing Controls</span>
          </div>

          <div className={styles.selectionControls}>
            <span className={styles.selectionBadge}>
              {selectedOrderIds.size} of {eligiblePendingOrders.length} orders
              selected
            </span>
            <button
              type="button"
              className={styles.btnSmall}
              onClick={handleSelectAll}
              title="Select all eligible orders"
            >
              Select All
            </button>
            <button
              type="button"
              className={styles.btnSmall}
              onClick={handleDeselectAll}
              title="Clear order selection"
            >
              Deselect All
            </button>
          </div>
        </div>

        <div className={styles.controlsRow}>
          {/* Primary Criterion */}
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>Sort by:</span>
            <div className={styles.btnGroup}>
              <button
                type="button"
                className={`${styles.btnGroupItem} ${
                  sortCriterion === "date" ? styles.btnGroupItemActive : ""
                }`}
                onClick={() => setSortCriterion("date")}
              >
                Date
              </button>
              <button
                type="button"
                className={`${styles.btnGroupItem} ${
                  sortCriterion === "product" ? styles.btnGroupItemActive : ""
                }`}
                onClick={() => setSortCriterion("product")}
              >
                Product
              </button>
              <button
                type="button"
                className={`${styles.btnGroupItem} ${
                  sortCriterion === "both" ? styles.btnGroupItemActive : ""
                }`}
                onClick={() => setSortCriterion("both")}
              >
                Both
              </button>
            </div>
          </div>

          {/* Date Direction */}
          {(sortCriterion === "date" || sortCriterion === "both") && (
            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>Date order:</span>
              <div className={styles.btnGroup}>
                <button
                  type="button"
                  className={`${styles.btnGroupItem} ${
                    dateDirection === "asc" ? styles.btnGroupItemActive : ""
                  }`}
                  onClick={() => setDateDirection("asc")}
                  title="Oldest orders first"
                >
                  Oldest → Newest
                </button>
                <button
                  type="button"
                  className={`${styles.btnGroupItem} ${
                    dateDirection === "desc" ? styles.btnGroupItemActive : ""
                  }`}
                  onClick={() => setDateDirection("desc")}
                  title="Newest orders first"
                >
                  Newest → Oldest
                </button>
              </div>
            </div>
          )}

          {/* Product Direction */}
          {(sortCriterion === "product" || sortCriterion === "both") && (
            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>Product order:</span>
              <div className={styles.btnGroup}>
                <button
                  type="button"
                  className={`${styles.btnGroupItem} ${
                    productDirection === "asc" ? styles.btnGroupItemActive : ""
                  }`}
                  onClick={() => setProductDirection("asc")}
                  title="Alphabetical A to Z"
                >
                  A → Z
                </button>
                <button
                  type="button"
                  className={`${styles.btnGroupItem} ${
                    productDirection === "desc" ? styles.btnGroupItemActive : ""
                  }`}
                  onClick={() => setProductDirection("desc")}
                  title="Reverse alphabetical Z to A"
                >
                  Z → A
                </button>
              </div>
            </div>
          )}

          {/* Combined Priority */}
          {sortCriterion === "both" && (
            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>Priority:</span>
              <div className={styles.btnGroup}>
                <button
                  type="button"
                  className={`${styles.btnGroupItem} ${
                    combinedPriority === "date-first"
                      ? styles.btnGroupItemActive
                      : ""
                  }`}
                  onClick={() => setCombinedPriority("date-first")}
                  title="Sort by date first, then product alphabetically"
                >
                  Date first, then Product
                </button>
                <button
                  type="button"
                  className={`${styles.btnGroupItem} ${
                    combinedPriority === "product-first"
                      ? styles.btnGroupItemActive
                      : ""
                  }`}
                  onClick={() => setCombinedPriority("product-first")}
                  title="Sort by product first, then date chronologically"
                >
                  Product first, then Date
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Eligible Customer Orders Table */}
      <section className="panel wms-panel">
        <div className="panel-heading">
          <div>
            <h2>Eligible Customer Orders</h2>
            <p>
              Select orders to include in the consolidated picking list. All
              eligible pending orders are selected by default.
            </p>
          </div>
          <div className="inline-actions">
            {button("Assign task", "assign", () =>
              open("Assign picking task", "assign", [
                {
                  key: "order",
                  label: "Order",
                  options: orderOptions(["Reserved", "Picking"]),
                },
                {
                  key: "assignee",
                  label: "Warehouse staff",
                  options: s.users
                    .filter((u) => u.active && u.role !== "Viewer")
                    .map((u) => ({ value: u.id, label: u.name })),
                },
              ])
            )}
            {button("Confirm pick", "pick", () =>
              open("Confirm picked quantity", "pick", [
                {
                  key: "order",
                  label: "Order",
                  options: orderOptions(["Reserved", "Picking"]),
                },
                { key: "productBarcode", label: "Product barcode" },
                {
                  ...qtyField,
                  label: "Actual picked quantity (0 for unavailable)",
                },
                { key: "reason", label: "Short-pick reason", optional: true },
              ])
            )}
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: "40px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    className={styles.checkboxInput}
                    checked={
                      eligiblePendingOrders.length > 0 &&
                      selectedOrderIds.size === eligiblePendingOrders.length
                    }
                    onChange={(e) => {
                      if (e.target.checked) handleSelectAll();
                      else handleDeselectAll();
                    }}
                    title="Toggle all orders"
                  />
                </th>
                <th>Order / Customer</th>
                <th>Order Date</th>
                <th>Warehouse</th>
                <th>Product Lines & SKUs</th>
                <th>Ordered / Picked</th>
                <th>Status</th>
                <th>Picker</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedEligibleOrders.length ? (
                sortedEligibleOrders.map((o) => {
                  const isSelected = selectedOrderIds.has(o.id);
                  const lines = o.lines?.length
                    ? o.lines
                    : [{ product: o.product, qty: o.qty, picked: o.picked || 0, packed: 0 }];

                  return (
                    <tr
                      key={o.id}
                      style={{
                        background: isSelected ? "#f8fbff" : "transparent",
                      }}
                    >
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          className={styles.checkboxInput}
                          checked={isSelected}
                          onChange={() => toggleOrderSelection(o.id)}
                        />
                      </td>
                      <td>
                        <strong>{o.id}</strong>
                        <br />
                        <span style={{ color: "#475569", fontSize: "0.85rem" }}>
                          {o.customer}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: "0.82rem",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.3rem",
                            color: "#475569",
                          }}
                        >
                          <Calendar size={13} />
                          {o.createdAt || "N/A"}
                        </span>
                      </td>
                      <td>
                        {o.warehouse
                          ? warehouseMap.get(o.warehouse) || o.warehouse
                          : "Default"}
                      </td>
                      <td>
                        <div className={styles.orderLinesList}>
                          {lines.map((l, idx) => {
                            const p = productMap.get(l.product);
                            return (
                              <div key={idx} className={styles.orderLineItem}>
                                <strong>{p?.name || l.product}</strong>
                                <span className={styles.productSku}>
                                  ({l.product})
                                </span>
                                <span className={styles.orderLineQty}>
                                  Qty: {l.qty} (Picked: {l.picked || 0})
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td>
                        <strong>
                          {o.qty} / {o.picked || 0}
                        </strong>
                      </td>
                      <td>
                        <span
                          className={`status ${
                            o.status === "Picked"
                              ? "healthy"
                              : o.status === "Short picked"
                              ? "critical"
                              : "low-stock"
                          }`}
                        >
                          {o.status}
                        </span>
                      </td>
                      <td>{o.assignee || "Unassigned"}</td>
                      <td>
                        <div className="inline-actions">
                          <button
                            type="button"
                            className="row-link"
                            onClick={() => setDocumentOrder(o)}
                          >
                            Docs
                          </button>
                          {["Reserved", "Picking"].includes(o.status) && (
                            <button
                              type="button"
                              className="row-link"
                              onClick={() => {
                                const lineToPick =
                                  lines.find((l) => (l.picked || 0) < l.qty) ||
                                  lines[0];
                                handlePickOrderLine(
                                  o,
                                  lineToPick.product,
                                  lineToPick.qty - (lineToPick.picked || 0)
                                );
                              }}
                            >
                              Pick
                            </button>
                          )}
                          {["Reserved", "Picked"].includes(o.status) &&
                            button("Cancel", "cancel", () =>
                              open(
                                "Cancel and release reservation",
                                "cancel",
                                [reasonField],
                                { order: o.id }
                              )
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="empty-state">
                    No eligible pending orders found for picking in the selected
                    warehouse scope.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Consolidated Pickup List */}
      <section className="panel wms-panel">
        <div className="panel-heading">
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Boxes size={20} />
              <span>Consolidated Pickup List</span>
            </h2>
            <p>
              Quantities aggregated strictly by SKU from {selectedOrderIds.size}{" "}
              selected customer orders. Preserves alphabetical zone, rack, bin,
              batch, and order-line traceability.
            </p>
          </div>
        </div>

        {consolidatedPickingList.length > 0 ? (
          <div className={styles.consolidatedGrid}>
            {consolidatedPickingList.map((item) => {
              const isExpanded = expandedSkus.has(item.sku);
              const isFullyPicked = item.remaining === 0;

              return (
                <div
                  key={item.sku}
                  className={`${styles.consolidatedCard} ${
                    item.hasShortage ? styles.consolidatedCardShortage : ""
                  }`}
                >
                  <div className={styles.cardHeader}>
                    <div className={styles.productIdentity}>
                      <div className={styles.productName}>
                        {item.productName}
                      </div>
                      <div className={styles.productSku}>
                        SKU: <strong>{item.sku}</strong> · Barcode:{" "}
                        {item.barcode || "N/A"} · Warehouse: {item.warehouse}
                      </div>
                    </div>

                    <div className={styles.quantitiesSummary}>
                      <div className={styles.qtyStat}>
                        <span className={styles.qtyStatLabel}>Total Required</span>
                        <span
                          className={`${styles.qtyStatVal} ${styles.qtyStatValHighlight}`}
                        >
                          {item.totalRequired}
                        </span>
                      </div>
                      <div className={styles.qtyStat}>
                        <span className={styles.qtyStatLabel}>Picked</span>
                        <span
                          className={`${styles.qtyStatVal} ${
                            isFullyPicked
                              ? styles.qtyStatValComplete
                              : styles.qtyStatValRemaining
                          }`}
                        >
                          {item.totalPicked}
                        </span>
                      </div>
                      <div className={styles.qtyStat}>
                        <span className={styles.qtyStatLabel}>Remaining</span>
                        <span
                          className={`${styles.qtyStatVal} ${
                            isFullyPicked
                              ? styles.qtyStatValComplete
                              : styles.qtyStatValRemaining
                          }`}
                        >
                          {item.remaining}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Shortage Alert */}
                  {item.hasShortage && item.shortageReason && (
                    <div className={styles.shortageAlert}>
                      <AlertTriangle size={16} />
                      <span>
                        <strong>Stock Warning:</strong> {item.shortageReason}
                      </span>
                    </div>
                  )}

                  {/* Storage Location & Batch Traceability Chips */}
                  <div className={styles.locationSection}>
                    <span className={styles.locationTitle}>
                      Storage Locations & FEFO Batch Allocations:
                    </span>
                    <div className={styles.locationList}>
                      {item.locations.length > 0 ? (
                        item.locations.map((loc, idx) => (
                          <div key={idx} className={styles.locationChip}>
                            <MapPin size={14} color="#0284c7" />
                            <span className={styles.zoneBadge}>
                              {loc.zone.startsWith("Zone ")
                                ? loc.zone
                                : `Zone ${loc.zone}`}
                            </span>
                            <span>
                              Rack {loc.rack || "01"} · Bin {loc.bin}
                            </span>
                            <span className={styles.batchBadge}>
                              {loc.batch}
                            </span>
                            <span
                              className={
                                loc.isExpired
                                  ? styles.expiryExpired
                                  : styles.expiryBadge
                              }
                            >
                              Exp: {loc.expiry} {loc.isExpired && "(EXPIRED)"}
                            </span>
                            <span
                              style={{
                                fontWeight: 600,
                                color: "#1e293b",
                                background: "#ffffff",
                                padding: "0.1rem 0.4rem",
                                borderRadius: "4px",
                                border: "1px solid #e2e8f0",
                              }}
                            >
                              Allocated: {loc.allocatedQty}
                            </span>
                          </div>
                        ))
                      ) : (
                        <span style={{ fontSize: "0.82rem", color: "#64748b" }}>
                          No specific bin allocation recorded.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Contributing Orders Accordion */}
                  <button
                    type="button"
                    className={styles.accordionToggle}
                    onClick={() => toggleSkuExpanded(item.sku)}
                  >
                    {isExpanded ? (
                      <ChevronUp size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                    <span>
                      {isExpanded ? "Hide" : "View"}{" "}
                      {item.contributingOrders.length} Contributing Customer
                      Order
                      {item.contributingOrders.length > 1 ? "s" : ""}
                    </span>
                  </button>

                  {isExpanded && (
                    <table className={styles.contributingOrdersTable}>
                      <thead>
                        <tr>
                          <th>Order ID</th>
                          <th>Customer</th>
                          <th>Order Date</th>
                          <th>Required</th>
                          <th>Picked</th>
                          <th>Status</th>
                          <th>Assignee</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.contributingOrders.map((co, cIdx) => {
                          const orderRemaining = co.requiredQty - co.pickedQty;
                          return (
                            <tr key={cIdx}>
                              <td>
                                <strong>{co.orderId}</strong>
                              </td>
                              <td>{co.customer}</td>
                              <td>{co.orderDate || "N/A"}</td>
                              <td>{co.requiredQty}</td>
                              <td>{co.pickedQty}</td>
                              <td>
                                <span
                                  className={`status ${
                                    co.status === "Picked"
                                      ? "healthy"
                                      : "low-stock"
                                  }`}
                                  style={{ fontSize: "0.75rem" }}
                                >
                                  {co.status}
                                </span>
                              </td>
                              <td>{co.assignee}</td>
                              <td>
                                {orderRemaining > 0 ? (
                                  <button
                                    type="button"
                                    className="row-link"
                                    onClick={() =>
                                      handlePickOrderLine(
                                        co.order,
                                        item.sku,
                                        orderRemaining
                                      )
                                    }
                                  >
                                    Pick ({orderRemaining})
                                  </button>
                                ) : (
                                  <span
                                    style={{
                                      color: "#16a34a",
                                      fontWeight: 600,
                                      fontSize: "0.75rem",
                                    }}
                                  >
                                    ✓ Complete
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyCard}>
            <Boxes size={32} style={{ margin: "0 auto 0.5rem", color: "#94a3b8" }} />
            <p>
              No orders selected. Select one or more eligible pending orders
              above to generate a consolidated picking list.
            </p>
          </div>
        )}
      </section>

      {/* 4. Packing Station – Order-Wise Separation */}
      <section className="panel wms-panel">
        <div className="panel-heading">
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Package size={20} />
              <span>Packing Station (Order-Wise Separation)</span>
            </h2>
            <p>
              Verify picked items separated back into individual customer orders
              before package sealing and shipping label creation. Orders become
              Ready to Pack only when all required quantities have been picked.
            </p>
          </div>
          <div className="inline-actions">
            {button("Pack order", "pack", () =>
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
              ])
            )}
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order / Customer</th>
                <th>Order Date</th>
                <th>Warehouse</th>
                <th>Line Items (Required / Picked / Packed)</th>
                <th>Total Ordered / Picked</th>
                <th>Readiness Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {packingOrders.length ? (
                packingOrders.map((o) => {
                  const lines = o.lines?.length
                    ? o.lines
                    : [{ product: o.product, qty: o.qty, picked: o.picked || 0, packed: 0 }];

                  const isAllPicked = lines.every(
                    (l) => (l.picked || 0) === l.qty && l.qty > 0
                  );
                  const isPartiallyPicked =
                    lines.some((l) => (l.picked || 0) > 0) && !isAllPicked;
                  const isAllPacked =
                    lines.every((l) => (l.packed || 0) === l.qty && l.qty > 0) ||
                    o.status === "Packed";

                  return (
                    <tr key={o.id}>
                      <td>
                        <strong>{o.id}</strong>
                        <br />
                        <span style={{ color: "#475569", fontSize: "0.85rem" }}>
                          {o.customer}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: "0.82rem",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.3rem",
                            color: "#475569",
                          }}
                        >
                          <Calendar size={13} />
                          {o.createdAt || "N/A"}
                        </span>
                      </td>
                      <td>
                        {o.warehouse
                          ? warehouseMap.get(o.warehouse) || o.warehouse
                          : "Default"}
                      </td>
                      <td>
                        <div className={styles.orderLinesList}>
                          {lines.map((l, idx) => {
                            const p = productMap.get(l.product);
                            return (
                              <div key={idx} className={styles.orderLineItem}>
                                <strong>{p?.name || l.product}</strong>
                                <span className={styles.productSku}>
                                  ({l.product})
                                </span>
                                <span className={styles.orderLineQty}>
                                  Req: {l.qty} | Picked: {l.picked || 0} | Packed:{" "}
                                  {l.packed || 0}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td>
                        <strong>
                          {o.qty} / {o.picked || 0}
                        </strong>
                      </td>
                      <td>
                        {isAllPacked ? (
                          <span className={styles.badgePacked}>
                            <CheckCircle2 size={13} /> Packed
                          </span>
                        ) : isAllPicked ? (
                          <span className={styles.badgeReady}>
                            <CheckCircle2 size={13} /> Ready to Pack
                          </span>
                        ) : isPartiallyPicked ? (
                          <span className={styles.badgePartial}>
                            <Clock size={13} /> Partially Picked ({o.picked}/{o.qty})
                          </span>
                        ) : (
                          <span className="status low-stock">Awaiting Pick</span>
                        )}
                      </td>
                      <td>
                        <div className="inline-actions">
                          <button
                            type="button"
                            className="row-link"
                            onClick={() => setDocumentOrder(o)}
                          >
                            Docs
                          </button>
                          {isAllPicked && !isAllPacked && (
                            <button
                              type="button"
                              className="secondary-button"
                              style={{
                                padding: "0.25rem 0.6rem",
                                fontSize: "0.8rem",
                              }}
                              onClick={() => handlePackOrder(o)}
                            >
                              Pack Order
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="empty-state">
                    No orders currently in picking or packing for the selected
                    warehouse scope.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
