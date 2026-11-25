"use client";

import { useMemo, useState, useEffect } from "react";
import { Download, CheckCircle, Loader2 } from "lucide-react";
import type { State, Order, Command, Role } from "@/lib/wms";
import { lotWarehouse, naturalSort } from "@/lib/wms";
import {
  ORDER_DATE_FIELD,
  toLocalDateString,
  formatPickListDate,
} from "@/lib/picking-utils";
import styles from "./consolidated-picking.module.css";

export type PublicState = Omit<State, "users"> & {
  users: Omit<State["users"][number], "password">[];
};

export type Session = { id: string; name: string; role: Role };

export interface ConsolidatedPickingProps {
  state: PublicState;
  user: Session;
  action: (
    command: Command,
    finish?: boolean,
    onFailure?: (message: string) => void,
    onSuccess?: (result: { detail?: string }) => void
  ) => Promise<boolean>;
  refresh: () => Promise<void>;
  onOrdersUpdated?: () => void;
}

export interface PickRowItem {
  rowKey: string;
  orderId: string;
  customer: string;
  warehouseId: string;
  warehouseName: string;
  sku: string;
  productName: string;
  barcode: string;
  specification: string;
  orderedQty: number;
  pickedQty: number;
  locationZone: string;
  locationCoords: string;
  locationString: string;
  rawOrder: Order;
}

