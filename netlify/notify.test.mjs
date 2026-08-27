import { describe, it, expect } from 'vitest'
import { buildSummary, daysBetween, todayYmd, formatThaiDate } from './functions/_notify.mjs'

describe('daysBetween', () => {
  it('นับจำนวนวันได้ทั้งบวกและลบ', () => {
    expect(daysBetween('2026-08-27', '2026-08-27')).toBe(0)
    expect(daysBetween('2026-08-27', '2026-08-28')).toBe(1)
    expect(daysBetween('2026-08-27', '2026-08-25')).toBe(-2)
    expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1) // ข้ามเดือน
  })
})

describe('todayYmd', () => {
  it('เลื่อนเป็นเวลาไทยแล้ววันเปลี่ยนก่อน UTC', () => {
    // 26 ส.ค. 23:00 UTC = 27 ส.ค. 06:00 ไทย
    expect(todayYmd(new Date('2026-08-26T23:00:00Z'))).toBe('2026-08-27')
  })
})

describe('formatThaiDate', () => {
  it('แปลงเป็นวันที่ย่อภาษาไทย', () => {
    expect(formatThaiDate('2026-09-01')).toBe('1 ก.ย.')
    expect(formatThaiDate('2026-01-15')).toBe('15 ม.ค.')
  })
})

describe('buildSummary', () => {
  const today = '2026-08-27'

  it('คืน null เมื่อไม่มีงานค้าง', () => {
    expect(buildSummary([], today)).toBeNull()
    expect(buildSummary([{ title: 'เสร็จแล้ว', done: true }], today)).toBeNull()
  })

  it('นับเฉพาะงานที่ยังไม่เสร็จ', () => {
    const s = buildSummary(
      [
        { title: 'ส่งรายงาน', due: '2026-08-30', done: false },
        { title: 'จ่ายบิล', due: '2026-08-28', done: true },
      ],
      today,
    )
    expect(s.count).toBe(1)
    expect(s.body).toContain('ส่งรายงาน')
    expect(s.body).not.toContain('จ่ายบิล')
  })

  it('เรียงตามวันครบกำหนดและติดป้ายเลยกำหนด/วันนี้', () => {
    const s = buildSummary(
      [
        { title: 'งานสาย', due: '2026-08-25', done: false },
        { title: 'งานวันนี้', due: '2026-08-27', done: false },
        { title: 'งานหน้า', due: '2026-08-29', done: false },
      ],
      today,
    )
    expect(s.title).toContain('เลยกำหนด')
    const lines = s.body.split('\n')
    expect(lines[0]).toContain('งานสาย')
    expect(lines[0]).toContain('เลยกำหนด 2 วัน')
    expect(lines[1]).toContain('ครบกำหนดวันนี้')
    expect(lines[2]).toContain('อีก 2 วัน')
  })

  it('งานไม่กำหนดวันไปอยู่ท้ายสุด', () => {
    const s = buildSummary(
      [
        { title: 'ไว้ทำ', done: false },
        { title: 'ด่วน', due: '2026-08-28', done: false },
      ],
      today,
    )
    const lines = s.body.split('\n')
    expect(lines[0]).toContain('ด่วน')
    expect(lines[1]).toContain('ยังไม่กำหนดวันส่ง')
  })
})
