import type { AppState, BaseUnit, Item, Lot, Overhead, Recipe, Settings } from '../types'
import { addDays, today } from './format'

/* ===========================================================================
   สูตรคำนวณต้นทุน ราคาขาย และตัวเลขสรุปทั้งหมดของแอป
=========================================================================== */

export function overheadTotal(o: Overhead): number {
  return o.labor + o.water + o.electric + o.misc
}

/** ต้นทุนวัตถุดิบ 1 บรรทัดในสูตร พร้อมเช็คว่าสต็อกพอไหม */
export interface CostLine {
  itemId: string
  name: string
  base: BaseUnit
  unitLabel: string
  /** ปริมาณที่ใช้ (หน่วยฐาน) */
  qty: number
  /** ต้นทุนต่อหน่วยฐาน */
  unitCost: number
  cost: number
  /** สต็อกที่มีอยู่ตอนนี้ */
  available: number
  enough: boolean
  /** true เมื่อวัตถุดิบนี้ยังไม่เคยมีการซื้อเข้า จึงยังไม่รู้ราคา */
  missingPrice: boolean
}

export interface RecipeCost {
  /** จำนวนที่สูตรนี้ทำได้ต่อ 1 รอบ */
  yieldQty: number
  lines: CostLine[]
  materialCost: number
  overheadCost: number
  totalCost: number
  /** ต้นทุนต่อ 1 กล่อง/ชิ้น — ตัวเลขที่ใช้ตั้งราคาขาย */
  costPerUnit: number
  materialPerUnit: number
  overheadPerUnit: number
  /** วัตถุดิบที่ยังไม่รู้ราคา — เตือนให้ผู้ใช้บันทึกการซื้อก่อน */
  unpriced: string[]
}

/**
 * คิดต้นทุนของสูตร
 * scale = จำนวนหน่วยที่จะผลิตจริง ÷ จำนวนที่สูตรทำได้ต่อรอบ (ค่าปกติคือ 1 รอบ)
 */
export function recipeCost(recipe: Recipe, items: Item[], scale = 1): RecipeCost {
  const byId = new Map(items.map((i) => [i.id, i]))
  const lines: CostLine[] = []
  let materialCost = 0
  const unpriced: string[] = []

  for (const line of recipe.lines) {
    const item = byId.get(line.itemId)
    if (!item) continue
    const qty = line.qty * scale
    const unitCost = item.avgCost || item.lastCost || 0
    const cost = qty * unitCost
    if (unitCost <= 0) unpriced.push(item.name)
    materialCost += cost
    lines.push({
      itemId: item.id,
      name: item.name,
      base: item.base,
      unitLabel: item.unitLabel,
      qty,
      unitCost,
      cost,
      available: item.stock,
      enough: item.stock + 1e-9 >= qty,
      missingPrice: unitCost <= 0,
    })
  }

  const overheadCost = overheadTotal(recipe.overhead) * scale
  const totalCost = materialCost + overheadCost
  const producedQty = recipe.yieldQty * scale
  const per = (v: number) => (producedQty > 0 ? v / producedQty : 0)

  return {
    yieldQty: producedQty,
    lines,
    materialCost,
    overheadCost,
    totalCost,
    costPerUnit: per(totalCost),
    materialPerUnit: per(materialCost),
    overheadPerUnit: per(overheadCost),
    unpriced,
  }
}

/** ผลิตได้มากที่สุดกี่หน่วย ด้วยวัตถุดิบที่มีอยู่ตอนนี้ */
export function maxProducible(recipe: Recipe, items: Item[]): number {
  if (!recipe.lines.length || recipe.yieldQty <= 0) return 0
  const byId = new Map(items.map((i) => [i.id, i]))
  let minBatches = Infinity
  for (const line of recipe.lines) {
    const item = byId.get(line.itemId)
    if (!item || line.qty <= 0) continue
    minBatches = Math.min(minBatches, item.stock / line.qty)
  }
  if (!isFinite(minBatches)) return 0
  return Math.max(0, Math.floor(minBatches * recipe.yieldQty))
}

/* --------------------------------------------------------------------------
   ราคาขาย
-------------------------------------------------------------------------- */

export interface PriceSuggestion {
  /** ราคาที่แนะนำ (ปัดแล้ว) */
  price: number
  /** ราคาก่อนปัดเศษ */
  rawPrice: number
  cost: number
  profit: number
  /** กำไรคิดเป็น % ของทุน */
  markupPct: number
  /** กำไรคิดเป็น % ของราคาขาย */
  marginPct: number
}

