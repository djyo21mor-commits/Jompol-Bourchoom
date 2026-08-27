import { describe, it, expect } from 'vitest'
import type { Task } from '../types'
import { countTasks, daysUntil, describeDue, formatThaiDate, mergeById, pruneTombstones, sortForDisplay } from './tasks'

const today = '2026-08-27'

function task(p: Partial<Task>): Task {
  return {
    id: p.id ?? 'x',
    title: p.title ?? 'งาน',
    due: p.due ?? null,
    note: p.note ?? '',
    done: p.done ?? false,
    createdAt: p.createdAt ?? '2026-08-01T00:00:00.000Z',
    updatedAt: p.updatedAt ?? '2026-08-01T00:00:00.000Z',
    deleted: p.deleted,
  }
}

describe('daysUntil', () => {
  it('คำนวณส่วนต่างวัน', () => {
    expect(daysUntil('2026-08-27', today)).toBe(0)
    expect(daysUntil('2026-08-30', today)).toBe(3)
    expect(daysUntil('2026-08-24', today)).toBe(-3)
  })
})

describe('describeDue', () => {
  it('ติดป้ายตามระยะเวลา', () => {
    expect(describeDue(null, today).tone).toBe('none')
    expect(describeDue('2026-08-24', today).tone).toBe('overdue')
    expect(describeDue('2026-08-27', today).tone).toBe('today')
    expect(describeDue('2026-08-28', today)).toMatchObject({ tone: 'soon', label: 'พรุ่งนี้' })
    expect(describeDue('2026-09-10', today).tone).toBe('later')
  })
})

describe('formatThaiDate', () => {
  it('แสดงเป็น พ.ศ. พร้อมวันในสัปดาห์', () => {
    expect(formatThaiDate('2026-09-01')).toBe('อ. 1 ก.ย. 2569')
  })
})

describe('countTasks', () => {
  it('นับค้าง/เลยกำหนด/วันนี้/เสร็จ', () => {
    const c = countTasks(
      [
        task({ due: '2026-08-24' }),
        task({ due: '2026-08-27' }),
        task({ due: '2026-09-01' }),
        task({ done: true }),
      ],
      today,
    )
    expect(c).toEqual({ pending: 3, overdue: 1, today: 1, done: 1 })
  })
})

describe('sortForDisplay', () => {
  it('ยังไม่เสร็จก่อน เรียงตามวันครบกำหนด งานเสร็จไปท้าย', () => {
    const list = sortForDisplay(
      [
        task({ id: 'done', done: true }),
        task({ id: 'late', due: '2026-08-20' }),
        task({ id: 'nodue' }),
        task({ id: 'soon', due: '2026-08-28' }),
      ],
      today,
    )
    expect(list.map((t) => t.id)).toEqual(['late', 'soon', 'nodue', 'done'])
  })
})

describe('mergeById', () => {
  it('ชิ้นที่แก้ล่าสุดชนะ', () => {
    const a = [task({ id: '1', title: 'เก่า', updatedAt: '2026-08-01T00:00:00Z' })]
    const b = [task({ id: '1', title: 'ใหม่', updatedAt: '2026-08-05T00:00:00Z' })]
    const merged = mergeById(a, b)
    expect(merged).toHaveLength(1)
    expect(merged[0].title).toBe('ใหม่')
  })

  it('รวมงานคนละ id', () => {
    expect(mergeById([task({ id: '1' })], [task({ id: '2' })])).toHaveLength(2)
  })
})

describe('pruneTombstones', () => {
  it('ตัดหลุมศพเก่ากว่ากำหนดออก', () => {
    const now = new Date('2026-08-27T00:00:00Z')
    const kept = pruneTombstones(
      [
        task({ id: 'old', deleted: true, updatedAt: '2026-01-01T00:00:00Z' }),
        task({ id: 'recent', deleted: true, updatedAt: '2026-08-20T00:00:00Z' }),
        task({ id: 'alive' }),
      ],
      now,
      60,
    )
    expect(kept.map((t) => t.id).sort()).toEqual(['alive', 'recent'])
  })
})
