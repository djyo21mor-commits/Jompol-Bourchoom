import { describe, expect, it } from 'vitest'
import type { CoreState } from '../types'
import { runCommand } from './engine'
import { parseLine } from './parser'
import { finishedStock, recipeCost, summarize, suggestPrice } from './calc'
import { DEFAULT_SETTINGS } from './store'
import { addDays } from './format'

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

/** สั่งงานหลายคำสั่งติดกัน เหมือนผู้ใช้พิมพ์ทีละบรรทัด */
function run(core: CoreState, date: string, ...lines: string[]): CoreState {
  let next = core
  for (const line of lines) next = runCommand(next, parseLine(line), date).core
  return next
}

/** ร้านตัวอย่าง: ซื้อของครบ + ตั้งสูตรเค้กมะม่วง 20 กล่อง */
function shopWithRecipe(): CoreState {
  const core = run(
    emptyCore(),
    DAY1,
    'ซื้อกล่อง p39 1 ลัง ลังละ 1000 กล่อง ราคารวม 1680 บาท',
    'ซื้อมะม่วง 3 กิโล ราคารวม 112 บาท',
    'ซื้อแป้งเค้ก 2 กก. 90 บาท',
    'สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม, แป้งเค้ก 800 กรัม, กล่อง p39 20 กล่อง',
  )
  // ใส่ค่าแรง/ค่าน้ำ/ค่าไฟ/จิปาถะ 420 บาทต่อรอบ
  return {
    ...core,
    recipes: core.recipes.map((r) => ({ ...r, overhead: { labor: 300, water: 20, electric: 60, misc: 40 }, price: 60 })),
  }
}

describe('บันทึกการซื้อ', () => {
  it('คิดต้นทุนต่อกล่องจากการซื้อยกลัง', () => {
    const core = run(emptyCore(), DAY1, 'ซื้อกล่อง p39 1 ลัง ลังละ 1000 กล่อง ราคารวม 1680 บาท')
    const item = core.items[0]
    expect(item.name).toBe('กล่อง p39')
    expect(item.category).toBe('packaging')
    expect(item.stock).toBe(1000)
    expect(item.avgCost).toBeCloseTo(1.68, 6)
    expect(core.purchases).toHaveLength(1)
  })

  it('ซื้อซ้ำคนละราคา ใช้ต้นทุนถัวเฉลี่ยเคลื่อนที่', () => {
    let core = run(emptyCore(), DAY1, 'ซื้อมะม่วง 1 กิโล 40 บาท')
    expect(core.items[0].avgCost).toBeCloseTo(0.04, 8)
    core = run(core, DAY2, 'ซื้อมะม่วง 1 กิโล 60 บาท')
    // (1000×0.04 + 60) ÷ 2000 = 0.05 บาท/กรัม
    expect(core.items[0].stock).toBe(2000)
    expect(core.items[0].avgCost).toBeCloseTo(0.05, 8)
    expect(core.items[0].lastCost).toBeCloseTo(0.06, 8)
  })

  it('ปฏิเสธเมื่อหน่วยขัดกับที่เคยบันทึกไว้ แทนที่จะทำสต็อกเพี้ยน', () => {
    const core = run(emptyCore(), DAY1, 'ซื้อมะม่วง 3 กิโล 112 บาท')
    const res = runCommand(core, parseLine('ซื้อมะม่วง 5 กล่อง 100 บาท'), DAY1)
    expect(res.changed).toBe(false)
    expect(res.core.items[0].stock).toBe(3000)
    expect(res.messages[0].tone).toBe('error')
  })
})