export default function ConsolidatedPicking({
  state: s,
  user,
  action,
  refresh,
}: ConsolidatedPickingProps) {
  // Dropdown states
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("");
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [selectedProduct, setSelectedProduct] = useState<string>("ALL");

  // Short pick editing state: rowKey -> { pickedQty: number, reason: string }
  const [shortPicks, setShortPicks] = useState<Record<string, { pickedQty: number; reason: string }>>({});
  // Track which rows are currently in tap/edit mode
  const [editingRows, setEditingRows] = useState<Set<string>>(new Set());

  // Execution states
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [progressText, setProgressText] = useState<string>("");
  const [executionSummary, setExecutionSummary] = useState<string>("");
  // Track failed orders to keep in view: orderId -> failureReason
  const [failedOrders, setFailedOrders] = useState<Record<string, string>>({});

  // Products map for O(1) metadata lookup
  const productMap = useMemo(() => {
    const map = new Map<string, (typeof s.products)[number]>();
    for (const p of s.products) {
      map.set(p.id, p);
    }
    return map;
  }, [s.products]);

  // Warehouses map
  const warehouseMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of s.warehouses) {
      map.set(w.id, w.name);
    }
    return map;
  }, [s.warehouses]);

  // Helper: test if order is open
  const isOpenOrder = (o: Order) =>
    ["Reserved", "Picking", "Short picked"].includes(o.status);

  // Helper: Operator sees only unassigned orders and orders assigned to themselves
  const isOrderVisibleToUser = (o: Order) => {
    if (user.role === "Operator") {
      return !o.assignee || o.assignee === user.id || o.assignee === user.name;
    }
    return true; // Admin and Supervisor see all open orders
  };

  // Helper: test if order belongs to warehouse
  const isOrderInWarehouse = (o: Order, wId: string) => {
    if (o.warehouse) return o.warehouse === wId;
    return (o.allocations || []).some((a) => {
      const lot = s.lots.find((l) => l.id === a.lot);
      return lot && lotWarehouse(s, lot) === wId;
    });
  };

  // Open orders for selected warehouse visible to user
  const warehouseOpenOrders = useMemo(() => {
    if (!selectedWarehouse) return [];
    return s.orders.filter(
      (o) =>
        isOpenOrder(o) &&
        isOrderInWarehouse(o, selectedWarehouse) &&
        isOrderVisibleToUser(o)
    );
  }, [s.orders, s.lots, selectedWarehouse, user.role, user.id, user.name]);

  // Distinct days with open order counts
  const availableDays = useMemo(() => {
    const dayMap = new Map<string, number>();
    for (const o of warehouseOpenOrders) {
      const localDay = toLocalDateString(o[ORDER_DATE_FIELD]);
      if (localDay) {
        dayMap.set(localDay, (dayMap.get(localDay) || 0) + 1);
      }
    }

    // Sort chronologically (oldest day first for display in dropdown)
    const sortedDates = Array.from(dayMap.keys()).sort();
    return sortedDates.map((date, idx) => ({
      date,
      dayNumber: idx + 1,
      orderCount: dayMap.get(date) || 0,
      label: `Day ${idx + 1} · ${date} · ${dayMap.get(date)} order${(dayMap.get(date) || 0) !== 1 ? "s" : ""}`,
    }));
  }, [warehouseOpenOrders]);

  // Default day selection: default to today (or first day if today has no orders), never oldest day
  useEffect(() => {
    if (availableDays.length > 0) {
      const todayStr = toLocalDateString(new Date().toISOString());
      const hasToday = availableDays.some((d) => d.date === todayStr);

      if (!availableDays.some((d) => d.date === selectedDay)) {
        setSelectedDay(hasToday ? todayStr : availableDays[0].date);
      }
    } else {
      setSelectedDay("");
    }
  }, [availableDays, selectedDay]);

  // Open orders filtered by selected Day
  const dayOrders = useMemo(() => {
    if (!selectedDay) return [];
    return warehouseOpenOrders.filter(
      (o) => toLocalDateString(o[ORDER_DATE_FIELD]) === selectedDay
    );
  }, [warehouseOpenOrders, selectedDay]);

  // Distinct products in that day's orders
  const availableProducts = useMemo(() => {
    const pSet = new Set<string>();
    for (const o of dayOrders) {
      const lines = o.lines?.length
        ? o.lines
        : [{ product: o.product, qty: o.qty, picked: o.picked || 0, packed: 0 }];
      for (const line of lines) {
        pSet.add(line.product);
      }
    }

    return Array.from(pSet)
      .map((sku) => {
        const prod = productMap.get(sku);
        return {
          sku,
          name: prod?.name || sku,
          label: `${prod?.name || sku} (${sku})`,
        };
      })
      .sort((a, b) => naturalSort([a, b], (x) => x.name)[0] === a ? -1 : 1);
  }, [dayOrders, productMap]);

  // Reset product selection if selected product not in day's orders
  useEffect(() => {
    if (selectedProduct !== "ALL" && !availableProducts.some((p) => p.sku === selectedProduct)) {
      setSelectedProduct("ALL");
    }
  }, [availableProducts, selectedProduct]);

  // Build raw list of pick row items
  const pickRows = useMemo((): PickRowItem[] => {
    if (!selectedWarehouse || !selectedDay) return [];

    const rows: PickRowItem[] = [];

    for (const order of dayOrders) {
      if (Object.keys(failedOrders).length > 0 && !failedOrders[order.id]) {
        continue;
      }

      const lines = order.lines?.length
        ? order.lines
        : [{ product: order.product, qty: order.qty, picked: order.picked || 0, packed: 0 }];

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const sku = line.product;

        if (selectedProduct !== "ALL" && sku !== selectedProduct) {
          continue;
        }

        const prod = productMap.get(sku);
        const prodName = prod?.name || sku;
        const barcode = prod?.barcode || "";
        const specification = [prod?.category, prod?.brand].filter(Boolean).join(" / ") || prod?.category || "";

        // Format storage location: Zone and Rack · Row · Col
        const lineAllocations = (order.allocations || []).filter((a) => a.product === sku);
        let zonePart = "";
        let coordPart = "";

        for (const alloc of lineAllocations) {
          const lot = s.lots.find((l) => l.id === alloc.lot);
          if (!lot) continue;
          const loc = s.locations.find((l) => l.id === lot.location);
          if (!loc) continue;

          if (loc.zone) {
            zonePart = loc.zone.startsWith("Zone") ? loc.zone : `Zone ${loc.zone}`;
          }

          const parts: string[] = [];
          if (loc.rack) {
            const rNum = parseInt(loc.rack, 10);
            parts.push(`Rack ${isNaN(rNum) ? loc.rack : rNum}`);
          }
          if (loc.row != null) {
            parts.push(`Row ${loc.row}`);
          }
          if (loc.column != null) {
            parts.push(`Col ${loc.column}`);
          } else if (loc.section) {
            parts.push(`Bin ${loc.section}`);
          }

          if (parts.length > 0) {
            coordPart = parts.join(" · ");
          }
        }

        const finalZone = zonePart || "NA";
        const finalCoords = coordPart;
        const finalLocationString = zonePart
          ? coordPart
            ? `${zonePart} · ${coordPart}`
            : zonePart
          : "NA";

        const rowKey = `${order.id}-${sku}-${lineIndex}`;

        rows.push({
          rowKey,
          orderId: order.id,
          customer: order.customer || "Unspecified",
          warehouseId: selectedWarehouse,
          warehouseName: warehouseMap.get(selectedWarehouse) || selectedWarehouse,
          sku,
          productName: prodName,
          barcode,
          specification,
          orderedQty: line.qty,
          pickedQty: line.qty,
          locationZone: finalZone,
          locationCoords: finalCoords,
          locationString: finalLocationString,
          rawOrder: order,
        });
      }
    }

    return rows;
  }, [
    selectedWarehouse,
    selectedDay,
    selectedProduct,
    dayOrders,
    failedOrders,
    productMap,
    warehouseMap,
    s.lots,
    s.locations,
  ]);

  // 1. ALPHABETICAL ORDER:
  // Sort the list A-Z, case-insensitive, with ONE comparator, applied once to a copy of the rows:
  // product name, then customer name, then order ID, then Item #.
  // Both screen and PDF use this same sorted array.
  const sortedRows = useMemo(() => {
    return [...pickRows].sort((a, b) => {
      const c1 = (a.productName || "").localeCompare(b.productName || "", undefined, { sensitivity: "base", numeric: true });
      if (c1 !== 0) return c1;
      const c2 = (a.customer || "").localeCompare(b.customer || "", undefined, { sensitivity: "base", numeric: true });
      if (c2 !== 0) return c2;
      const c3 = (a.orderId || "").localeCompare(b.orderId || "", undefined, { sensitivity: "base", numeric: true });
      if (c3 !== 0) return c3;
      const itemA = a.barcode || a.sku || "";
      const itemB = b.barcode || b.sku || "";
      return itemA.localeCompare(itemB, undefined, { sensitivity: "base", numeric: true });
    });
  }, [pickRows]);

  // Summary counts
  const summary = useMemo(() => {
    const uniqueOrders = new Set(sortedRows.map((r) => r.orderId));
    const linesCount = sortedRows.length;
    const unitsCount = sortedRows.reduce((sum, r) => sum + r.orderedQty, 0);

    return {
      ordersCount: uniqueOrders.size,
      linesCount,
      unitsCount,
    };
  }, [sortedRows]);

  // Quantity tap & inline edit handlers
  const handleStartEdit = (rowKey: string, currentOrdered: number) => {
    setEditingRows((prev) => new Set(prev).add(rowKey));
    if (!shortPicks[rowKey]) {
      setShortPicks((prev) => ({
        ...prev,
        [rowKey]: { pickedQty: currentOrdered, reason: "" },
      }));
    }
  };

  const handleQtyChange = (rowKey: string, maxQty: number, valStr: string) => {
    const val = Number(valStr);
    if (!Number.isSafeInteger(val) || val < 0 || val > maxQty) return;

    setShortPicks((prev) => ({
      ...prev,
      [rowKey]: {
        pickedQty: val,
        reason: prev[rowKey]?.reason || "",
      },
    }));
  };

  const handleReasonChange = (rowKey: string, reason: string) => {
    setShortPicks((prev) => ({
      ...prev,
      [rowKey]: {
        pickedQty: prev[rowKey]?.pickedQty ?? 0,
        reason,
      },
    }));
  };

  const handleResetShortPick = (rowKey: string) => {
    setShortPicks((prev) => {
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
    setEditingRows((prev) => {
      const next = new Set(prev);
      next.delete(rowKey);
      return next;
    });
  };

  // 3. DOWNLOADABLE PDF (replaces Print)
  // Generates PDF with jspdf + jspdf-autotable dynamically imported on click
  const handleDownloadPdf = async () => {
    if (!sortedRows.length || isGeneratingPdf) return;

    try {
      setIsGeneratingPdf(true);

      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const warehouseName = warehouseMap.get(selectedWarehouse) || selectedWarehouse;
      const prodScopeName = selectedProduct === "ALL"
        ? "All products"
        : availableProducts.find((p) => p.sku === selectedProduct)?.name || selectedProduct;

      const generatedStr = new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date());

      // Header: full-width black band with "PRODUCT PICK LIST" in white bold (12mm margins => width 186mm)
      doc.setFillColor(0, 0, 0);
      doc.rect(12, 12, 186, 11, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(255, 255, 255);
      doc.text("PRODUCT PICK LIST", 15, 19.5);

      // Details strip: Warehouse | Day | Product | Generated
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(0, 0, 0);
      doc.text(
        `Warehouse: ${warehouseName}   |   Day: ${selectedDay}   |   Product: ${prodScopeName}   |   Generated: ${generatedStr}`,
        12,
        28
      );

      // Totals strip: Orders | Lines | Total units
      doc.text(
        `Orders: ${summary.ordersCount}   |   Lines: ${summary.linesCount}   |   Total units: ${summary.unitsCount.toLocaleString()}`,
        12,
        34
      );

      // Thin separator rule
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.2);
      doc.line(12, 37, 198, 37);

      // Table columns: Item # | Product (name bold, Specification below) | Order / Customer (customer bold, order ID below)
      // | Location (zone bold, then "Rack · Row · Col" on the next line) | Qty (large, bold) | Picked (empty tick box)
      const tableBody = sortedRows.map((row) => {
        const itemCode = String(row.barcode || row.sku || "");
        const prodCell = {
          content: String(`${row.productName}\n${row.specification ? `Specification: ${row.specification}` : ""}`).trim(),
          title: String(row.productName || ""),
          subtitle: row.specification ? String(`Specification: ${row.specification}`) : "",
        };
        const orderCell = {
          content: String(`${row.customer}\n${row.orderId}`).trim(),
          title: String(row.customer || ""),
          subtitle: String(row.orderId || ""),
        };
        const locCell = {
          content: String(`${row.locationZone}\n${row.locationCoords}`).trim(),
          title: String(row.locationZone || "NA"),
          subtitle: String(row.locationCoords || ""),
        };

        return [
          itemCode,
          prodCell,
          orderCell,
          locCell,
          {
            content: String(row.orderedQty),
            styles: {
              fontStyle: "bold" as const,
              fontSize: 13,
              halign: "center" as const,
              valign: "middle" as const,
            },
          },
          "", // Empty tick box cell
        ];
      });

      autoTable(doc, {
        startY: 40,
        margin: { left: 12, right: 12, top: 12, bottom: 18 },
        head: [["ITEM #", "PRODUCT", "ORDER / CUSTOMER", "LOCATION", "QTY", "PICKED"]],
        body: tableBody,
        theme: "plain",
        headStyles: {
          fillColor: [0, 0, 0],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 8.5,
          halign: "left",
          cellPadding: { top: 2.5, bottom: 2.5, left: 1.5, right: 1.5 },
        },
        bodyStyles: {
          fillColor: [255, 255, 255],
          textColor: [0, 0, 0],
          fontSize: 8.5,
          lineWidth: { bottom: 0.1 },
          lineColor: [0, 0, 0],
          cellPadding: { top: 2.5, bottom: 2.5, left: 1.5, right: 1.5 },
        },
        alternateRowStyles: {
          fillColor: [255, 255, 255],
        },
        // Column widths: Item # 13% | Product 25% | Order / Customer 20% | Location 24% | Qty 9% | Picked 9% (Total 186mm)
        columnStyles: {
          0: { cellWidth: 24.18, font: "courier", fontStyle: "bold" as const, fontSize: 11 }, // Item # 13%
          1: { cellWidth: 46.50 }, // Product 25%
          2: { cellWidth: 37.20 }, // Order / Customer 20%
          3: { cellWidth: 44.64 }, // Location 24%
          4: { cellWidth: 16.74, halign: "center" as const }, // Qty 9%
          5: { cellWidth: 16.74, halign: "center" as const }, // Picked 9%
        },
        showHead: "everyPage",
        rowPageBreak: "avoid",
        willDrawCell: (data) => {
          if (data.section === "body" && [1, 2, 3].includes(data.column.index)) {
            const raw = data.cell.raw;
            if (typeof raw === "object" && raw !== null && "title" in raw) {
              data.cell.text = [];
            }
          }
        },
        didDrawCell: (data) => {
          if (data.section === "body") {
            // Draw custom bold + regular lines for Product (1), Order / Customer (2), Location (3)
            if ([1, 2, 3].includes(data.column.index)) {
              const raw = data.cell.raw as { title?: string; subtitle?: string } | undefined;
              if (typeof raw === "object" && raw !== null && typeof raw.title === "string") {
                const x = data.cell.x + 1.5;
                let y = data.cell.y + 4.2;
                doc.setFont("helvetica", "bold");
                doc.setFontSize(8.5);
                doc.setTextColor(0, 0, 0);

                const boldLines = doc.splitTextToSize(raw.title, data.cell.width - 3);
                doc.text(boldLines, x, y);
                y += boldLines.length * 3.6;

                if (raw.subtitle) {
                  doc.setFont("helvetica", "normal");
                  // For Location (col 3), line 2 is at 9 pt with no wrapping
                  if (data.column.index === 3) {
                    doc.setFontSize(9);
                    doc.setTextColor(0, 0, 0);
                    doc.text(raw.subtitle, x, y);
                  } else {
                    doc.setFontSize(7.5);
                    doc.setTextColor(0, 0, 0);
                    const subLines = doc.splitTextToSize(raw.subtitle, data.cell.width - 3);
                    doc.text(subLines, x, y);
                  }
                }
              }
            }

            // Draw empty tick box for column 5 (Picked)
            if (data.column.index === 5) {
              const boxSize = 4.2;
              const x = data.cell.x + (data.cell.width - boxSize) / 2;
              const y = data.cell.y + (data.cell.height - boxSize) / 2;
              doc.setDrawColor(0, 0, 0);
              doc.setLineWidth(0.3);
              doc.rect(x, y, boxSize, boxSize);
            }
          }
        },
      });

      // Last page: Total units line and signature line
      let lastY = (doc as any).lastAutoTable.finalY + 8;
      if (lastY > 255) {
        doc.addPage();
        lastY = 20;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      doc.text(`Total Units: ${summary.unitsCount.toLocaleString()}`, 12, lastY);

      lastY += 12;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(
        "Picker Signature: ___________________________          Date: ____________________",
        12,
        lastY
      );

      // Footer on every page: "Page X of Y"
      const totalPages = doc.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(0, 0, 0);
        doc.text(`Page ${p} of ${totalPages}`, 198, 287, { align: "right" });
      }

      // File name: pick-list_<WAREHOUSE>_<YYYY-MM-DD>_<product-scope>.pdf
      const cleanWarehouse = (selectedWarehouse || "ALL").replace(/[^a-zA-Z0-9_-]/g, "");
      const cleanDay = (selectedDay || "NODAY").replace(/[^a-zA-Z0-9_-]/g, "");
      const cleanProduct = selectedProduct === "ALL"
        ? "all-products"
        : (selectedProduct || "product").replace(/[^a-zA-Z0-9_-]/g, "");
      const fileName = `pick-list_${cleanWarehouse}_${cleanDay}_${cleanProduct}.pdf`;

      doc.save(fileName);
    } catch (err) {
      console.error("PDF generation failed:", err);
      alert("Failed to generate PDF. Please try again.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // Mark All Picked Handler
  const handleMarkAllPicked = async () => {
    if (!sortedRows.length || isRunning) return;

    // 1. Pre-validation across all lines
    for (const row of sortedRows) {
      const edit = shortPicks[row.rowKey];
      const picked = edit ? edit.pickedQty : row.orderedQty;

      if (!Number.isSafeInteger(picked) || picked < 0 || picked > row.orderedQty) {
        alert(`Invalid picked quantity for order ${row.orderId} (${row.productName}). Must be a whole number between 0 and ${row.orderedQty}.`);
        return;
      }

      if (picked < row.orderedQty && (!edit?.reason || !edit.reason.trim())) {
        alert(`A reason is required for short picking order ${row.orderId} (${row.productName}).`);
        return;
      }
    }

    // 2. Ask confirmation
    const confirmMessage = `Mark ${summary.ordersCount} orders as picked?`;
    if (!window.confirm(confirmMessage)) return;

    // 3. Sequential order-by-order, line-by-line execution
    setIsRunning(true);
    setExecutionSummary("");

    const orderGroups = new Map<string, PickRowItem[]>();
    for (const row of sortedRows) {
      const list = orderGroups.get(row.orderId) || [];
      list.push(row);
      orderGroups.set(row.orderId, list);
    }

    let successCount = 0;
    let shortCount = 0;
    let failCount = 0;
    const newFailures: Record<string, string> = {};

    const totalOrders = orderGroups.size;
    let processedOrders = 0;

    for (const [orderId, rows] of orderGroups.entries()) {
      processedOrders++;
      setProgressText(`${processedOrders} / ${totalOrders}`);

      let orderFailed = false;
      let orderShort = false;

      // Check barcodes before starting calls for this order
      for (const row of rows) {
        if (!row.barcode) {
          orderFailed = true;
          newFailures[orderId] = `Product ${row.sku} (${row.productName}) has no barcode registered`;
          break;
        }
      }

      if (orderFailed) {
        failCount++;
        continue;
      }

      // Process each line for this order sequentially
      for (const row of rows) {
        const edit = shortPicks[row.rowKey];
        const picked = edit ? edit.pickedQty : row.orderedQty;
        const isShort = picked < row.orderedQty;
        if (isShort) orderShort = true;

        try {
          let errorMsg = "";
          const ok = await action(
            {
              type: "pick",
              order: row.orderId,
              productBarcode: row.barcode,
              qty: picked,
              reason: isShort ? edit.reason.trim() : undefined,
            },
            false,
            (msg) => {
              errorMsg = msg;
            }
          );

          if (!ok) {
            orderFailed = true;
            newFailures[orderId] = errorMsg || "Pick command failed";
            break;
          }
        } catch (e) {
          orderFailed = true;
          newFailures[orderId] = e instanceof Error ? e.message : "Pick command threw error";
          break;
        }
      }

      if (orderFailed) {
        failCount++;
      } else if (orderShort) {
        shortCount++;
      } else {
        successCount++;
      }
    }

    // Apply the final state ONCE at the end
    await refresh();

    setIsRunning(false);
    setProgressText("");
    setFailedOrders(newFailures);

    const summaryText = `${successCount} picked, ${shortCount} short, ${failCount} failed`;
    setExecutionSummary(summaryText);

    if (failCount === 0) {
      setShortPicks({});
      setEditingRows(new Set());
    }
  };

  const listDateDisplay = useMemo(() => formatPickListDate(selectedDay), [selectedDay]);

  return (
    <div className={styles.pickingContainer}>
      {/* Top Controls Card: Warehouse, Day, Product */}
      <div className={styles.controlsCard}>
        <div className={styles.dropdownsRow}>
          {/* Warehouse Dropdown */}
          <div className={styles.dropdownGroup}>
            <label htmlFor="picking-warehouse-select" className={styles.dropdownLabel}>
              Warehouse
            </label>
            <select
              id="picking-warehouse-select"
              name="warehouse"
              className={styles.dropdownSelect}
              value={selectedWarehouse}
              onChange={(e) => {
                setSelectedWarehouse(e.target.value);
                setFailedOrders({});
                setExecutionSummary("");
              }}
            >
              <option value="">Select a warehouse</option>
              {s.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.id})
                </option>
              ))}
            </select>
          </div>

          {/* Day Dropdown (Visible only when warehouse is chosen) */}
          {selectedWarehouse && (
            <div className={styles.dropdownGroup}>
              <label htmlFor="picking-day-select" className={styles.dropdownLabel}>
                Day
              </label>
              <select
                id="picking-day-select"
                name="day"
                className={styles.dropdownSelect}
                value={selectedDay}
                onChange={(e) => {
                  setSelectedDay(e.target.value);
                  setFailedOrders({});
                  setExecutionSummary("");
                }}
                disabled={availableDays.length === 0}
              >
                {availableDays.length > 0 ? (
                  availableDays.map((d) => (
                    <option key={d.date} value={d.date}>
                      {d.label}
                    </option>
                  ))
                ) : (
                  <option value="">No open days</option>
                )}
              </select>
            </div>
          )}

          {/* Product Dropdown (Visible only when warehouse is chosen) */}
          {selectedWarehouse && (
            <div className={styles.dropdownGroup}>
              <label htmlFor="picking-product-select" className={styles.dropdownLabel}>
                Product
              </label>
              <select
                id="picking-product-select"
                name="product"
                className={styles.dropdownSelect}
                value={selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value)}
                disabled={!selectedDay}
              >
                <option value="ALL">All products</option>
                {availableProducts.map((p) => (
                  <option key={p.sku} value={p.sku}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Summary Line */}
        {selectedWarehouse && selectedDay && (
          <div className={styles.summaryLine}>
            <span className={styles.summaryBadge}>
              {summary.ordersCount} orders · {summary.linesCount} lines · {summary.unitsCount.toLocaleString()} units
            </span>
          </div>
        )}
      </div>

      {/* Main Body */}
      {!selectedWarehouse ? (
        <div className={styles.emptyStateCard}>
          Select a warehouse to start.
        </div>
      ) : sortedRows.length === 0 ? (
        <div className={styles.emptyStateCard}>
          No open orders for this warehouse and day.
        </div>
      ) : (
        <>
          {/* Header Block: Product Pick List & Date */}
          <div className={styles.listHeadingBlock}>
            <h2 className={styles.listMainHeading}>Product Pick List</h2>
            <p className={styles.listDateLine}>{listDateDisplay}</p>
          </div>

          {/* Pick List Table */}
          <div className={styles.tableContainer}>
            <div className={styles.tableWrap}>
              <table className={styles.pickTable}>
                <thead>
                  <tr>
                    <th style={{ width: "18%" }}>Item #</th>
                    <th style={{ width: "32%" }}>Product</th>
                    <th style={{ width: "24%" }}>Order / Customer</th>
                    <th style={{ width: "16%" }}>Location</th>
                    <th style={{ width: "10%", textAlign: "center" }}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => {
                    const edit = shortPicks[row.rowKey];
                    const isEditing = editingRows.has(row.rowKey);
                    const currentPicked = edit ? edit.pickedQty : row.orderedQty;
                    const isShort = currentPicked < row.orderedQty;
                    const failure = failedOrders[row.orderId];
                    const itemCode = row.barcode || row.sku;

                    return (
                      <tr
                        key={row.rowKey}
                        className={`${isShort ? styles.shortRow : ""} ${failure ? styles.failedRow : ""}`}
                      >
                        {/* Item # */}
                        <td>
                          <span className={styles.itemNumber}>{itemCode}</span>
                        </td>

                        {/* Product (name 14px bold, Specification 12px regular below) */}
                        <td>
                          <div className={styles.cellStack}>
                            <span className={styles.productTitle}>{row.productName}</span>
                            {row.specification && (
                              <span className={styles.specLine}>
                                Specification: {row.specification}
                              </span>
                            )}
                            {failure && (
                              <span className={styles.failedAlert} role="alert">
                                ⚠ Failure: {failure}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Order / Customer (customer 14px bold, order ID 12px regular below) */}
                        <td>
                          <div className={styles.cellStack}>
                            <span className={styles.customerTitle}>{row.customer}</span>
                            <span className={styles.orderRef}>{row.orderId}</span>
                          </div>
                        </td>

                        {/* Location (zone bold, coordinates 12px regular below) */}
                        <td>
                          <div className={styles.cellStack}>
                            <span className={styles.locationZone}>{row.locationZone}</span>
                            {row.locationCoords && (
                              <span className={styles.locationCoords}>{row.locationCoords}</span>
                            )}
                          </div>
                        </td>

                        {/* Qty (large, bold - tappable for inline short pick) */}
                        <td style={{ textAlign: "center" }}>
                          {!isEditing && !edit ? (
                            <button
                              type="button"
                              className={styles.qtyTappable}
                              onClick={() => handleStartEdit(row.rowKey, row.orderedQty)}
                              title="Tap to record a short pick"
                            >
                              {row.orderedQty}
                            </button>
                          ) : (
                            <div className={styles.inlineEditBox}>
                              <input
                                id={`qty-${row.rowKey}`}
                                name={`qty-${row.rowKey}`}
                                type="number"
                                min="0"
                                max={row.orderedQty}
                                step="1"
                                className={styles.qtyInput}
                                value={currentPicked}
                                onChange={(e) => handleQtyChange(row.rowKey, row.orderedQty, e.target.value)}
                                autoFocus={isEditing}
                              />
                              {isShort && (
                                <input
                                  id={`reason-${row.rowKey}`}
                                  name={`reason-${row.rowKey}`}
                                  type="text"
                                  placeholder="Reason (required)"
                                  className={styles.reasonInput}
                                  value={edit?.reason || ""}
                                  onChange={(e) => handleReasonChange(row.rowKey, e.target.value)}
                                />
                              )}
                              <button
                                type="button"
                                className={styles.btnResetQty}
                                onClick={() => handleResetShortPick(row.rowKey)}
                              >
                                Reset
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Bar: Status on Left, Exactly Two Buttons on Right: [Download PDF] and [Mark all picked] */}
          <div className={styles.bottomBar}>
            <div>
              {executionSummary && (
                <span className={styles.statusMessage}>
                  {executionSummary}
                </span>
              )}
            </div>

            <div className={styles.bottomButtons}>
              <button
                type="button"
                id="btn-picking-download-pdf"
                name="downloadPdf"
                className={styles.btnPdf}
                onClick={handleDownloadPdf}
                disabled={isGeneratingPdf || isRunning || sortedRows.length === 0}
              >
                {isGeneratingPdf ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Generating PDF...</span>
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    <span>Download PDF</span>
                  </>
                )}
              </button>

              <button
                type="button"
                id="btn-picking-mark-all"
                name="markAllPicked"
                className={styles.btnPickAll}
                onClick={handleMarkAllPicked}
                disabled={isRunning || sortedRows.length === 0}
              >
                {isRunning ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Picking {progressText}...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle size={16} />
                    <span>Mark all picked</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
