import { store, json, CODE_RE, VAPID_PUBLIC, readTasks, readSubs, writeSubs } from './_lib.mjs'
import { buildSummary, sendToSubs } from './_notify.mjs'

/* ===========================================================================
   จัดการอุปกรณ์ที่ขอรับแจ้งเตือน (Web Push)

   GET    /api/push                     → คืนคีย์สาธารณะ VAPID ให้หน้าเว็บใช้สมัคร
   POST   /api/push        {code, subscription}  → เพิ่มอุปกรณ์ (กันซ้ำด้วย endpoint)
   POST   /api/push?test=1 {code}                → ส่งแจ้งเตือนทดสอบเดี๋ยวนี้
   DELETE /api/push        {code, endpoint}      → เอาอุปกรณ์ออก
=========================================================================== */

export async function handle(req, s) {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    return json({ vapidPublicKey: VAPID_PUBLIC })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'อ่านข้อมูลที่ส่งมาไม่ได้' }, 400)
  }
  const code = body?.code ?? ''
  if (!CODE_RE.test(code)) return json({ error: 'รหัสไม่ถูกต้อง' }, 400)

  if (req.method === 'POST' && url.searchParams.get('test') === '1') {
    const doc = await readTasks(s, code)
    const subs = await readSubs(s, code)
    if (subs.length === 0) return json({ error: 'ยังไม่มีอุปกรณ์ที่เปิดรับแจ้งเตือน' }, 400)
    const summary = buildSummary(doc.state?.tasks ?? []) ?? {
      title: 'ยังไม่มีงานค้าง 🎉',
      body: 'ทดสอบแจ้งเตือน — เมื่อมีงานค้าง ระบบจะสรุปมาให้ทุกเช้า 7 โมง',
    }
    const alive = await sendToSubs(subs, { ...summary, tag: 'reminder-test' })
    if (alive.length !== subs.length) await writeSubs(s, code, alive)
    return json({ sent: alive.length })
  }

  if (req.method === 'POST') {
    const sub = body?.subscription
    if (!sub || typeof sub.endpoint !== 'string') return json({ error: 'ข้อมูลการสมัครไม่ถูกต้อง' }, 400)
    const subs = await readSubs(s, code)
    const next = subs.filter((x) => x.endpoint !== sub.endpoint)
    next.push(sub)
    await writeSubs(s, code, next)
    return json({ ok: true, devices: next.length })
  }

  if (req.method === 'DELETE') {
    const endpoint = body?.endpoint
    if (typeof endpoint !== 'string') return json({ error: 'ไม่มี endpoint ให้ลบ' }, 400)
    const subs = await readSubs(s, code)
    const next = subs.filter((x) => x.endpoint !== endpoint)
    await writeSubs(s, code, next)
    return json({ ok: true, devices: next.length })
  }

  return json({ error: 'วิธีเรียกไม่ถูกต้อง' }, 405)
}

export default async function handler(req) {
  return handle(req, store())
}

export const config = { path: '/api/push' }