describe('ผลิตและตัดสต็อก', () => {
  it('ตัดวัตถุดิบตามสูตร และคิดต้นทุนต่อกล่องรวมค่าแรง', () => {
    const core = run(shopWithRecipe(), DAY2, 'ทำเค้กมะม่วง 20 กล่อง')
    const byName = Object.fromEntries(core.items.map((i) => [i.name, i]))
    expect(byName['มะม่วง'].stock).toBe(1500)
    expect(byName['แป้งเค้ก'].stock).toBe(1200)
    expect(byName['กล่อง p39'].stock).toBe(980)

    const prod = core.productions[0]
    // มะม่วง 56 + แป้ง 36 + กล่อง 33.6 = 125.6
    expect(prod.materialCost).toBeCloseTo(125.6, 6)
    expect(prod.overheadCost).toBeCloseTo(420, 6)
    expect(prod.costPerUnit).toBeCloseTo((125.6 + 420) / 20, 6)
    expect(core.lots[0].remaining).toBe(20)
  })

  it('ผลิตครึ่งรอบ ใช้วัตถุดิบและค่าแรงครึ่งเดียว', () => {
    const core = run(shopWithRecipe(), DAY2, 'ทำเค้กมะม่วง 10 กล่อง')
    const prod = core.productions[0]
    expect(prod.materialCost).toBeCloseTo(62.8, 6)
    expect(prod.overheadCost).toBeCloseTo(210, 6)
    // ต้นทุนต่อกล่องเท่าเดิม ไม่ว่าจะทำกี่กล่อง
    expect(prod.costPerUnit).toBeCloseTo(27.28, 6)
  })

  it('วัตถุดิบไม่พอ ยังบันทึกได้แต่เตือนว่าสต็อกติดลบ', () => {
    const res = runCommand(shopWithRecipe(), parseLine('ทำเค้กมะม่วง 60 กล่อง'), DAY2)
    expect(res.changed).toBe(true)
    expect(res.core.items.find((i) => i.name === 'มะม่วง')!.stock).toBeLessThan(0)
    expect(res.messages.some((m) => m.tone === 'warn' && m.text.includes('ติดลบ'))).toBe(true)
  })
})

describe('ขายและกำไร', () => {
  it('ตัดจากล็อตและคิดต้นทุนของที่ขายไป', () => {
    const core = run(shopWithRecipe(), DAY2, 'ทำเค้กมะม่วง 20 กล่อง', 'ขายเค้กมะม่วง 15 กล่อง กล่องละ 120 บาท')
    const sale = core.sales[0]
    expect(sale.qty).toBe(15)
    expect(sale.revenue).toBe(1800)
    expect(sale.cost).toBeCloseTo(15 * 27.28, 6)
    expect(finishedStock(core.lots, core.recipes[0].id, DAY2)).toBe(5)
  })

  it('ไม่ระบุราคา ใช้ราคาที่ตั้งไว้ในเมนู', () => {
    const core = run(shopWithRecipe(), DAY2, 'ทำเค้กมะม่วง 20 กล่อง', 'ขายเค้กมะม่วง 5 กล่อง')
    expect(core.sales[0].unitPrice).toBe(60)
  })

  it('ขายเกินของที่มี บันทึกเท่าที่มีแล้วเสนอให้บันทึกผลิตเพิ่ม', () => {
    const core = run(shopWithRecipe(), DAY2, 'ทำเค้กมะม่วง 5 กล่อง')
    const res = runCommand(core, parseLine('ขายเค้กมะม่วง 8 กล่อง กล่องละ 100'), DAY2)
    expect(res.core.sales[0].qty).toBe(5)
    const offer = res.messages.find((m) => m.actions?.some((a) => a.kind === 'produceThenSell'))
    expect(offer).toBeTruthy()
  })
})

