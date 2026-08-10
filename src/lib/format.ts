import type { BaseUnit } from '../types'
import { costUnitFor } from './units'

/** ตัดทศนิยมส่วนเกินทิ้ง แล้วคืนเป็นสตริงที่อ่านง่าย (1000 -> "1,000", 1.5 -> "1.5") */
export function num(value: number, maxDecimals = 2): string {
  if (!isFinite(value)) return '-'
  const rounded = Math.round(value * 10 ** maxDecimals) / 10 ** maxDecimals
  return rounded.toLocaleString('th-TH', { maximumFractionDigits: maxDecimals })
}

/** จำนวนเงินพร้อมทศนิยม 2 ตำแหน่งเมื่อจำเป็น */
export function baht(value: number, decimals?: number): string {
  const d = decimals ?? (Math.abs(value) < 100 && !Number.isInteger(value) ? 2 : Math.abs(value % 1) > 0 ? 2 : 0)
  return value.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d })
}

/** จำนวนเงินพร้อมหน่วย เช่น "1,680 บาท" */
export function money(value: number, decimals?: number): string {
  return `${baht(value, decimals)} บาท`
}

/**
 * แสดงปริมาณในหน่วยที่คนอ่านเข้าใจง่ายที่สุด
 * 2500 g -> "2.5 กก."   ·   400 g -> "400 ก."   ·   20 pcs -> "20 กล่อง"
 */
export function qtyText(qty: number, base: BaseUnit, unitLabel = 'ชิ้น'): string {
  if (base === 'g') {
    return Math.abs(qty) >= 1000 ? `${num(qty / 1000, 3)} กก.` : `${num(qty, 1)} ก.`
  }
  if (base === 'ml') {
    return Math.abs(qty) >= 1000 ? `${num(qty / 1000, 3)} ลิตร` : `${num(qty, 1)} มล.`
  }
  return `${num(qty, 2)} ${unitLabel}`
}

/** ปริมาณแบบละเอียด เช่น "2.5 กก. (2,500 ก.)" — ใช้ตอนต้องการความชัดเจน */
export function qtyTextFull(qty: number, base: BaseUnit, unitLabel = 'ชิ้น'): string {
  if (base === 'g' && Math.abs(qty) >= 1000) return `${num(qty / 1000, 3)} กก. (${num(qty, 0)} ก.)`
  if (base === 'ml' && Math.abs(qty) >= 1000) return `${num(qty / 1000, 3)} ลิตร (${num(qty, 0)} มล.)`
  return qtyText(qty, base, unitLabel)
}

/**
 * ต้นทุนต่อหน่วยที่คนพูดถึงกันจริง เช่น "37.33 บาท/กก." พร้อมวงเล็บหน่วยย่อย
 * ตอบโจทย์ "คิดต้นทุนต่อกิโลกรัมหรือต่อกรัมตามที่ต้องการ"
 */
export function costText(costPerBase: number, base: BaseUnit, unitLabel = 'ชิ้น'): string {
  const u = costUnitFor(base, unitLabel)
  const main = `${baht(costPerBase * u.factor, 2)} บาท/${u.label}`
  if (base === 'pcs') return main
  const sub = base === 'g' ? `${num(costPerBase, 4)} บาท/ก.` : `${num(costPerBase, 4)} บาท/มล.`
  return `${main} (${sub})`
}

/** วันที่วันนี้ในรูปแบบ YYYY-MM-DD ตามเวลาเครื่องผู้ใช้ */
export function today(): string {
  return toISODate(new Date())
}

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** บวก/ลบวันจากสตริง YYYY-MM-DD */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return toISODate(dt)
}

const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/** "2026-08-10" -> "10 ส.ค." (ใส่ปี พ.ศ. ถ้าไม่ใช่ปีปัจจุบัน) */
export function dateText(iso: string, withYear = false): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const base = `${d} ${TH_MONTH[m - 1]}`
  return withYear || y !== new Date().getFullYear() ? `${base} ${String((y + 543) % 100).padStart(2, '0')}` : base
}

/** ป้ายวันที่แบบเป็นกันเอง: วันนี้ / เมื่อวาน / 8 ส.ค. */
export function dayLabel(iso: string): string {
  const t = today()
  if (iso === t) return 'วันนี้'
  if (iso === addDays(t, -1)) return 'เมื่อวาน'
  if (iso === addDays(t, 1)) return 'พรุ่งนี้'
  return dateText(iso)
}

export function timeText(isoDateTime: string): string {
  const d = new Date(isoDateTime)
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
}

/** ตัดตัวเลขให้เป็นจำนวนจริงที่ปลอดภัย ไม่ NaN ไม่ Infinity */
export function safeNum(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : fallback
}
