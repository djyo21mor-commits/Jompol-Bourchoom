import { describe, expect, it } from 'vitest'
import type { CoreState } from '../types'
import { cancelPendingRecipe, commitPendingRecipe, readDailySheet, recordDailySheet, runCommand } from './engine'
import { parseLine } from './parser'
import { DEFAULT_SETTINGS } from './store'
import { addDays } from './format'
import { finishedStock } from './calc'

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
    assets: [],
    settings: { ...DEFAULT_SETTINGS },
  }
}

function run(core: CoreState, date: string, ...lines: string[]): CoreState {
  let next = core
  for (const line of lines) {
    next = runCommand(next, parseLine(line), date).core
    if (next.pendingRecipe) next = commitPendingRecipe(next).core
  }
  return next
}

/** ร้านพร้อมใช้: ซื้อของครบ + สูตรเค้กมะม่วง 20 กล่อง ราคา 120 */
function shop(): CoreState {
  const core = run(
    emptyCore(),
    DAY1,
    'ซื้อกล่อง p39 1 ลัง ลังละ 1000 กล่อง ราคารวม 1680 บาท',
    'ซื้อมะม่วง 3 กิโล ราคารวม 112 บาท',
    'สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม, กล่อง p39 20 กล่อง',
  )
  return { ...core, recipes: core.recipes.map((r) => ({ ...r, price: 120 })) }
}

/* ========================================================================= */

describe('ช่องแชทแยกกัน', () => {
  it('ช่องเงินเข้าใจคำสั่งสั้น "ลูก 100" เป็นรายจ่าย', () => {
    const r = parseLine('ลูก 100', 'money') as any
    expect(r.kind).toBe('expense')
    expect(r.category).toBe('ลูก')
    expect(r.amount).toBe(100)
  })

  it('"กิน 100" ก็เป็นรายจ่ายหมวดกิน', () => {
    const r = parseLine('กิน 100', 'money') as any
    expect(r).toMatchObject({ kind: 'expense', category: 'กิน', amount: 100 })
  })

  it('ใส่ + นำหน้าเพื่อบอกว่าเป็นเงินเข้า', () => {
    const r = parseLine('+ รับจ้างทำเค้ก 800', 'money') as any
    expect(r).toMatchObject({ kind: 'income', category: 'รับจ้างทำเค้ก', amount: 800 })
  })

  it('สลับลำดับเป็น "100 ลูก" ก็อ่านได้', () => {
    const r = parseLine('100 ลูก', 'money') as any
    expect(r).toMatchObject({ kind: 'expense', category: 'ลูก', amount: 100 })
  })

  it('ช่องของขายไม่ตีความคำสั้นเป็นเงิน เพราะอาจหมายถึงจำนวนของ', () => {
    const r = parseLine('มะม่วง 3', 'shop') as any
    expect(r.kind).toBe('unknown')
  })

  it('ช่องเงินยังรับคำสั่งเต็มรูปแบบได้เหมือนเดิม', () => {
    expect((parseLine('จ่ายค่าเช่าร้าน 5000 บาท', 'money') as any).category).toBe('ค่าเช่าร้าน')
    expect((parseLine('ซื้อทรัพย์สินทองคำ จำนวน 10000 บาท ที่ราคาบาทละ 65000 บาท', 'money') as any).kind).toBe('asset')
  })
})