/** ปัดราคาขึ้นให้ลงตัวตามที่ตั้งไว้ เช่น ปัดเป็นหลัก 5 บาท */
export function roundPrice(value: number, step: number): number {
  if (!step || step <= 0) return Math.round(value * 100) / 100
  return Math.ceil(value / step - 1e-9) * step
}

/**
 * คิดราคาขายจากต้นทุน
 * mode 'markup' = บวกกำไรจากทุน (ทุน 100 กำไร 30% -> ขาย 130) — วิธีที่ร้านส่วนใหญ่ใช้
 * mode 'margin' = อยากให้กำไรเป็น 30% ของราคาขาย -> ขาย 142.86
 */
export function suggestPrice(
  cost: number,
  pct: number,
  mode: Settings['priceMode'] = 'markup',
  rounding = 0,
): PriceSuggestion {
  const p = Math.max(0, pct) / 100
  let raw: number
  if (mode === 'margin') {
    raw = p >= 0.99 ? cost * 100 : cost / (1 - p)
  } else {
    raw = cost * (1 + p)
  }
  const price = roundPrice(raw, rounding)
  return { price, rawPrice: raw, ...profitAt(price, cost) }
}

/** ย้อนกลับ: กำหนดราคาขายเอง แล้วดูว่าได้กำไรกี่ % */
export function profitAt(price: number, cost: number): Omit<PriceSuggestion, 'price' | 'rawPrice'> {
  const profit = price - cost
  return {
    cost,
    profit,
    markupPct: cost > 0 ? (profit / cost) * 100 : 0,
    marginPct: price > 0 ? (profit / price) * 100 : 0,
  }
}

/* --------------------------------------------------------------------------
   สต็อกขนมสำเร็จรูป
-------------------------------------------------------------------------- */

/** ล็อตที่ยังขายได้ เรียงจากเก่าไปใหม่ (ขายของเก่าก่อนเสมอ) */
export function sellableLots(lots: Lot[], recipeId?: string, onDate = today()): Lot[] {
  return lots
    .filter((l) => l.remaining > 1e-9 && (!recipeId || l.recipeId === recipeId) && l.sellDate <= onDate)
    .sort((a, b) => (a.sellDate === b.sellDate ? a.date.localeCompare(b.date) : a.sellDate.localeCompare(b.sellDate)))
}

/** จำนวนขนมพร้อมขายของเมนูหนึ่ง */
export function finishedStock(lots: Lot[], recipeId: string, onDate = today()): number {
  return sellableLots(lots, recipeId, onDate).reduce((s, l) => s + l.remaining, 0)
}

/** ของที่ยังไม่ได้ขายทั้งหมด (รวมของที่ยังไม่ถึงวันขาย) */
export function unsoldLots(lots: Lot[]): Lot[] {
  return lots.filter((l) => l.remaining > 1e-9)
}

/* --------------------------------------------------------------------------
   ตัวเลขสรุปสำหรับหน้าแดชบอร์ด
-------------------------------------------------------------------------- */

export interface MenuStat {
  recipeId: string
  name: string
  unit: string
  qty: number
  revenue: number
  cost: number
  profit: number
}

export interface DaySeriesPoint {
  date: string
  revenue: number
  cost: number
  profit: number
}

export interface Summary {
  from: string
  to: string
  /** ยอดขายรวม */
  revenue: number
  /** ต้นทุนขนมที่ขายไป (ของยกมาจากเมื่อวานเป็น 0 เพราะคิดทุนไปแล้ว) */
  cogs: number
  /** กำไรจากการขาย = ยอดขาย - ต้นทุนขนมที่ขายไป */
  grossProfit: number
  /** ต้นทุนที่ลงมือผลิตในช่วงนี้ (วัตถุดิบ + ค่าใช้จ่ายอื่น) */
  productionCost: number
  /** เฉพาะค่าวัตถุดิบและบรรจุภัณฑ์ที่ใช้ผลิตในช่วงนี้ */
  materialCost: number
  /** เฉพาะค่าแรง ค่าน้ำ ค่าไฟ ค่าจิปาถะที่ใช้ผลิตในช่วงนี้ */
  overheadCost: number
  /** เงินที่จ่ายซื้อของเข้าร้านในช่วงนี้ */
  purchaseSpend: number
  /** มูลค่าต้นทุนของที่ทิ้งไป (รวมอยู่ในต้นทุนผลิตแล้ว จึงไม่หักซ้ำ) */
  wasteCost: number
  /**
   * กำไรสุทธิแบบวันต่อวัน = ยอดขาย - ต้นทุนที่ลงมือผลิตในช่วงนี้
   * ของเหลือและของเสียสะท้อนอยู่ในนี้อยู่แล้ว เพราะจ่ายค่าผลิตไปแต่ไม่มีรายได้กลับมา
   */
  netProfit: number
  qtySold: number
  qtyProduced: number
  qtyWasted: number
  /** ขนมที่ผลิตในช่วงนี้แล้วยังขายไม่ออก */
  leftoverQty: number
  leftoverCost: number
  orders: number
  avgPrice: number
  byMenu: MenuStat[]
  series: DaySeriesPoint[]
}

