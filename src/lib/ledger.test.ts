import { describe, expect, it } from 'vitest'
import type { AppState, CoreState } from '../types'
import { buildLedger, ledgerToCsv, ledgerToJson, ledgerTotals } from './ledger'
import { runCommand } from './engine'
import { parseLine } from './parser'
import { DEFAULT_SETTINGS } from './store'

const DAY1 = '2026-08-09'
const DAY2 = '2026-08-10'

function emptyCore(): CoreState {
  return {
    items: [],
    purchases: [],
    recipes: [],
    productions: [],
    lots: [],
    sales: [],
    wastes: [],
    transactions: [],
    settings: { ...DEFAULT_SETTINGS },
  }
}

function run(core: CoreState, date: string, ...lines: string[]): CoreState {
  let next = core
  for (const line of lines) next = runCommand(next, parseLine(line), date).core
  return next
}

function asState(core: CoreState): AppState {
  return { ...core, chat: [], snapshots: [] }
}

/** ร้านตัวอย่าง: ซื้อของวันที่ 1 ตั้งสูตร ผลิตและขายวันที่ 2 */
function shop(): AppState {
  let core = run(
    emptyCore(),
    DAY1,
    'ซื้อกล่อง p39 1 ลัง ลังละ 1000 กล่อง ราคารวม 1680 บาท',
    'ซื้อมะม่วง 3 กิโล ราคารวม 112 บาท',
    'ซื้อแป้งเค้ก 2 กก. 90 บาท',
    'สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม, แป้งเค้ก 800 กรัม, กล่อง p39 20 กล่อง',
  )
  core = {
    ...core,
    recipes: core.recipes.map((r) => ({ ...r, overhead: { labor: 300, water: 20, electric: 60, misc: 40 } })),
  }
  core = run(core, DAY2, 'ทำเค้กมะม่วง 20 กล่อง', 'ขายเค้กมะม่วง 15 กล่อง กล่องละ 120 บาท')
  return asState(core)
}

const OPTS = { from: DAY1, to: DAY2, mode: 'daily' as const, includeOverhead: false }

