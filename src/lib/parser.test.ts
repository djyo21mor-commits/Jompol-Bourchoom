import { describe, expect, it } from 'vitest'
import { parseLine, parseScript } from './parser'

/** ผ่อนคลาย type ให้เขียนเทสต์สั้นลง */
function p(text: string) {
  return parseLine(text) as any
}

describe('ซื้อของ — ตัวอย่างจากหน้างานจริง', () => {
  it('กล่อง p39 แบบขายยกลัง คิดต้นทุนต่อกล่องได้ถูกต้อง', () => {
    const r = p('ซื้อกล่อง p39 1 ลัง ลังละ 1000 กล่อง ราคารวม 1680 บาท')
    expect(r.kind).toBe('purchase')
    expect(r.name).toBe('กล่อง p39')
    expect(r.category).toBe('packaging')
    expect(r.base).toBe('pcs')
    expect(r.unitLabel).toBe('กล่อง')
    expect(r.qty).toBe(1000)
    expect(r.total).toBe(1680)
    expect(r.total / r.qty).toBeCloseTo(1.68, 6)
  })

  it('ของสดคิดเป็นกรัม เพื่อให้หารต่อกรัม/ต่อกิโลได้', () => {
    const r = p('ซื้อมะม่วง 3 กิโล ราคารวม 112 บาท')
    expect(r.kind).toBe('purchase')
    expect(r.name).toBe('มะม่วง')
    expect(r.category).toBe('fresh')
    expect(r.base).toBe('g')
    expect(r.qty).toBe(3000)
    expect(r.total).toBe(112)
    expect((r.total / r.qty) * 1000).toBeCloseTo(37.333, 3)
  })

  it('ซื้อหลายลัง คูณจำนวนข้างในให้ครบ', () => {
    const r = p('ซื้อกล่อง p39 3 ลัง ลังละ 1000 กล่อง 5040 บาท')
    expect(r.qty).toBe(3000)
    expect(r.total).toBe(5040)
    expect(r.packNote).toBe('3 ลัง × 1,000 กล่อง')
  })

  it('รับราคาแบบ "กิโลละ" แล้วคิดราคารวมให้เอง', () => {
    const r = p('ซื้อมะม่วง 3 กิโล กิโลละ 40 บาท')
    expect(r.qty).toBe(3000)
    expect(r.total).toBeCloseTo(120, 6)
  })

  it('รับราคาต่อหน่วยที่ไม่มีคำว่าบาท', () => {
    const r = p('ซื้อนมสด 2 ขวด ขวดละ 25')
    expect(r.kind).toBe('purchase')
    expect(r.qty).toBe(2)
    expect(r.total).toBeCloseTo(50, 6)
  })

  it('ไข่ไก่ขายเป็นแผง', () => {
    const r = p('ซื้อไข่ไก่ 2 แผง แผงละ 30 ฟอง ราคา 240 บาท')
    expect(r.name).toBe('ไข่ไก่')
    expect(r.qty).toBe(60)
    expect(r.unitLabel).toBe('ฟอง')
    expect(r.total).toBe(240)
  })

  it('เลขไทยและคอมมาคั่นหลักพัน', () => {
    const r = p('ซื้อแป้งเค้ก ๕ กก. ราคารวม 1,250 บาท')
    expect(r.qty).toBe(5000)
    expect(r.total).toBe(1250)
  })

  it('หน่วยขีดและปอนด์', () => {
    expect(p('ซื้อเนย 5 ขีด 90 บาท').qty).toBe(500)
    expect(p('ซื้อเนย 1 ปอนด์ 180 บาท').qty).toBeCloseTo(453.592, 3)
  })

  it('ของเหลวคิดเป็นมิลลิลิตร', () => {
    const r = p('ซื้อวิปครีม 1 ลิตร 165 บาท')
    expect(r.base).toBe('ml')
    expect(r.qty).toBe(1000)
    expect(r.category).toBe('fresh')
  })

  it('ชื่อที่มีคำว่า "ละ" อยู่ข้างใน ต้องไม่ถูกอ่านผิด', () => {
    const r = p('ซื้อมะละกอ 2 กิโล 60 บาท')
    expect(r.name).toBe('มะละกอ')
    expect(r.qty).toBe(2000)
    expect(r.total).toBe(60)
  })

  it('ไม่ต้องขึ้นต้นด้วย "ซื้อ" ก็ได้ ถ้ามีราคาชัดเจน', () => {
    const r = p('แป้งสาลี 2 กก. 90 บาท')
    expect(r.kind).toBe('purchase')
    expect(r.name).toBe('แป้งสาลี')
  })

  it('ไม่มีราคา -> บอกให้ผู้ใช้เติมราคา', () => {
    const r = p('ซื้อมะม่วง 3 กิโล')
    expect(r.kind).toBe('unknown')
    expect(r.reason).toContain('ราคา')
  })
})