describe('บอทถามยืนยันก่อนบันทึกสูตร', () => {
  it('พิมพ์สูตรแล้วยังไม่บันทึก รอให้ยืนยันก่อน', () => {
    const res = runCommand(emptyCore(), parseLine('สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม'), DAY1)
    expect(res.changed).toBe(false)
    expect(res.core.recipes).toHaveLength(0)
    expect(res.core.pendingRecipe?.name).toBe('เค้กมะม่วง')
    expect(res.messages[0].text).toContain('ถูกต้องแล้วใช่ไหม')
    expect(res.messages[0].actions?.map((a) => a.kind)).toEqual(['confirmRecipe', 'cancelRecipe'])
  })

  it('บอกด้วยว่าขาดอะไร — ยังไม่รู้ราคา และไม่มีบรรจุภัณฑ์', () => {
    const res = runCommand(emptyCore(), parseLine('สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม'), DAY1)
    const warn = res.messages.find((m) => m.text.includes('ยังขาดอยู่'))!
    expect(warn).toBeTruthy()
    const text = warn.details!.map((d) => d.value).join(' | ')
    expect(text).toContain('ยังไม่รู้ราคาของ มะม่วง')
    expect(text).toContain('บรรจุภัณฑ์')
  })

  it('สูตรที่ครบแล้ว บอกว่าไม่มีอะไรขาด', () => {
    const core = run(emptyCore(), DAY1, 'ซื้อมะม่วง 3 กิโล 112 บาท', 'ซื้อกล่อง p39 100 กล่อง 168 บาท')
    const res = runCommand(
      core,
      parseLine('สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม, กล่อง p39 20 กล่อง'),
      DAY1,
    )
    expect(res.messages.some((m) => m.text.includes('ครบ ไม่มีอะไรขาด'))).toBe(true)
  })

  it('ยืนยันแล้วบันทึกจริง พร้อมรายงานต้นทุนต่อกล่องกลับมา', () => {
    const core = run(emptyCore(), DAY1, 'ซื้อมะม่วง 3 กิโล 112 บาท')
    const asked = runCommand(core, parseLine('สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม'), DAY1)
    const done = commitPendingRecipe(asked.core)

    expect(done.changed).toBe(true)
    expect(done.core.recipes).toHaveLength(1)
    expect(done.core.pendingRecipe).toBeUndefined()

    const labels = done.messages[0].details!.map((d) => d.label)
    expect(labels.some((l) => l.startsWith('ต้นทุนรวมต่อ'))).toBe(true)
    expect(labels).toContain('ราคาขายที่แนะนำ')
  })

  it('ตอบ "ใช่" ในแชทก็ยืนยันได้ ไม่ต้องกดปุ่ม', () => {
    const core = run(emptyCore(), DAY1, 'ซื้อมะม่วง 3 กิโล 112 บาท')
    const asked = runCommand(core, parseLine('สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม'), DAY1)
    const done = runCommand(asked.core, parseLine('ใช่'), DAY1)
    expect(done.core.recipes).toHaveLength(1)
  })

  it('ตอบ "ไม่ใช่" แล้วสูตรถูกทิ้ง ไม่ค้างอยู่', () => {
    const asked = runCommand(emptyCore(), parseLine('สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม'), DAY1)
    const cancelled = cancelPendingRecipe(asked.core)
    expect(cancelled.core.pendingRecipe).toBeUndefined()
    expect(cancelled.core.recipes).toHaveLength(0)
  })
})

