import type { BaseUnit } from '../types'

export interface UnitDef {
  /** หน่วยฐานที่แปลงไปเก็บ */
  base: BaseUnit
  /** 1 หน่วยนี้ = กี่หน่วยฐาน */
  factor: number
  /** ชื่อที่ใช้แสดงผล */
  label: string
  /** เป็นหน่วยบรรจุที่ข้างในมีของย่อยได้ เช่น ลัง แพ็ค โหล */
  container?: boolean
}

const REGISTRY = new Map<string, UnitDef>()

function reg(def: UnitDef, names: string[]) {
  for (const n of names) REGISTRY.set(n, def)
}

/* ------------------------------- น้ำหนัก ------------------------------- */
reg({ base: 'g', factor: 1, label: 'กรัม' }, ['กรัม', 'ก.', 'กร.', 'g', 'gram', 'grams', 'gm'])
reg({ base: 'g', factor: 100, label: 'ขีด' }, ['ขีด'])
reg({ base: 'g', factor: 1000, label: 'กก.' }, [
  'กิโลกรัม', 'กิโล', 'กิโลฯ', 'กก.', 'กก', 'โล', 'kg', 'kgs', 'kilo', 'kilogram',
])
reg({ base: 'g', factor: 453.592, label: 'ปอนด์' }, ['ปอนด์', 'lb', 'lbs', 'pound'])
reg({ base: 'g', factor: 28.3495, label: 'ออนซ์' }, ['ออนซ์', 'oz', 'ounce'])

/* ------------------------------- ปริมาตร ------------------------------- */
reg({ base: 'ml', factor: 1, label: 'มล.' }, ['มิลลิลิตร', 'มล.', 'มล', 'ml', 'ซีซี', 'cc'])
reg({ base: 'ml', factor: 1000, label: 'ลิตร' }, ['ลิตร', 'ล.', 'l', 'liter', 'litre', 'lt'])
reg({ base: 'ml', factor: 15, label: 'ช้อนโต๊ะ' }, ['ช้อนโต๊ะ', 'ชต.', 'ชต', 'ช.ต.', 'tbsp', 'tablespoon'])
reg({ base: 'ml', factor: 5, label: 'ช้อนชา' }, ['ช้อนชา', 'ชช.', 'ชช', 'ช.ช.', 'tsp', 'teaspoon'])
reg({ base: 'ml', factor: 240, label: 'ถ้วยตวง' }, ['ถ้วยตวง', 'cup', 'cups'])

/* -------------------------------- นับชิ้น ------------------------------- */
const COUNT_SIMPLE = [
  'ชิ้น', 'กล่อง', 'ใบ', 'ฟอง', 'ลูก', 'อัน', 'แผ่น', 'ขวด', 'กระปุก', 'ซอง',
  'ถุง', 'ห่อ', 'แพ็ค', 'แพค', 'แพ็ก', 'แพก', 'pack', 'ลัง', 'กระป๋อง', 'ถาด',
  'ม้วน', 'เส้น', 'ก้อน', 'หัว', 'ต้น', 'ผล', 'ชุด', 'แท่ง', 'ก้าน', 'ดอก',
  'กำ', 'มัด', 'พวง', 'ตัว', 'ถ้วย', 'แก้ว', 'กระสอบ', 'ถัง', 'หลอด', 'ฝา',
  'แผง', 'หวี', 'ซีก', 'ก๊อง', 'pcs', 'pc', 'piece', 'ea',
]
for (const n of COUNT_SIMPLE) {
  reg({ base: 'pcs', factor: 1, label: n }, [n])
}
reg({ base: 'pcs', factor: 12, label: 'โหล', container: true }, ['โหล', 'dozen'])
reg({ base: 'pcs', factor: 2, label: 'คู่' }, ['คู่'])
reg({ base: 'pcs', factor: 144, label: 'กุรุส' }, ['กุรุส', 'กูรุส'])

