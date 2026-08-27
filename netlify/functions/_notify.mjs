import { webpush } from './_lib.mjs'

/* ===========================================================================
   สร้างข้อความสรุปงานค้าง และส่ง Web Push

   แยกส่วน "สร้างข้อความ" ออกมาเป็นฟังก์ชันบริสุทธิ์ จะได้ทดสอบได้โดยไม่ต้องส่งจริง
=========================================================================== */

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/** เวลาไทย = UTC+7 ใช้คำนวณ "วันนี้" ให้ตรงไม่ว่าเซิร์ฟเวอร์จะตั้งโซนเวลาไว้แบบไหน */
export const BANGKOK_OFFSET_MIN = 7 * 60

/** คืนวันที่วันนี้ตามเวลาไทยในรูปแบบ YYYY-MM-DD */
export function todayYmd(now = new Date(), offsetMin = BANGKOK_OFFSET_MIN) {
  const shifted = new Date(now.getTime() + offsetMin * 60_000)
  return shifted.toISOString().slice(0, 10)
}

/** จำนวนวันจาก a ถึง b (YYYY-MM-DD) — บวกคือ b อยู่หลัง a */
export function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** "1 ก.ย." จากสตริง YYYY-MM-DD */
export function formatThaiDate(ymd) {
  const [, m, d] = ymd.split('-').map(Number)
  return `${d} ${TH_MONTHS[m - 1]}`
}

/**
 * สรุปงานค้างเป็นหัวข้อ + เนื้อความสำหรับแจ้งเตือน
 * คืน null ถ้าไม่มีงานค้างเลย (จะได้ไม่ต้องส่ง)
 */
export function buildSummary(tasks, today = todayYmd()) {
  const pending = (Array.isArray(tasks) ? tasks : []).filter((t) => t && !t.done)
  if (pending.length === 0) return null

  const withDue = pending
    .filter((t) => t.due)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))
  const noDue = pending.filter((t) => !t.due)

  const lines = []
  for (const t of withDue) {
    const diff = daysBetween(today, t.due)
    let when
    if (diff < 0) when = `เลยกำหนด ${-diff} วัน`
    else if (diff === 0) when = 'ครบกำหนดวันนี้'
    else if (diff === 1) when = 'พรุ่งนี้'
    else when = `อีก ${diff} วัน`
    lines.push(`• ${t.title} — ${formatThaiDate(t.due)} (${when})`)
  }
  for (const t of noDue) {
    lines.push(`• ${t.title} — ยังไม่กำหนดวันส่ง`)
  }

  const overdue = withDue.filter((t) => daysBetween(today, t.due) < 0).length
  const dueToday = withDue.filter((t) => daysBetween(today, t.due) === 0).length

  let title = `มีงานค้าง ${pending.length} รายการ`
  if (overdue > 0) title = `⚠️ เลยกำหนด ${overdue} · ค้างรวม ${pending.length} รายการ`
  else if (dueToday > 0) title = `วันนี้ต้องส่ง ${dueToday} · ค้างรวม ${pending.length} รายการ`

  return { title, body: lines.join('\n'), count: pending.length }
}

/**
 * ส่งข้อความไปยังทุกอุปกรณ์ คืนรายการอุปกรณ์ที่ยังใช้ได้
 * (ตัวที่เซิร์ฟเวอร์ push ตอบ 404/410 แปลว่าเลิกใช้แล้ว เอาออก)
 */
export async function sendToSubs(subs, payload) {
  const alive = []
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload))
        alive.push(sub)
      } catch (err) {
        const code = err?.statusCode
        if (code === 404 || code === 410) return // อุปกรณ์เลิกรับแล้ว
        alive.push(sub) // ผิดพลาดชั่วคราว เก็บไว้ลองใหม่คราวหน้า
      }
    }),
  )
  return alive
}