describe('ผลิต / ขาย / ของเหลือ / ของเสีย', () => {
  it('บันทึกการผลิต', () => {
    const r = p('ทำเค้กมะม่วง 20 กล่อง')
    expect(r.kind).toBe('produce')
    expect(r.name).toBe('เค้กมะม่วง')
    expect(r.qty).toBe(20)
    expect(r.unit).toBe('กล่อง')
  })

  it('บันทึกการขายพร้อมราคาต่อกล่อง', () => {
    const r = p('ขายเค้กมะม่วง 15 กล่อง กล่องละ 120 บาท')
    expect(r.kind).toBe('sell')
    expect(r.name).toBe('เค้กมะม่วง')
    expect(r.qty).toBe(15)
    expect(r.unitPrice).toBe(120)
  })

  it('ขายโดยไม่ระบุราคา ใช้ราคาที่ตั้งไว้ในเมนู', () => {
    const r = p('ขายบราวนี่ 8 ชิ้น')
    expect(r.kind).toBe('sell')
    expect(r.unitPrice).toBeUndefined()
    expect(r.unit).toBe('ชิ้น')
  })

  it('ของเหลือยกไปขายวันพรุ่งนี้', () => {
    const r = p('เหลือเค้กมะม่วง 5 กล่อง')
    expect(r.kind).toBe('carryover')
    expect(r.qty).toBe(5)
  })

  it('ของเสียพร้อมเหตุผล', () => {
    const r = p('ทิ้งเค้กมะม่วง 2 กล่อง เพราะบูด')
    expect(r.kind).toBe('waste')
    expect(r.qty).toBe(2)
    expect(r.reason).toBe('บูด')
  })

  it('ไม่ระบุหน่วย ถือว่าเป็นกล่อง', () => {
    const r = p('ทำชีสเค้ก 12')
    expect(r.kind).toBe('produce')
    expect(r.qty).toBe(12)
    expect(r.unit).toBe('กล่อง')
  })
})

describe('สร้างสูตรจากแชท', () => {
  it('อ่านชื่อ จำนวนที่ได้ และส่วนผสมครบ', () => {
    const r = p('สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม, แป้งเค้ก 800 กรัม, กล่อง p39 20 กล่อง')
    expect(r.kind).toBe('recipe')
    expect(r.name).toBe('เค้กมะม่วง')
    expect(r.yieldQty).toBe(20)
    expect(r.yieldUnit).toBe('กล่อง')
    expect(r.ingredients).toHaveLength(3)
    expect(r.ingredients[0]).toMatchObject({ name: 'มะม่วง', qty: 1500, base: 'g' })
    expect(r.ingredients[2]).toMatchObject({ name: 'กล่อง p39', qty: 20, base: 'pcs' })
  })

  it('คั่นส่วนผสมด้วย "และ" ก็ได้', () => {
    const r = p('สูตรคุกกี้ ได้ 30 ชิ้น ใช้ แป้ง 500 กรัม และ เนย 250 กรัม')
    expect(r.ingredients).toHaveLength(2)
    expect(r.yieldUnit).toBe('ชิ้น')
  })
})

describe('คำสั่งสอบถาม', () => {
  it('ถามสต็อกทั้งหมด', () => {
    expect(p('สต็อก').kind).toBe('stock')
    expect(p('สต็อก').name).toBeUndefined()
  })

  it('ถามสต็อกรายตัว', () => {
    const r = p('เช็คสต็อกมะม่วง')
    expect(r.kind).toBe('stock')
    expect(r.name).toBe('มะม่วง')
  })

  it('ถามต้นทุนพร้อมกำไรที่ต้องการ', () => {
    const r = p('ต้นทุนเค้กมะม่วง กำไร 40%')
    expect(r.kind).toBe('cost')
    expect(r.name).toBe('เค้กมะม่วง')
    expect(r.marginPct).toBe(40)
  })

  it('ขอความช่วยเหลือ', () => {
    expect(p('help').kind).toBe('help')
    expect(p('วิธีใช้').kind).toBe('help')
  })
})

describe('พิมพ์หลายบรรทัด', () => {
  it('บรรทัดถัดไปสืบทอดคำสั่งจากบรรทัดแรก', () => {
    const rs = parseScript(
      'ซื้อมะม่วง 3 กิโล 112 บาท\nแป้งเค้ก 1 กก. 45 บาท\nเนยสด 500 กรัม 120 บาท',
    ) as any[]
    expect(rs).toHaveLength(3)
    expect(rs.every((r) => r.kind === 'purchase')).toBe(true)
    expect(rs[1].name).toBe('แป้งเค้ก')
    expect(rs[2].qty).toBe(500)
  })

  it('ใส่ bullet นำหน้าได้', () => {
    const rs = parseScript('ซื้อของ\n- มะม่วง 3 กิโล 112 บาท\n- แป้ง 1 กก. 45 บาท') as any[]
    expect(rs.filter((r) => r.kind === 'purchase')).toHaveLength(2)
  })
})
