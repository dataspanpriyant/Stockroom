"use client";

import { useMemo, useState } from "react";
import { MapPin, Package } from "lucide-react";
import { groupDashboardLocations, type DashboardMapCell, type DashboardMapWarehouse } from "@/lib/map-groups";
import { today, type State } from "@/lib/wms";
import styles from "./dashboard-warehouse-map.module.css";

type Props = { state: Pick<State, "locations" | "lots" | "receipts" | "warehouses" | "products">; onOpenWarehouse: (id: string) => void };
const quantity = new Intl.NumberFormat("en").format;
function summary(warehouse: { occupancy: { occupied: number; capacity: number } }) { return `${quantity(warehouse.occupancy.occupied)} / ${quantity(warehouse.occupancy.capacity)} units`; }

function Cell({ item, onSelect, selected }: { item: DashboardMapCell; onSelect: (item: DashboardMapCell) => void; selected?: boolean }) {
  const percent = item.occupancy.capacity ? Math.min(100, item.occupancy.occupied / item.occupancy.capacity * 100) : 0;
  return <button className={styles.cell} data-status={item.status} data-selected={selected ? "true" : undefined} title={`${item.path} · ${item.location.id} · ${summary(item)}`} onClick={() => onSelect(item)}>
    <strong>{item.label}</strong><i><span style={{ width: `${percent}%` }} /></i>
  </button>;
}

function WarehouseView({ warehouse, onSelect, onOpen, selectedId }: { warehouse: DashboardMapWarehouse; onSelect: (item: DashboardMapCell) => void; onOpen: () => void; selectedId?: string }) {
  return <article className={styles.warehouse}>
    <header className={styles.warehouseHeader}><div><strong>{warehouse.name}</strong><small>{summary(warehouse)} · {warehouse.occupancy.capacity ? Math.round(warehouse.occupancy.occupied / warehouse.occupancy.capacity * 100) : 0}% occupied</small></div><button className="row-link" onClick={onOpen}>Open in Warehouse</button></header>
    {warehouse.zones.length ? warehouse.zones.map((zone) => <details key={zone.id} open className={styles.zone}><summary><span>Zone {zone.id}</span><small>{summary(zone)}</small></summary>
      {zone.racks.map((rack) => <details key={rack.id} open className={styles.rack}><summary><span>Rack {rack.id}</span><small>{summary(rack)}</small></summary>
        {rack.rows.map((row) => <div key={row.id} className={styles.row}><span>{row.label}</span><div>{row.cells.map((item) => <Cell key={item.location.id} item={item} selected={item.location.id === selectedId} onSelect={onSelect} />)}</div></div>)}
      </details>)}
    </details>) : <p className={styles.empty}>No locations in this warehouse</p>}
    <div className={styles.special}><strong>Special areas</strong><span>RECEIVING · {quantity(warehouse.special.receiving)} units</span><span>QUARANTINE · {quantity(warehouse.special.quarantine)} units</span></div>
    {warehouse.legacy.length > 0 && <details className={styles.legacy} open><summary>Legacy locations</summary><div>{warehouse.legacy.map((item) => <Cell key={item.location.id} item={item} selected={item.location.id === selectedId} onSelect={onSelect} />)}</div></details>}
  </article>;
}

export default function DashboardWarehouseMap({ state, onOpenWarehouse }: Props) {
  const [scope, setScope] = useState("ALL");
  const [selected, setSelected] = useState<DashboardMapCell | null>(null);
  const groups = useMemo(() => groupDashboardLocations(state), [state]);
  const selectedWarehouse = groups.find((warehouse) => warehouse.id === scope) || groups[0];
  const productName = (id: string) => state.products.find((product) => product.id === id)?.name || id;
  const selectCell = (item: DashboardMapCell) => setSelected(item);
  return <div className={styles.map}>
    <div className={styles.toolbar}><label>Warehouse <select value={scope} onChange={(event) => { setScope(event.target.value); setSelected(null); }}><option value="ALL">All warehouses</option>{groups.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label><div className={styles.legend}>{[["available", "Available"], ["partial", "Occupied"], ["full", "Full"], ["blocked", "Blocked"]].map(([status, label]) => <span key={status}><i data-status={status} />{label}</span>)}</div></div>
    <div className={styles.content}><div className={styles.list}>{scope === "ALL" ? groups.map((warehouse) => <details key={warehouse.id} className={styles.card} open><summary><span><strong>{warehouse.name}</strong><small>{summary(warehouse)} · {warehouse.occupancy.capacity ? Math.round(warehouse.occupancy.occupied / warehouse.occupancy.capacity * 100) : 0}% occupied</small></span><button className="row-link" onClick={(event) => { event.preventDefault(); onOpenWarehouse(warehouse.id); }}>Open in Warehouse</button></summary><WarehouseView warehouse={warehouse} selectedId={selected?.location.id} onSelect={selectCell} onOpen={() => onOpenWarehouse(warehouse.id)} /></details>) : selectedWarehouse ? <WarehouseView warehouse={selectedWarehouse} selectedId={selected?.location.id} onSelect={selectCell} onOpen={() => onOpenWarehouse(selectedWarehouse.id)} /> : <p className={styles.empty}>No locations in this warehouse</p>}</div>
      <aside className={styles.detail}>{selected ? <><h3><MapPin size={17} />{selected.label}</h3><p className={styles.path}>{selected.path}<br /><small>{selected.location.id}</small></p>{selected.lots.length ? selected.lots.map((lot) => <div className={styles.lot} key={lot.id}><Package size={15} /><div><strong>{productName(lot.product)}</strong><small>SKU {lot.product} · {quantity(lot.qty)} units · {quantity(lot.reserved)} reserved</small><small>Batch {lot.batch} · Expiry {lot.expiry} {lot.expiry < today() && <b>Expired</b>}</small></div></div>) : <p className={styles.empty}>No stock in this cell.</p>}</> : <p className={styles.empty}>Select a cell to inspect stored products.</p>}</aside>
    </div>
  </div>;
}