describe('สร้างรายการรายรับ-รายจ่าย', () => {
  it('ยอดขายเป็นรายรับ ยอดซื้อของเป็นรายจ่าย', () => {
    const rows = buildLedger(shop(), OPTS)
    const income = rows.filter((r) => r.kind === 'income')
    const expense = rows.filter((r) => r.kind === 'expense')

    expect(income).toHaveLength(1)
    expect(income[0]).toMatchObject({ date: DAY2, category: 'ขายขนม', detail: 'เค้กมะม่วง', amount: 1800 })
    expect(income[0].note).toContain('15')

    // ซื้อของวันเดียวกัน แยกตามหมวด: บรรจุภัณฑ์ 1680 · ของสด 112 · ของแห้ง 90
    expect(expense.map((r) => r.category).sort()).toEqual(['ซื้อของสด', 'ซื้อของแห้ง', 'ซื้อบรรจุภัณฑ์'])
    expect(expense.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(1882, 6)
  })

  it('ยอดรวมสรุปถูกต้อง', () => {
    const totals = ledgerTotals(buildLedger(shop(), OPTS))
    expect(totals.income).toBe(1800)
    expect(totals.expense).toBeCloseTo(1882, 6)
    expect(totals.net).toBeCloseTo(-82, 6)
  })

  it('ปกติไม่รวมค่าแรง/ค่าน้ำ/ค่าไฟ เพื่อกันบันทึกซ้ำกับบิลจริง', () => {
    const rows = buildLedger(shop(), OPTS)
    expect(rows.some((r) => r.category === 'ค่าแรง')).toBe(false)
  })

  it('เปิดใช้ค่าแรง/ค่าน้ำ/ค่าไฟได้เมื่อต้องการ', () => {
    const rows = buildLedger(shop(), { ...OPTS, includeOverhead: true })
    const overhead = rows.filter((r) => ['ค่าแรง', 'ค่าน้ำ', 'ค่าไฟ', 'ค่าจิปาถะ'].includes(r.category))
    expect(overhead).toHaveLength(4)
    expect(overhead.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(420, 6)
    expect(overhead.every((r) => r.date === DAY2)).toBe(true)
  })

  it('โหมดรายละเอียดออกทีละรายการที่บันทึกไว้', () => {
    const rows = buildLedger(shop(), { ...OPTS, mode: 'detail' })
    // ซื้อ 3 ครั้ง + ขาย 1 ครั้ง
    expect(rows).toHaveLength(4)
    expect(rows.filter((r) => r.kind === 'expense').map((r) => r.detail).sort()).toEqual(
      ['กล่อง p39', 'มะม่วง', 'แป้งเค้ก'].sort(),
    )
  })

  it('กรองตามช่วงวันที่ที่เลือก', () => {
    const onlyDay2 = buildLedger(shop(), { ...OPTS, from: DAY2, to: DAY2 })
    expect(onlyDay2.every((r) => r.date === DAY2)).toBe(true)
    expect(onlyDay2.filter((r) => r.kind === 'expense')).toHaveLength(0)
  })

  it('เรียงตามวัน และให้รายรับมาก่อนรายจ่ายในวันเดียวกัน', () => {
    const core = run(
      emptyCore(),
      DAY2,
      'ซื้อมะม่วง 1 กิโล 40 บาท',
      'สูตรเค้ก ได้ 10 กล่อง ใช้ มะม่วง 500 กรัม',
      'ทำเค้ก 10 กล่อง',
      'ขายเค้ก 10 กล่อง กล่องละ 50',
    )
    const rows = buildLedger(asState(core), OPTS)
    expect(rows[0].kind).toBe('income')
    expect(rows[1].kind).toBe('expense')
  })

  it('ชื่อเมนูที่มีช่องว่างต้องไม่ถูกตัดตอน', () => {
    const core = run(
      emptyCore(),
      DAY2,
      'ซื้อมะม่วง 1 กิโล 40 บาท',
      'สูตรเค้ก มะม่วง สด ได้ 10 กล่อง ใช้ มะม่วง 500 กรัม',
      'ทำเค้ก มะม่วง สด 10 กล่อง',
      'ขายเค้ก มะม่วง สด 10 กล่อง กล่องละ 50',
    )
    const income = buildLedger(asState(core), OPTS).filter((r) => r.kind === 'income')
    expect(income).toHaveLength(1)
    expect(income[0].detail).toBe('เค้ก มะม่วง สด')
  })
})

describe('แปลงเป็นไฟล์', () => {
  it('CSV มี BOM และหัวตารางภาษาไทย เปิดใน Excel ได้ถูกต้อง', () => {
    const csv = ledgerToCsv(buildLedger(shop(), OPTS))
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.split('\r\n')[0]).toBe('﻿วันที่,ประเภท,หมวดหมู่,รายการ,จำนวนเงิน,หมายเหตุ')
    expect(csv).toContain('รายรับ,ขายขนม,เค้กมะม่วง,1800.00')
  })

  it('ครอบเครื่องหมายคำพูดเมื่อข้อความมีคอมมา', () => {
    const csv = ledgerToCsv([
      { date: DAY2, kind: 'expense', category: 'ซื้อของสด', detail: '2 รายการ', amount: 50, note: 'มะม่วง, แป้ง' },
    ])
    expect(csv).toContain('"มะม่วง, แป้ง"')
  })

  it('หนีเครื่องหมายคำพูดที่อยู่ในข้อความ', () => {
    const csv = ledgerToCsv([
      { date: DAY2, kind: 'income', category: 'ขายขนม', detail: 'เค้ก "พิเศษ"', amount: 10, note: '' },
    ])
    expect(csv).toContain('"เค้ก ""พิเศษ"""')
  })

  it('JSON ระบุ schema ช่วงวันที่ และยอดรวมไว้ให้ระบบปลายทางตรวจสอบได้', () => {
    const rows = buildLedger(shop(), OPTS)
    const data = JSON.parse(ledgerToJson(rows, OPTS))
    expect(data.schema).toBe('bakery-ledger/v1')
    expect(data.currency).toBe('THB')
    expect(data.range).toEqual({ from: DAY1, to: DAY2 })
    expect(data.totals.income).toBe(1800)
    expect(data.rows).toHaveLength(rows.length)
  })
})
