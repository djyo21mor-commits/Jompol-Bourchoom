import type { AppState, Category, Overhead } from '../types'
import { CATEGORY_LABEL, OVERHEAD_LABEL } from '../types'
import { baht, num } from './format'

/* ===========================================================================
   ส่งออกข้อมูลเป็น "รายการรายรับ-รายจ่าย" เพื่อนำไปลงในระบบบัญชีที่ใช้อยู่เดิม
   ตั้งใจให้เป็นรูปแบบกลางๆ ที่ระบบไหนก็นำเข้าได้ ไม่ผูกกับแอปใดแอปหนึ่ง
=========================================================================== */

/** 1 บรรทัดในสมุดรายรับ-รายจ่าย */
export interface LedgerRow {
  /** YYYY-MM-DD */
  date: string
  kind: 'income' | 'expense'
  /** หมวดหมู่ เช่น ขายขนม / ซื้อของสด / ค่าแรง */
  category: string
  /** ชื่อรายการ เช่น เค้กมะม่วง / กล่อง p39 */
  detail: string
  /** จำนวนเงินเป็นบวกเสมอ — ใช้คอลัมน์ kind บอกทิศทางแทน */
  amount: number
  note: string
}

export type LedgerMode = 'daily' | 'detail'

export interface LedgerOptions {
  from: string
  to: string
  /** daily = รวมยอดต่อวันต่อหมวด · detail = ทุกรายการที่บันทึกไว้ */
  mode: LedgerMode
  /**
   * รวมค่าแรง/ค่าน้ำ/ค่าไฟ/จิปาถะที่ตั้งไว้ในสูตรด้วยหรือไม่
   * ปกติปิดไว้ เพราะค่าพวกนี้เป็นค่าประมาณที่เฉลี่ยลงต้นทุน
   * และมักถูกบันทึกเป็นบิลจริงในระบบบัญชีอยู่แล้ว เปิดไว้จะกลายเป็นนับซ้ำ
   */
  includeOverhead: boolean
}

const KIND_LABEL: Record<LedgerRow['kind'], string> = { income: 'รายรับ', expense: 'รายจ่าย' }

function purchaseCategory(category: Category | undefined): string {
  return `ซื้อ${CATEGORY_LABEL[category ?? 'other']}`
}

/** รวมค่าใน map แบบ key -> ตัวเลข */
function bump<K>(map: Map<K, number>, key: K, value: number) {
  map.set(key, (map.get(key) ?? 0) + value)
}

