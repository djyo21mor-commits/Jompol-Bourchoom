import { describe, expect, it } from 'vitest'
import type { AppState, CoreState } from '../types'
import { runCommand } from './engine'
import { parseLine } from './parser'
import { buildLedger, ledgerTotals } from './ledger'
import { buildMoneyEntries, groupByDay, monthLabel, monthRange, shiftMonth, summarizeMoney } from './money'
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

const asState = (core: CoreState): AppState => ({ ...core, chat: [], snapshots: [] })

/** ร้านที่มีทั้งการขาย การซื้อของ และค่าใช้จ่ายอื่น */
function shop(): CoreState {
  let core = run(
    emptyCore(),
    DAY1,
    'ซื้อมะม่วง 3 กิโล ราคารวม 112 บาท',
    'สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม',
  )
  core = run(core, DAY2, 'ทำเค้กมะม่วง 20 กล่อง', 'ขายเค้กมะม่วง 15 กล่อง กล่องละ 120 บาท')
  core = run(core, DAY2, 'จ่ายค่าเช่าร้าน 5000 บาท', 'ค่าไฟ 1200 บาท', 'รับเงินค่าจ้างทำเค้ก 800 บาท')
  return core
}

describe('อ่านคำสั่งรายรับ-รายจ่ายจากแชท', () => {
  const p = (t: string) => parseLine(t) as any

  it('จ่ายค่าอะไร เท่าไหร่', () => {
    const r = p('จ่ายค่าเช่าร้าน 5000 บาท')
    expect(r.kind).toBe('expense')
    expect(r.category).toBe('ค่าเช่าร้าน')
    expect(r.amount).toBe(5000)
  })

  it('พิมพ์ขึ้นต้นด้วย "ค่า" ตรงๆ ก็ได้ ไม่ต้องมีคำว่าจ่าย', () => {
    const r = p('ค่าไฟ 1200')
    expect(r.kind).toBe('expense')
    expect(r.category).toBe('ค่าไฟ')
    expect(r.amount).toBe(1200)
  })

  it('รับเงินเข้าเป็นรายรับ', () => {
    const r = p('รับเงินค่าจ้างทำเค้ก 800 บาท')
    expect(r.kind).toBe('income')
    expect(r.category).toBe('ค่าจ้างทำเค้ก')
    expect(r.amount).toBe(800)
  })

  it('แยกหมายเหตุออกจากชื่อหมวดได้', () => {
    const r = p('จ่ายค่าจ้างพนักงาน 3000 บาท สำหรับเดือนสิงหาคม')
    expect(r.category).toBe('ค่าจ้างพนักงาน')
    expect(r.detail).toBe('เดือนสิงหาคม')
    expect(r.amount).toBe(3000)
  })

  it('ไม่บอกจำนวนเงิน ให้บอกวิธีพิมพ์', () => {
    const r = p('จ่ายค่าเช่าร้าน')
    expect(r.kind).toBe('unknown')
    expect(r.reason).toContain('จำนวนเงิน')
  })

  it('"ซื้อ" ยังเป็นของเข้าสต็อกเหมือนเดิม ไม่กลายเป็นค่าใช้จ่ายลอยๆ', () => {
    const r = p('ซื้อมะม่วง 3 กิโล ราคารวม 112 บาท')
    expect(r.kind).toBe('purchase')
  })
})

describe('บันทึกรายรับ-รายจ่ายลงระบบ', () => {
  it('เก็บรายการและจำหมวดใหม่ไว้ให้เลือกครั้งหน้า', () => {
    const core = run(emptyCore(), DAY2, 'จ่ายค่าวัตถุดิบสำรอง 250 บาท')
    expect(core.transactions).toHaveLength(1)
    expect(core.transactions[0]).toMatchObject({ kind: 'expense', category: 'ค่าวัตถุดิบสำรอง', amount: 250 })
    expect(core.settings.expenseCategories).toContain('ค่าวัตถุดิบสำรอง')
  })

  it('หมวดที่มีอยู่แล้ว ไม่เพิ่มซ้ำ', () => {
    const before = DEFAULT_SETTINGS.expenseCategories.length
    const core = run(emptyCore(), DAY2, 'จ่ายค่าไฟ 1200 บาท', 'จ่ายค่าไฟ 900 บาท')
    expect(core.transactions).toHaveLength(2)
    expect(core.settings.expenseCategories).toHaveLength(before)
  })

  it('ย้อนกลับได้เหมือนคำสั่งอื่น', () => {
    const res = runCommand(emptyCore(), parseLine('จ่ายค่าเช่าร้าน 5000 บาท'), DAY2)
    expect(res.changed).toBe(true)
    expect(res.messages[0].undoable).toBe(true)
  })
})