/** หน่วยที่ "ข้างในมีของย่อย" — ใช้ตัดสินว่า "ลังละ 1000 กล่อง" ฝั่งไหนเป็นตัวหุ้ม */
const CONTAINER_UNITS = new Set([
  'ลัง', 'แพ็ค', 'แพค', 'แพ็ก', 'แพก', 'pack', 'โหล', 'กระสอบ', 'ถัง', 'ชุด',
  'ถุง', 'ห่อ', 'กล่อง', 'ถาด', 'มัด', 'กระปุก', 'ขวด', 'กระป๋อง', 'ซอง', 'แผง',
])

export function isContainerUnit(name: string): boolean {
  return CONTAINER_UNITS.has(normalizeUnitName(name))
}

/** ตัดจุด/ช่องว่าง และแปลงเป็นตัวพิมพ์เล็ก เพื่อให้ค้นเจอง่ายขึ้น */
function normalizeUnitName(raw: string): string {
  return raw.trim().toLowerCase()
}

/** ค้นหานิยามของหน่วย — คืน null ถ้าไม่รู้จัก */
export function lookupUnit(raw: string): UnitDef | null {
  if (!raw) return null
  const key = normalizeUnitName(raw)
  const hit = REGISTRY.get(key)
  if (hit) return hit
  // ลองตัดจุดท้าย เช่น "กก" กับ "กก." ให้เจอทั้งคู่
  const noDot = key.replace(/\.+$/, '')
  return REGISTRY.get(noDot) ?? REGISTRY.get(noDot + '.') ?? null
}

export function isKnownUnit(raw: string): boolean {
  return lookupUnit(raw) !== null
}

/** แปลงจำนวน + หน่วย เป็นหน่วยฐาน */
export function toBase(qty: number, unitName: string): { qty: number; base: BaseUnit; label: string } | null {
  const def = lookupUnit(unitName)
  if (!def) return null
  return { qty: qty * def.factor, base: def.base, label: def.label }
}

/** หน่วยทั้งหมดที่ใช้กับหน่วยฐานนี้ได้ — ใช้ทำ dropdown ในฟอร์ม */
export function unitsForBase(base: BaseUnit): { name: string; factor: number }[] {
  if (base === 'g') {
    return [
      { name: 'กรัม', factor: 1 },
      { name: 'ขีด', factor: 100 },
      { name: 'ปอนด์', factor: 453.592 },
      { name: 'กก.', factor: 1000 },
    ]
  }
  if (base === 'ml') {
    return [
      { name: 'มล.', factor: 1 },
      { name: 'ช้อนชา', factor: 5 },
      { name: 'ช้อนโต๊ะ', factor: 15 },
      { name: 'ถ้วยตวง', factor: 240 },
      { name: 'ลิตร', factor: 1000 },
    ]
  }
  return [{ name: 'ชิ้น', factor: 1 }]
}

/**
 * หน่วยใหญ่ที่คนไทยใช้พูดถึงของชนิดนี้จริงๆ — กก. สำหรับของชั่ง, ลิตร สำหรับของตวง
 * ตั้งใจระบุตรงๆ แทนการหยิบตัวสุดท้ายของ unitsForBase เพราะลำดับใน dropdown อาจเปลี่ยนได้
 */
export function bigUnitFor(base: BaseUnit, unitLabel = 'ชิ้น'): { name: string; factor: number } {
  if (base === 'g') return { name: 'กก.', factor: 1000 }
  if (base === 'ml') return { name: 'ลิตร', factor: 1000 }
  return { name: unitLabel || 'ชิ้น', factor: 1 }
}

/** หน่วยที่คนทั่วไปใช้พูดถึงราคาทุน เช่น บาท/กก., บาท/กล่อง */
export function costUnitFor(base: BaseUnit, unitLabel: string): { label: string; factor: number } {
  if (base === 'g') return { label: 'กก.', factor: 1000 }
  if (base === 'ml') return { label: 'ลิตร', factor: 1000 }
  return { label: unitLabel || 'ชิ้น', factor: 1 }
}
