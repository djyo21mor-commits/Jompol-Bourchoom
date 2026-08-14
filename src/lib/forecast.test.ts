import { describe, expect, it } from 'vitest'
import type { AppState, CoreState } from '../types'
import { commitPendingRecipe, runCommand } from './engine'
import { parseLine } from './parser'
import { dailySold, forecastMenus, stats, steadiness, zFor } from './forecast'
import { DEFAULT_SETTINGS } from './store'

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

const asState = (core: CoreState): AppState => ({ ...core, chat: [], snapshots: [] })

describe('ค่าเฉลี่ยและส่วนเบี่ยงเบนมาตรฐาน', () => {
  it('ชุดว่าง คืนศูนย์ทั้งหมด ไม่พัง', () => {
    expect(stats([])).toEqual({ n: 0, mean: 0, sd: 0, min: 0, max: 0, cv: 0 })
  })

  it('ข้อมูลวันเดียว ยังหาความเหวี่ยงไม่ได้ ให้ sd เป็น 0', () => {
    const r = stats([12])
    expect(r).toMatchObject({ n: 1, mean: 12, sd: 0, min: 12, max: 12 })
  })

  it('คิดค่าเฉลี่ยกับ SD แบบกลุ่มตัวอย่าง (หารด้วย n−1)', () => {
    // 2,4,4,4,5,5,7,9 -> mean 5, SD ประชากร 2, SD กลุ่มตัวอย่าง 2.138
    const r = stats([2, 4, 4, 4, 5, 5, 7, 9])
    expect(r.n).toBe(8)
    expect(r.mean).toBe(5)
    expect(r.sd).toBeCloseTo(2.138, 3)
    expect(r.min).toBe(2)
    expect(r.max).toBe(9)
    expect(r.cv).toBeCloseTo(0.4276, 3)
  })

  it('ขายเท่ากันทุกวัน SD เป็นศูนย์ และถือว่าสม่ำเสมอมาก', () => {
    const r = stats([20, 20, 20, 20])
    expect(r.sd).toBe(0)
    expect(r.cv).toBe(0)
    expect(steadiness(r.cv).tone).toBe('good')
  })

  it('ยิ่งเหวี่ยงมาก ยิ่งเตือนว่าคาดเดายาก', () => {
    expect(steadiness(stats([2, 30, 5, 28]).cv).tone).toBe('bad')
  })
})

describe('ยอดขายรายวันที่เอาไปคิดสถิติ', () => {
  /** ทำ 3 วัน ขายได้ 15 / 20 / 10 และมีวันที่ไม่ได้ทำคั่นอยู่ */
  function shop(): CoreState {
    let core = run(emptyCore(), '2026-08-01', 'ซื้อมะม่วง 100 กิโล ราคารวม 10000 บาท')
    core = run(core, '2026-08-01', 'สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม')
    core = run(core, '2026-08-02', 'ทำเค้กมะม่วง 20 กล่อง', 'ขายเค้กมะม่วง 15 กล่อง กล่องละ 120')
    core = run(core, '2026-08-03', 'ทำเค้กมะม่วง 20 กล่อง', 'ขายเค้กมะม่วง 20 กล่อง กล่องละ 120')
    // 4 ส.ค. ปิดร้าน ไม่ได้ทำและไม่ได้ขาย
    core = run(core, '2026-08-05', 'ทำเค้กมะม่วง 20 กล่อง', 'ขายเค้กมะม่วง 10 กล่อง กล่องละ 120')
    return core
  }

  it('นับเฉพาะวันที่ร้านมีเมนูนั้นขาย วันปิดร้านไม่ถูกนับเป็น 0', () => {
    const core = shop()
    const rows = dailySold(asState(core), core.recipes[0].id, '2026-08-01', '2026-08-06')
    expect(rows.map((r) => r.date)).toEqual(['2026-08-02', '2026-08-03', '2026-08-05'])
    expect(rows.map((r) => r.qty)).toEqual([15, 20, 10])
  })

  it('วันที่ทำแล้วขายไม่ได้เลย นับเป็น 0 เพราะเป็นข้อมูลจริง', () => {
    let core = shop()
    core = run(core, '2026-08-06', 'ทำเค้กมะม่วง 20 กล่อง')
    const rows = dailySold(asState(core), core.recipes[0].id, '2026-08-01', '2026-08-06')
    expect(rows[rows.length - 1]).toEqual({ date: '2026-08-06', qty: 0 })
  })

  it('คาดการณ์: เผื่อมากขึ้นตามระดับความมั่นใจที่เลือก', () => {
    const core = shop()
    const state = asState(core)
    const at50 = forecastMenus(state, '2026-08-01', '2026-08-06', 50, '2026-08-07')[0]
    const at95 = forecastMenus(state, '2026-08-01', '2026-08-06', 95, '2026-08-07')[0]

    // ขายได้ 15 / 20 / 10 -> เฉลี่ย 15 SD 5
    expect(at50.stats.mean).toBe(15)
    expect(at50.stats.sd).toBe(5)
    expect(at50.target).toBe(15)
    expect(at95.target).toBe(Math.ceil(15 + zFor(95) * 5)) // 24
    expect(at95.target).toBeGreaterThan(at50.target)
  })

  it('มีของค้างพร้อมขายอยู่แล้ว ให้หักออกจากจำนวนที่ต้องทำ', () => {
    let core = shop()
    // ยกของที่เหลือจากวันที่ 5 ไปขายวันที่ 6
    core = run(core, '2026-08-05', 'เหลือเค้กมะม่วง 10 กล่อง')
    const state = asState(core)

    // ค้างอยู่ 15 = ที่เหลือจากวันที่ 2 อีก 5 บวกของที่ยกมาจากวันที่ 5 อีก 10
    const easy = forecastMenus(state, '2026-08-01', '2026-08-06', 50, '2026-08-06')[0]
    expect(easy.ready).toBe(15)
    expect(easy.target).toBe(15)
    expect(easy.make).toBe(0) // ของที่มีอยู่พอขายแล้ว ไม่ต้องทำเพิ่ม

    const safe = forecastMenus(state, '2026-08-01', '2026-08-06', 95, '2026-08-06')[0]
    expect(safe.target).toBe(24)
    expect(safe.make).toBe(24 - 15)
  })

  it('เมนูที่ยังไม่เคยทำเลย ไม่ขึ้นในรายการคาดการณ์', () => {
    let core = shop()
    core = run(core, '2026-08-06', 'สูตรคุกกี้ ได้ 30 ชิ้น ใช้ มะม่วง 100 กรัม')
    const rows = forecastMenus(asState(core), '2026-08-01', '2026-08-06', 80, '2026-08-07')
    expect(rows.map((r) => r.name)).toEqual(['เค้กมะม่วง'])
  })

  it('ไม่มีข้อมูลเลย คืนรายการว่าง ไม่พัง', () => {
    expect(forecastMenus(asState(emptyCore()), '2026-08-01', '2026-08-06', 80)).toEqual([])
  })
})