describe('สมุดเงินรวมทุกทาง', () => {
  it('รวมยอดขาย ค่าซื้อของ และรายการที่บันทึกเอง ไว้ที่เดียว', () => {
    const entries = buildMoneyEntries(asState(shop()), DAY1, DAY2)
    const bySource = {
      sale: entries.filter((e) => e.source === 'sale').length,
      purchase: entries.filter((e) => e.source === 'purchase').length,
      manual: entries.filter((e) => e.source === 'manual').length,
    }
    expect(bySource).toEqual({ sale: 1, purchase: 1, manual: 3 })
  })

  it('สรุปยอดแยกที่มาให้เห็นว่าเงินมาจากไหนไปไหน', () => {
    const s = summarizeMoney(buildMoneyEntries(asState(shop()), DAY1, DAY2))
    expect(s.saleIncome).toBe(1800)
    expect(s.otherIncome).toBe(800)
    expect(s.income).toBe(2600)

    expect(s.purchaseExpense).toBe(112)
    expect(s.otherExpense).toBe(6200) // ค่าเช่า 5000 + ค่าไฟ 1200
    expect(s.expense).toBe(6312)

    expect(s.net).toBe(-3712)
  })

  it('ไม่นับค่าแรง/ค่าน้ำ/ค่าไฟที่ตั้งไว้ในสูตร เพราะไม่ใช่เงินที่จ่ายออกจริง', () => {
    let core = shop()
    core = { ...core, recipes: core.recipes.map((r) => ({ ...r, overhead: { labor: 999, water: 999, electric: 999, misc: 999 } })) }
    core = run(core, DAY2, 'ทำเค้กมะม่วง 20 กล่อง')
    const s = summarizeMoney(buildMoneyEntries(asState(core), DAY1, DAY2))
    // ค่าใช้จ่ายยังเท่าเดิม แม้ค่าแรงในสูตรจะสูงลิ่ว
    expect(s.expense).toBe(6312)
  })

  it('จัดกลุ่มตามวัน เรียงวันใหม่ขึ้นก่อน', () => {
    const days = groupByDay(buildMoneyEntries(asState(shop()), DAY1, DAY2))
    expect(days[0].date).toBe(DAY2)
    expect(days[1].date).toBe(DAY1)
    // วันที่ 1 มีแต่ค่าซื้อมะม่วง 112 บาท
    expect(days[1].net).toBe(-112)
  })

  it('สรุปตามหมวดหมู่ เรียงจากมากไปน้อย', () => {
    const s = summarizeMoney(buildMoneyEntries(asState(shop()), DAY1, DAY2))
    expect(s.byCategory[0]).toMatchObject({ category: 'ค่าเช่าร้าน', amount: 5000 })
    expect(s.byCategory.find((c) => c.category === 'ขายขนม')).toMatchObject({ amount: 1800 })
  })

  it('กรองตามช่วงวันที่', () => {
    const onlyDay1 = buildMoneyEntries(asState(shop()), DAY1, DAY1)
    expect(onlyDay1).toHaveLength(1)
    expect(onlyDay1[0].source).toBe('purchase')
  })
})

describe('ส่งออกไฟล์ต้องมีรายการที่บันทึกเองด้วย', () => {
  it('ค่าเช่าและค่าไฟไปอยู่ในไฟล์ที่ส่งออก', () => {
    const rows = buildLedger(asState(shop()), { from: DAY1, to: DAY2, mode: 'daily', includeOverhead: false })
    expect(rows.some((r) => r.category === 'ค่าเช่าร้าน' && r.amount === 5000)).toBe(true)
    expect(rows.some((r) => r.category === 'ค่าจ้างทำเค้ก' && r.kind === 'income')).toBe(true)
    const totals = ledgerTotals(rows)
    expect(totals.income).toBe(2600)
    expect(totals.expense).toBe(6312)
  })
})

describe('ตัวช่วยเรื่องเดือน', () => {
  it('หาช่วงต้นเดือนถึงสิ้นเดือนได้ถูก รวมเดือนกุมภาพันธ์ปีอธิกสุรทิน', () => {
    expect(monthRange('2026-08')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })

  it('เลื่อนเดือนข้ามปีได้', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })

  it('แสดงชื่อเดือนเป็น พ.ศ.', () => {
    expect(monthLabel('2026-08')).toBe('สิงหาคม 2569')
  })
})