describe('ตารางรายวัน — ขายได้ = ทำ − เหลือ', () => {
  const recipeId = () => shop().recipes[0].id

  it('คิดยอดขายจากที่ทำลบที่เหลือให้เอง', () => {
    const core = shop()
    const res = recordDailySheet(core, {
      recipeId: core.recipes[0].id,
      date: DAY2,
      produced: 20,
      leftover: 5,
      unitPrice: 120,
    })
    const sale = res.core.sales[0]
    expect(sale.qty).toBe(15)
    expect(sale.revenue).toBe(1800)

    const row = readDailySheet(res.core, DAY2)[0]
    expect(row).toMatchObject({ produced: 20, leftover: 5, sold: 15, revenue: 1800 })
  })

  it('ตัดสต็อกวัตถุดิบตามจำนวนที่ทำจริง', () => {
    const core = shop()
    const res = recordDailySheet(core, { recipeId: core.recipes[0].id, date: DAY2, produced: 20, leftover: 0, unitPrice: 120 })
    const byName = Object.fromEntries(res.core.items.map((i) => [i.name, i]))
    expect(byName['มะม่วง'].stock).toBe(1500)
    expect(byName['กล่อง p39'].stock).toBe(980)
  })

  it('แก้ตัวเลขซ้ำได้ ไม่บวกทับของเดิม', () => {
    const core = shop()
    const id = core.recipes[0].id
    let next = recordDailySheet(core, { recipeId: id, date: DAY2, produced: 20, leftover: 0, unitPrice: 120 }).core
    next = recordDailySheet(next, { recipeId: id, date: DAY2, produced: 10, leftover: 2, unitPrice: 120 }).core

    expect(next.productions.filter((p) => p.date === DAY2)).toHaveLength(1)
    expect(next.sales.filter((s) => s.date === DAY2)).toHaveLength(1)
    expect(next.sales[0].qty).toBe(8)
    // สต็อกต้องกลับไปคิดจากยอดใหม่ ไม่ใช่ 20+10
    const byName = Object.fromEntries(next.items.map((i) => [i.name, i]))
    expect(byName['มะม่วง'].stock).toBe(3000 - 750)
    expect(byName['กล่อง p39'].stock).toBe(1000 - 10)
  })

  it('ของเหลือยกไปขายวันถัดไป โดยไม่คิดต้นทุนซ้ำ', () => {
    const core = shop()
    const res = recordDailySheet(core, { recipeId: core.recipes[0].id, date: DAY2, produced: 20, leftover: 5, unitPrice: 120 })
    const carried = res.core.lots.find((l) => l.carriedOver)!
    expect(carried.qty).toBe(5)
    expect(carried.costPerUnit).toBe(0)
    expect(carried.sellDate).toBe(addDays(DAY2, 1))
    expect(finishedStock(res.core.lots, core.recipes[0].id, addDays(DAY2, 1))).toBe(5)
  })

  it('ใส่ 0 เป็นการล้างยอดของวันนั้น และคืนสต็อกกลับ', () => {
    const core = shop()
    const id = core.recipes[0].id
    let next = recordDailySheet(core, { recipeId: id, date: DAY2, produced: 20, leftover: 0, unitPrice: 120 }).core
    next = recordDailySheet(next, { recipeId: id, date: DAY2, produced: 0, leftover: 0, unitPrice: 120 }).core

    expect(next.productions.filter((p) => p.date === DAY2)).toHaveLength(0)
    expect(next.sales.filter((s) => s.date === DAY2)).toHaveLength(0)
    expect(next.items.find((i) => i.name === 'มะม่วง')!.stock).toBe(3000)
  })

  it('เหลือมากกว่าที่ทำ ถูกจำกัดไว้ไม่ให้ยอดขายติดลบ', () => {
    const core = shop()
    const res = recordDailySheet(core, { recipeId: core.recipes[0].id, date: DAY2, produced: 10, leftover: 99, unitPrice: 120 })
    expect(res.core.sales.filter((s) => s.date === DAY2)).toHaveLength(0)
    expect(readDailySheet(res.core, DAY2)[0].sold).toBe(0)
  })

  it('เมนูทุกอันโผล่ในตาราง แม้วันนั้นยังไม่ได้ทำ', () => {
    const rows = readDailySheet(shop(), DAY2)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'เค้กมะม่วง', produced: 0, sold: 0 })
    expect(recipeId()).toBeTruthy()
  })
})

describe('ทรัพย์สิน', () => {
  it('คิดปริมาณที่ได้จากเงินที่จ่าย ÷ ราคาต่อหน่วย', () => {
    const r = parseLine('ซื้อทรัพย์สินทองคำ จำนวน 10000 บาท ที่ราคาบาทละ 65000 บาท', 'money') as any
    expect(r.kind).toBe('asset')
    expect(r.name).toBe('ทองคำ')
    expect(r.amount).toBe(10000)
    expect(r.unitPrice).toBe(65000)

    const core = run(emptyCore(), DAY2, 'ซื้อทรัพย์สินทองคำ จำนวน 10000 บาท ที่ราคาบาทละ 65000 บาท')
    const asset = core.assets[0]
    expect(asset.name).toBe('ทองคำ')
    expect(asset.amount).toBe(10000)
    expect(asset.unitPrice).toBe(65000)
    expect(asset.qty).toBeCloseTo(10000 / 65000, 8)
    expect(asset.unitLabel).toBe('บาท')
  })

  it('เงินที่จ่ายซื้อทรัพย์สิน ถูกบันทึกเป็นรายจ่ายด้วย เพราะเงินออกจากกระเป๋าจริง', () => {
    const core = run(emptyCore(), DAY2, 'ซื้อทรัพย์สินทองคำ จำนวน 10000 บาท ที่ราคาบาทละ 65000 บาท')
    expect(core.transactions).toHaveLength(1)
    expect(core.transactions[0]).toMatchObject({ kind: 'expense', category: 'ซื้อทรัพย์สิน', amount: 10000 })
  })
})

describe('ผู้บันทึกสองคน', () => {
  it('จดชื่อคนที่บันทึกไว้ในทุกรายการเงิน', () => {
    const core = { ...emptyCore(), settings: { ...DEFAULT_SETTINGS, people: ['สามี', 'ภรรยา'], currentPerson: 'ภรรยา' } }
    const next = run(core, DAY2, 'จ่ายค่าเช่าร้าน 5000 บาท')
    expect(next.transactions[0].by).toBe('ภรรยา')
  })
})
