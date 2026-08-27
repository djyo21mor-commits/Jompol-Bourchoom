import { store, json, CODE_RE, MAX_BYTES, tasksKey, readTasks } from './_lib.mjs'

/* ===========================================================================
   ที่เก็บงานค้างกลาง — ให้ทุกเครื่องที่ใส่รหัสเดียวกันเห็นงานชุดเดียวกัน
   และให้ฟังก์ชันตั้งเวลาตอนเช้าอ่านไปสรุปแจ้งเตือนได้

   เก็บงานทั้งหมดของหนึ่งรหัสเป็นเอกสาร JSON ก้อนเดียว ทุกครั้งที่บันทึก
   เลข version เพิ่มขึ้น 1 เครื่องที่จะบันทึกต้องบอกว่าอ่าน version ไหนไป
   ถ้าไม่ตรงกับของจริง เซิร์ฟเวอร์จะไม่เขียนทับ แต่ตอบ 409 พร้อมข้อมูลล่าสุดกลับไป
=========================================================================== */

/**
 * ตัวจัดการจริง แยกที่เก็บข้อมูลออกมาเป็นพารามิเตอร์ จะได้ทดสอบด้วยที่เก็บจำลองได้
 */
export async function handle(req, s) {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const code = url.searchParams.get('code') ?? ''
    if (!CODE_RE.test(code)) return json({ error: 'รหัสไม่ถูกต้อง' }, 400)

    const doc = await readTasks(s, code)
    if (url.searchParams.get('since') === String(doc.version)) {
      return json({ version: doc.version, unchanged: true })
    }
    return json({ version: doc.version, state: doc.state })
  }

  if (req.method === 'PUT') {
    let body
    try {
      body = await req.json()
    } catch {
      return json({ error: 'อ่านข้อมูลที่ส่งมาไม่ได้' }, 400)
    }

    const { code, baseVersion, state } = body ?? {}
    if (!CODE_RE.test(code ?? '')) return json({ error: 'รหัสไม่ถูกต้อง' }, 400)
    if (typeof baseVersion !== 'number' || baseVersion < 0) return json({ error: 'baseVersion ไม่ถูกต้อง' }, 400)
    if (!state || typeof state !== 'object') return json({ error: 'ไม่มีข้อมูลให้บันทึก' }, 400)

    const payload = JSON.stringify({ version: baseVersion + 1, state })
    if (payload.length > MAX_BYTES) return json({ error: 'ข้อมูลใหญ่เกินไป' }, 413)

    const current = await readTasks(s, code)
    if (current.version !== baseVersion) {
      return json({ conflict: true, version: current.version, state: current.state }, 409)
    }

    const conditions = current.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true }
    const res = await s.set(tasksKey(code), payload, conditions)
    if (!res.modified) {
      const latest = await readTasks(s, code)
      return json({ conflict: true, version: latest.version, state: latest.state }, 409)
    }

    return json({ version: baseVersion + 1 })
  }

  return json({ error: 'วิธีเรียกไม่ถูกต้อง' }, 405)
}

export default async function handler(req) {
  return handle(req, store())
}

export const config = { path: '/api/tasks' }