function inRange(d: string, from: string, to: string) {
  return d >= from && d <= to
}

export function summarize(state: AppState, from: string, to: string): Summary {
  const sales = state.sales.filter((s) => inRange(s.date, from, to))
  const productions = state.productions.filter((p) => inRange(p.date, from, to))
  const purchases = state.purchases.filter((p) => inRange(p.date, from, to))
  const wastes = state.wastes.filter((w) => inRange(w.date, from, to))

  const revenue = sales.reduce((s, x) => s + x.revenue, 0)
  const cogs = sales.reduce((s, x) => s + x.cost, 0)
  const qtySold = sales.reduce((s, x) => s + x.qty, 0)
  const productionCost = productions.reduce((s, x) => s + x.totalCost, 0)
  const materialCost = productions.reduce((s, x) => s + x.materialCost, 0)
  const overheadCost = productions.reduce((s, x) => s + x.overheadCost, 0)
  const qtyProduced = productions.reduce((s, x) => s + x.qty, 0)
  const purchaseSpend = purchases.reduce((s, x) => s + x.total, 0)
  const wasteCost = wastes.reduce((s, x) => s + x.cost, 0)
  const qtyWasted = wastes.reduce((s, x) => s + x.qty, 0)

  const leftovers = state.lots.filter((l) => l.remaining > 1e-9 && inRange(l.date, from, to))
  const leftoverQty = leftovers.reduce((s, l) => s + l.remaining, 0)
  const leftoverCost = leftovers.reduce((s, l) => s + l.remaining * (l.originalCostPerUnit ?? l.costPerUnit), 0)

  const menuMap = new Map<string, MenuStat>()
  for (const s of sales) {
    const cur = menuMap.get(s.recipeId) ?? {
      recipeId: s.recipeId,
      name: s.recipeName,
      unit: s.unit,
      qty: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
    }
    cur.qty += s.qty
    cur.revenue += s.revenue
    cur.cost += s.cost
    cur.profit = cur.revenue - cur.cost
    menuMap.set(s.recipeId, cur)
  }

  const series: DaySeriesPoint[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dayRevenue = sales.filter((s) => s.date === d).reduce((s, x) => s + x.revenue, 0)
    const dayCost = productions.filter((p) => p.date === d).reduce((s, x) => s + x.totalCost, 0)
    series.push({ date: d, revenue: dayRevenue, cost: dayCost, profit: dayRevenue - dayCost })
    if (series.length > 400) break // กันลูปยาวผิดปกติ
  }

  return {
    from,
    to,
    revenue,
    cogs,
    grossProfit: revenue - cogs,
    productionCost,
    materialCost,
    overheadCost,
    purchaseSpend,
    wasteCost,
    netProfit: revenue - productionCost,
    qtySold,
    qtyProduced,
    qtyWasted,
    leftoverQty,
    leftoverCost,
    orders: sales.length,
    avgPrice: qtySold > 0 ? revenue / qtySold : 0,
    byMenu: [...menuMap.values()].sort((a, b) => b.revenue - a.revenue),
    series,
  }
}

/** มูลค่าสต็อกวัตถุดิบทั้งหมดที่ค้างอยู่ในร้าน */
export function stockValue(items: Item[]): number {
  return items.reduce((s, i) => s + i.stock * (i.avgCost || i.lastCost || 0), 0)
}

/** วัตถุดิบที่ใกล้หมด — เรียงจากวิกฤตที่สุด */
export function lowStockItems(items: Item[]): Item[] {
  return items
    .filter((i) => (i.lowStock ?? 0) > 0 && i.stock <= (i.lowStock ?? 0))
    .sort((a, b) => a.stock / (a.lowStock || 1) - b.stock / (b.lowStock || 1))
}