export function buildLedger(state: AppState, opts: LedgerOptions): LedgerRow[] {
  const { from, to, mode, includeOverhead } = opts
  const within = (d: string) => d >= from && d <= to

  const sales = state.sales.filter((s) => within(s.date))
  const purchases = state.purchases.filter((p) => within(p.date))
  const productions = state.productions.filter((p) => within(p.date))
  const itemById = new Map(state.items.map((i) => [i.id, i]))

  const rows: LedgerRow[] = []

  if (mode === 'detail') {
    for (const s of sales) {
      rows.push({
        date: s.date,
        kind: 'income',
        category: 'ขายขนม',
        detail: s.recipeName,
        amount: s.revenue,
        note: `${num(s.qty)} ${s.unit} × ${baht(s.unitPrice, 2)} บาท`,
      })
    }
    for (const p of purchases) {
      rows.push({
        date: p.date,
        kind: 'expense',
        category: purchaseCategory(itemById.get(p.itemId)?.category),
        detail: p.itemName,
        amount: p.total,
        note: p.note ?? '',
      })
    }
  } else {
    // รวมยอดขายต่อวันต่อเมนู
    // รวมยอดขายต่อวันต่อเมนู — เก็บส่วนประกอบไว้ในค่า ไม่ถอดกลับจากคีย์
    // เพราะชื่อเมนูมีช่องว่างได้ การ split คีย์จะทำให้ชื่อขาดกลางคัน
    const salesByKey = new Map<string, { date: string; name: string; unit: string; qty: number; revenue: number }>()
    for (const s of sales) {
      const key = `${s.date}\u0000${s.recipeId}`
      const cur = salesByKey.get(key) ?? { date: s.date, name: s.recipeName, unit: s.unit, qty: 0, revenue: 0 }
      cur.qty += s.qty
      cur.revenue += s.revenue
      salesByKey.set(key, cur)
    }
    for (const v of salesByKey.values()) {
      rows.push({
        date: v.date,
        kind: 'income',
        category: 'ขายขนม',
        detail: v.name,
        amount: v.revenue,
        note: `ขายได้ ${num(v.qty)} ${v.unit}`,
      })
    }

    // รวมยอดซื้อต่อวันต่อหมวดหมู่ พร้อมไล่ชื่อของที่ซื้อไว้ในหมายเหตุ
    const buyByKey = new Map<string, { date: string; category: string; total: number; names: Set<string> }>()
    for (const p of purchases) {
      const category = purchaseCategory(itemById.get(p.itemId)?.category)
      const key = `${p.date}\u0000${category}`
      const cur = buyByKey.get(key) ?? { date: p.date, category, total: 0, names: new Set<string>() }
      cur.total += p.total
      cur.names.add(p.itemName)
      buyByKey.set(key, cur)
    }
    for (const v of buyByKey.values()) {
      const names = [...v.names]
      rows.push({
        date: v.date,
        kind: 'expense',
        category: v.category,
        detail: names.length === 1 ? names[0] : `${names.length} รายการ`,
        amount: v.total,
        note: names.join(', '),
      })
    }
  }

  if (includeOverhead) {
    const keys = Object.keys(OVERHEAD_LABEL) as (keyof Overhead)[]
    const byDay = new Map<string, { amounts: Map<keyof Overhead, number>; menus: Set<string> }>()
    for (const prod of productions) {
      const cur = byDay.get(prod.date) ?? { amounts: new Map(), menus: new Set<string>() }
      for (const k of keys) bump(cur.amounts, k, prod.overhead[k])
      cur.menus.add(prod.recipeName)
      byDay.set(prod.date, cur)
    }
    for (const [date, v] of byDay) {
      for (const k of keys) {
        const amount = v.amounts.get(k) ?? 0
        if (amount <= 0) continue
        rows.push({
          date,
          kind: 'expense',
          category: OVERHEAD_LABEL[k],
          detail: 'ต้นทุนการผลิต',
          amount,
          note: `จากการผลิต ${[...v.menus].join(', ')}`,
        })
      }
    }
  }

  // เรียงตามวัน แล้วให้รายรับขึ้นก่อนรายจ่ายในวันเดียวกัน
  return rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.kind === b.kind ? a.category.localeCompare(b.category, 'th') : a.kind === 'income' ? -1 : 1),
  )
}

export interface LedgerTotals {
  income: number
  expense: number
  net: number
  rows: number
}

export function ledgerTotals(rows: LedgerRow[]): LedgerTotals {
  const income = rows.filter((r) => r.kind === 'income').reduce((s, r) => s + r.amount, 0)
  const expense = rows.filter((r) => r.kind === 'expense').reduce((s, r) => s + r.amount, 0)
  return { income, expense, net: income - expense, rows: rows.length }
}

/* --------------------------------------------------------------------------
   แปลงเป็นไฟล์
-------------------------------------------------------------------------- */

const CSV_HEADER = ['วันที่', 'ประเภท', 'หมวดหมู่', 'รายการ', 'จำนวนเงิน', 'หมายเหตุ']

/** ครอบด้วยเครื่องหมายคำพูดเมื่อมีอักขระที่ทำให้คอลัมน์เพี้ยน */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * CSV ที่เปิดใน Excel ภาษาไทยแล้วไม่เป็นตัวยึกยือ
 * ต้องมี BOM นำหน้าและใช้ CRLF ขึ้นบรรทัดใหม่ ไม่งั้น Excel เดารหัสอักขระผิด
 */
export function ledgerToCsv(rows: LedgerRow[]): string {
  const lines = [
    CSV_HEADER,
    ...rows.map((r) => [r.date, KIND_LABEL[r.kind], r.category, r.detail, r.amount.toFixed(2), r.note]),
  ]
  return '﻿' + lines.map((cols) => cols.map(csvCell).join(',')).join('\r\n')
}

/** JSON สำหรับให้อีกระบบเขียนตัวนำเข้าเอง — โครงสร้างคงที่ อ้างอิงได้ */
export function ledgerToJson(rows: LedgerRow[], opts: LedgerOptions): string {
  return JSON.stringify(
    {
      source: 'ครัวขนม — ระบบต้นทุนร้านขนม',
      schema: 'bakery-ledger/v1',
      exportedAt: new Date().toISOString(),
      range: { from: opts.from, to: opts.to },
      mode: opts.mode,
      includesOverhead: opts.includeOverhead,
      currency: 'THB',
      totals: ledgerTotals(rows),
      rows,
    },
    null,
    2,
  )
}
