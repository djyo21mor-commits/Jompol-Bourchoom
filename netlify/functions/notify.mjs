import { store, readTasks, readSubs, writeSubs } from './_lib.mjs'
import { buildSummary, sendToSubs } from './_notify.mjs'

/* ===========================================================================
   ฟังก์ชันตั้งเวลา — เตือนงานค้างทุกเช้า 7 โมง (เวลาไทย)

   Netlify นับเวลาแบบ UTC  →  7 โมงเช้าไทย (UTC+7) ตรงกับ 00:00 UTC
   จึงตั้ง schedule ไว้ที่ "0 0 * * *"

   ทุกครั้งที่ถึงเวลา จะไล่อ่านงานค้างของทุกรหัส สรุปเป็นข้อความ
   แล้วส่ง Web Push ไปยังทุกอุปกรณ์ที่ผูกกับรหัสนั้น
=========================================================================== */

export async function runNotify(s) {
  const { blobs } = await s.list({ prefix: 'tasks/' })
  let codes = 0
  let sent = 0

  for (const blob of blobs) {
    const code = blob.key.slice('tasks/'.length)
    if (!code) continue

    const subs = await readSubs(s, code)
    if (subs.length === 0) continue

    const doc = await readTasks(s, code)
    const summary = buildSummary(doc.state?.tasks ?? [])
    if (!summary) continue // ไม่มีงานค้าง ไม่ต้องรบกวน

    const alive = await sendToSubs(subs, { ...summary, tag: 'reminder-daily' })
    if (alive.length !== subs.length) await writeSubs(s, code, alive)
    codes += 1
    sent += alive.length
  }

  return { codes, sent }
}

export default async function handler() {
  const result = await runNotify(store())
  return new Response(JSON.stringify(result), {
    headers: { 'content-type': 'application/json' },
  })
}

// 00:00 UTC = 07:00 น. ตามเวลาประเทศไทย
export const config = { schedule: '0 0 * * *' }
