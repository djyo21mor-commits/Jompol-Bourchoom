import { describe, expect, it } from 'vitest'
import type { CoreState } from '../types'
import { commitPendingRecipe, deleteByMessage, runCommand } from './engine'
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
    assets: [],
    settings: { ...DEFAULT_SETTINGS },
  }
}

/** พิมพ์ 1 บรรทัดโดยผูกกับไอดีข้อความที่กำหนด เหมือนตอนพิมพ์ในแชทจริง */
function say(core: CoreState, msgId: string, date: string, line: string, channel: 'shop' | 'money' = 'shop'): CoreState {
  let next = runCommand(core, parseLine(line, channel), date, msgId).core
  if (next.pendingRecipe) next = commitPendingRecipe(next).core
  return next
}

const itemNamed = (core: CoreState, name: string) => core.items.find((i) => i.name === name)!

describe('ลบข้อความแล้วถอนข้อมูลที่ข้อความนั้นสร้างไว้', () => {
  it('ลบการซื้อของ — สต็อกและต้นทุนเฉลี่ยกลับไปเท่าเดิม', () => {
    let core = say(emptyCore(), 'm1', DAY1, 'ซื้อมะม่วง 3 กิโล ราคารวม 300 บาท')
    core = say(core, 'm2', DAY1, 'ซื้อมะม่วง 1 กิโล ราคารวม 200 บาท')
    expect(itemNamed(core, 'มะม่วง').stock).toBe(4000)

    const res = deleteByMessage(core, 'm2')
    expect(res.changed).toBe(true)
    expect(res.core.purchases).toHaveLength(1)

    const mango = itemNamed(res.core, 'มะม่วง')
    expect(mango.stock).toBe(3000)
    expect(mango.avgCost).toBeCloseTo(0.1, 6) // 300 บาท / 3000 กรัม
  })

  it('ลบการผลิต — วัตถุดิบกลับเข้าสต็อก และล็อตขนมหายไป', () => {
    let core = say(emptyCore(), 'm1', DAY1, 'ซื้อมะม่วง 3 กิโล ราคารวม 300 บาท')
    core = say(core, 'm2', DAY1, 'สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม')
    core = say(core, 'm3', DAY2, 'ทำเค้กมะม่วง 20 กล่อง')
    expect(itemNamed(core, 'มะม่วง').stock).toBe(1500)
    expect(core.lots).toHaveLength(1)

    const res = deleteByMessage(core, 'm3')
    expect(res.core.productions).toHaveLength(0)
    expect(res.core.lots).toHaveLength(0)
    expect(itemNamed(res.core, 'มะม่วง').stock).toBe(3000)
    // สูตรยังอยู่ ลบเฉพาะสิ่งที่ข้อความนั้นทำ
    expect(res.core.recipes).toHaveLength(1)
  })

  it('ลบการขาย — ของกลับเข้าล็อตเดิม ยอดขายหายจากสรุป', () => {
    let core = say(emptyCore(), 'm1', DAY1, 'ซื้อมะม่วง 3 กิโล ราคารวม 300 บาท')
    core = say(core, 'm2', DAY1, 'สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม')
    core = say(core, 'm3', DAY2, 'ทำเค้กมะม่วง 20 กล่อง')
    core = say(core, 'm4', DAY2, 'ขายเค้กมะม่วง 15 กล่อง กล่องละ 120')
    expect(core.lots[0].remaining).toBe(5)

    const res = deleteByMessage(core, 'm4')
    expect(res.core.sales).toHaveLength(0)
    expect(res.core.lots[0].remaining).toBe(20)
    // การผลิตของอีกข้อความยังอยู่
    expect(res.core.productions).toHaveLength(1)
  })

  it('ลบของยกมา — จำนวนกลับเข้าล็อตต้นทาง', () => {
    let core = say(emptyCore(), 'm1', DAY1, 'ซื้อมะม่วง 3 กิโล ราคารวม 300 บาท')
    core = say(core, 'm2', DAY1, 'สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม')
    core = say(core, 'm3', DAY2, 'ทำเค้กมะม่วง 20 กล่อง')
    core = say(core, 'm4', DAY2, 'เหลือเค้กมะม่วง 5 กล่อง')
    expect(core.lots).toHaveLength(2)

    const res = deleteByMessage(core, 'm4')
    expect(res.core.lots).toHaveLength(1)
    expect(res.core.lots[0].remaining).toBe(20)
  })

  it('ลบของเสีย — ของกลับเข้าล็อต', () => {
    let core = say(emptyCore(), 'm1', DAY1, 'ซื้อมะม่วง 3 กิโล ราคารวม 300 บาท')
    core = say(core, 'm2', DAY1, 'สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม')
    core = say(core, 'm3', DAY2, 'ทำเค้กมะม่วง 20 กล่อง')
    core = say(core, 'm4', DAY2, 'ทิ้งเค้กมะม่วง 3 กล่อง')
    expect(core.wastes).toHaveLength(1)
    expect(core.lots[0].remaining).toBe(17)

    const res = deleteByMessage(core, 'm4')
    expect(res.core.wastes).toHaveLength(0)
    expect(res.core.lots[0].remaining).toBe(20)
  })

  it('ลบรายจ่ายที่พิมพ์ในช่องเงิน — รายการหายไป แต่หมวดที่จำไว้ยังอยู่', () => {
    const core = say(emptyCore(), 'm1', DAY2, 'จ่ายค่าเช่าร้าน 5000 บาท', 'money')
    expect(core.transactions).toHaveLength(1)

    const res = deleteByMessage(core, 'm1')
    expect(res.core.transactions).toHaveLength(0)
    expect(res.removed.join(' ')).toContain('ค่าเช่าร้าน')
    expect(res.core.settings.categories.some((c) => c.name === 'ค่าเช่าร้าน')).toBe(true)
  })

  it('ลบทรัพย์สิน — ทั้งทรัพย์สินและรายจ่ายที่คู่กันหายไปพร้อมกัน', () => {
    const core = say(emptyCore(), 'm1', DAY2, 'ซื้อทองคำ จำนวน 10000 บาท ที่ราคาบาทละ 65000 บาท', 'money')
    expect(core.assets).toHaveLength(1)
    expect(core.transactions).toHaveLength(1)

    const res = deleteByMessage(core, 'm1')
    expect(res.core.assets).toHaveLength(0)
    expect(res.core.transactions).toHaveLength(0)
  })

  it('ข้อความที่ไม่ได้สร้างข้อมูลอะไร ลบแล้วไม่กระทบของเดิม', () => {
    const core = say(emptyCore(), 'm1', DAY1, 'ซื้อมะม่วง 3 กิโล ราคารวม 300 บาท')
    const res = deleteByMessage(core, 'ไม่มีข้อความนี้')
    expect(res.changed).toBe(false)
    expect(res.core.purchases).toHaveLength(1)
    expect(itemNamed(res.core, 'มะม่วง').stock).toBe(3000)
  })
})