describe('ของเหลือยกไปขายวันถัดไป', () => {
  it('ของที่ทำวันนี้ ยกไปพร้อมขายพรุ่งนี้ และไม่คิดต้นทุนซ้ำ', () => {
    const core = run(shopWithRecipe(), DAY2, 'ทำเค้กมะม่วง 20 กล่อง', 'ขายเค้กมะม่วง 15 กล่อง กล่องละ 120', 'เหลือเค้กมะม่วง 5 กล่อง')
    const carried = core.lots.find((l) => l.carriedOver)!
    expect(carried.remaining).toBe(5)
    expect(carried.costPerUnit).toBe(0)
    expect(carried.originalCostPerUnit).toBeCloseTo(27.28, 6)
    expect(carried.sellDate).toBe(addDays(DAY2, 1))
    // วันนี้ขายไม่ได้แล้ว เพราะยกไปขายพรุ่งนี้
    expect(finishedStock(core.lots, core.recipes[0].id, DAY2)).toBe(0)
    expect(finishedStock(core.lots, core.recipes[0].id, addDays(DAY2, 1))).toBe(5)
  })

  it('ขายของยกมา = กำไรเต็มจำนวน ไม่มีต้นทุนซ้ำ', () => {
    let core = run(shopWithRecipe(), DAY1, 'ทำเค้กมะม่วง 20 กล่อง', 'เหลือเค้กมะม่วง 20 กล่อง')
    core = run(core, DAY2, 'ขายเค้กมะม่วง 20 กล่อง กล่องละ 100 บาท')
    const sale = core.sales[0]
    expect(sale.revenue).toBe(2000)
    expect(sale.cost).toBe(0)

    // ต้นทุนถูกรับรู้ไปแล้วในวันที่ผลิต ไม่ถูกนับซ้ำในวันที่ขาย
    const day2 = summarize({ ...core, chat: [], snapshots: [] }, DAY2, DAY2)
    expect(day2.revenue).toBe(2000)
    expect(day2.productionCost).toBe(0)
    expect(day2.netProfit).toBe(2000)
  })

  it('ของค้างจากเมื่อวาน สั่งเก็บวันนี้ ให้ขายได้วันนี้เลย', () => {
    let core = run(shopWithRecipe(), DAY1, 'ทำเค้กมะม่วง 20 กล่อง')
    core = run(core, DAY2, 'เหลือเค้กมะม่วง 20 กล่อง')
    expect(core.lots.find((l) => l.carriedOver)!.sellDate).toBe(DAY2)
    expect(finishedStock(core.lots, core.recipes[0].id, DAY2)).toBe(20)
  })

  it('บอกของเหลือได้แม้ไม่เคยบันทึกการผลิต — สร้างเป็นของทุน 0', () => {
    const core = run(shopWithRecipe(), DAY2, 'เหลือเค้กมะม่วง 6 กล่อง')
    const lot = core.lots[0]
    expect(lot.remaining).toBe(6)
    expect(lot.costPerUnit).toBe(0)
    expect(lot.carriedOver).toBe(true)
  })
})

describe('ของเสีย', () => {
  it('บันทึกมูลค่าต้นทุนที่เสียไปตามทุนจริงของล็อต', () => {
    const core = run(shopWithRecipe(), DAY2, 'ทำเค้กมะม่วง 20 กล่อง', 'ทิ้งเค้กมะม่วง 4 กล่อง เพราะบูด')
    const waste = core.wastes[0]
    expect(waste.qty).toBe(4)
    expect(waste.cost).toBeCloseTo(4 * 27.28, 6)
    expect(waste.reason).toBe('บูด')
    expect(finishedStock(core.lots, core.recipes[0].id, DAY2)).toBe(16)
  })

  it('ของยกมาที่ทิ้ง ยังรายงานมูลค่าเดิมที่เสียไปจริง', () => {
    const core = run(
      shopWithRecipe(),
      DAY2,
      'ทำเค้กมะม่วง 20 กล่อง',
      'เหลือเค้กมะม่วง 20 กล่อง',
    )
    const next = run(core, addDays(DAY2, 1), 'ทิ้งเค้กมะม่วง 20 กล่อง')
    expect(next.wastes[0].cost).toBeCloseTo(20 * 27.28, 6)
  })
})

