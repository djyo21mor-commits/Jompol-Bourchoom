import type { Task } from '../types'

/* ===========================================================================
   ตรรกะเกี่ยวกับงานและวันที่ — เป็นฟังก์ชันบริสุทธิ์ทั้งหมด ทดสอบได้ง่าย
=========================================================================== */

const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const TH_WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']

/** วันที่วันนี้ตามเวลาเครื่อง รูปแบบ YYYY-MM-DD */
export function todayYmd(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** จำนวนวันจากวันนี้ถึงวันครบกำหนด (บวก = ยังไม่ถึง, ลบ = เลยมาแล้ว) */
export function daysUntil(due: string, today = todayYmd()): number {
  const [ay, am, ad] = today.split('-').map(Number)
  const [by, bm, bd] = due.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later' | 'none'

export interface DueInfo {
  tone: DueTone
  /** ข้อความสั้น เช่น "เลยมา 2 วัน", "วันนี้", "อีก 3 วัน" */
  label: string
  /** วันที่แบบเต็ม เช่น "จ. 1 ก.ย. 2569" */
  full: string
}

/** อธิบายสถานะวันครบกำหนดของงาน */
export function describeDue(due: string | null, today = todayYmd()): DueInfo {
  if (!due) return { tone: 'none', label: 'ยังไม่กำหนดวัน', full: '' }
  const diff = daysUntil(due, today)
  const full = formatThaiDate(due)
  if (diff < 0) return { tone: 'overdue', label: `เลยมา ${-diff} วัน`, full }
  if (diff === 0) return { tone: 'today', label: 'วันนี้', full }
  if (diff === 1) return { tone: 'soon', label: 'พรุ่งนี้', full }
  if (diff <= 3) return { tone: 'soon', label: `อีก ${diff} วัน`, full }
  return { tone: 'later', label: `อีก ${diff} วัน`, full }
}

/** "จ. 1 ก.ย. 2569" (พ.ศ.) */
export function formatThaiDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const wd = TH_WEEKDAYS[date.getDay()]
  return `${wd} ${d} ${TH_MONTHS_SHORT[m - 1]} ${y + 543}`
}

/** เอาเฉพาะงานที่ยังไม่ถูกลบ */
export function visibleTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => !t.deleted)
}

/**
 * จัดเรียงเพื่อแสดงผล: ยังไม่เสร็จมาก่อน, เรียงตามวันครบกำหนด (เลยกำหนดอยู่บนสุด),
 * งานไม่กำหนดวันไปท้ายกลุ่ม, งานเสร็จแล้วไปล่างสุด
 */
export function sortForDisplay(tasks: Task[], today = todayYmd()): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    if (a.due && b.due) {
      if (a.due !== b.due) return a.due < b.due ? -1 : 1
    } else if (a.due || b.due) {
      return a.due ? -1 : 1
    }
    return daysUntil(today, a.createdAt.slice(0, 10)) - daysUntil(today, b.createdAt.slice(0, 10))
  })
}

export interface Counts {
  pending: number
  overdue: number
  today: number
  done: number
}

export function countTasks(tasks: Task[], today = todayYmd()): Counts {
  let pending = 0
  let overdue = 0
  let dueToday = 0
  let done = 0
  for (const t of tasks) {
    if (t.done) {
      done += 1
      continue
    }
    pending += 1
    if (t.due) {
      const diff = daysUntil(t.due, today)
      if (diff < 0) overdue += 1
      else if (diff === 0) dueToday += 1
    }
  }
  return { pending, overdue, today: dueToday, done }
}

/**
 * รวมงานสองชุดเข้าด้วยกันด้วย id — ชิ้นที่แก้ล่าสุด (updatedAt) ชนะ
 * ใช้ตอนซิงค์: ข้อมูลจากเซิร์ฟเวอร์รวมกับที่เพิ่งแก้บนเครื่องนี้
 */
export function mergeById(a: Task[], b: Task[]): Task[] {
  const map = new Map<string, Task>()
  for (const t of [...a, ...b]) {
    const prev = map.get(t.id)
    if (!prev || t.updatedAt >= prev.updatedAt) map.set(t.id, t)
  }
  return [...map.values()]
}

/** เอาป้ายหลุมศพเก่าเกินกำหนดออก ไม่ให้ข้อมูลบวมขึ้นเรื่อยๆ */
export function pruneTombstones(tasks: Task[], now = new Date(), keepDays = 60): Task[] {
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000).toISOString()
  return tasks.filter((t) => !(t.deleted && t.updatedAt < cutoff))
}

let counter = 0
export function newId(): string {
  counter = (counter + 1) % 100000
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}