describe('สรุปยอดและกำไร', () => {
  it('ของที่ผลิตแล้วขายไม่หมด ทำให้กำไรสุทธิของวันนั้นลดลง', () => {
    const core = run(shopWithRecipe(), DAY2, 'ทำเค้กมะม่วง 20 กล่อง', 'ขายเค้กมะม่วง 10 กล่อง กล่องละ 50 บาท')
    const s = summarize({ ...core, chat: [], snapshots: [] }, DAY2, DAY2)
    expect(s.revenue).toBe(500)
    expect(s.productionCost).toBeCloseTo(545.6, 6)
    expect(s.netProfit).toBeCloseTo(-45.6, 6) // ขายหมดทุกกล่องถึงจะกำไร
    expect(s.grossProfit).toBeCloseTo(500 - 10 * 27.28, 6)
    expect(s.leftoverQty).toBe(10)
    expect(s.leftoverCost).toBeCloseTo(272.8, 6)
  })

  it('แยกค่าวัตถุดิบกับค่าแรงในงบได้', () => {
    const core = run(shopWithRecipe(), DAY2, 'ทำเค้กมะม่วง 20 กล่อง')
    const s = summarize({ ...core, chat: [], snapshots: [] }, DAY2, DAY2)
    expect(s.materialCost).toBeCloseTo(125.6, 6)
    expect(s.overheadCost).toBeCloseTo(420, 6)
    expect(s.materialCost + s.overheadCost).toBeCloseTo(s.productionCost, 6)
  })
})

describe('คิดราคาขาย', () => {
  const cost = 27.28

  it('บวกกำไรจากทุน แล้วปัดเป็นสตางค์', () => {
    expect(suggestPrice(cost, 30, 'markup').price).toBe(35.46)
    expect(suggestPrice(cost, 40, 'markup').price).toBe(38.19)
    expect(suggestPrice(cost, 30, 'markup').rawPrice).toBeCloseTo(35.464, 6)
  })

  it('คิดกำไรเป็นสัดส่วนของราคาขาย', () => {
    const s = suggestPrice(cost, 30, 'margin')
    expect(s.price).toBe(38.97)
    expect(s.rawPrice).toBeCloseTo(38.9714, 4)
    expect(s.marginPct).toBeCloseTo(30, 1)
  })

  it('ปัดราคาขึ้นตามที่ตั้งไว้', () => {
    expect(suggestPrice(cost, 30, 'markup', 5).price).toBe(40)
    expect(suggestPrice(cost, 30, 'markup', 1).price).toBe(36)
  })

  it('รายงานกำไรทั้งสองแบบให้เทียบกันได้', () => {
    const s = suggestPrice(100, 25, 'markup')
    expect(s.price).toBe(125)
    expect(s.markupPct).toBeCloseTo(25, 6)
    expect(s.marginPct).toBeCloseTo(20, 6)
  })
})

describe('ถามข้อมูลโดยไม่แก้ข้อมูล', () => {
  it('ถามต้นทุนแล้วได้ราคาแนะนำ โดยข้อมูลไม่เปลี่ยน', () => {
    const core = shopWithRecipe()
    const res = runCommand(core, parseLine('ต้นทุนเค้กมะม่วง กำไร 40%'), DAY2)
    expect(res.changed).toBe(false)
    expect(res.core).toBe(core)
    expect(res.messages.some((m) => m.text.includes('40'))).toBe(true)
  })

  it('สูตรที่ยังไม่มี จะเสนอให้สร้างเมนูแทนที่จะพัง', () => {
    const res = runCommand(emptyCore(), parseLine('ทำบราวนี่ 10 กล่อง'), DAY2)
    expect(res.changed).toBe(false)
    expect(res.messages[0].actions?.[0].kind).toBe('openRecipe')
  })
})

describe('ต้นทุนสูตรเมื่อยังไม่รู้ราคาวัตถุดิบ', () => {
  it('บอกชื่อของที่ยังไม่มีราคา แทนที่จะคิดเป็น 0 เงียบๆ', () => {
    const core = run(
      emptyCore(),
      DAY1,
      'ซื้อมะม่วง 3 กิโล 112 บาท',
      'สูตรเค้กมะม่วง ได้ 10 กล่อง ใช้ มะม่วง 1000 กรัม, ครีมชีส 500 กรัม',
    )
    const cost = recipeCost(core.recipes[0], core.items)
    expect(cost.unpriced).toEqual(['ครีมชีส'])
    expect(cost.materialCost).toBeCloseTo(37.333, 3)
  })
})
