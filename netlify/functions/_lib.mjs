import { getStore } from '@netlify/blobs'
import webpush from 'web-push'

/* ===========================================================================
   ตัวช่วยกลางของฝั่งเซิร์ฟเวอร์

   ข้อมูลทั้งหมดเก็บใน Netlify Blobs ที่เดียว ผูกกับ "รหัสเตือน" หนึ่งรหัส
   - งานค้างของแต่ละรหัส  →  คีย์  tasks/<รหัส>
   - อุปกรณ์ที่ขอรับแจ้งเตือน →  คีย์  subs/<รหัส>

   ฟังก์ชันตั้งเวลา (notify) จะไล่อ่านทุกคีย์ tasks/* ตอนเช้า แล้วส่ง Web Push
   ไปยังทุกอุปกรณ์ที่ผูกกับรหัสนั้น
=========================================================================== */

export const STORE = 'reminder-data'
export const CODE_RE = /^[A-Za-z0-9_-]{16,64}$/
export const MAX_BYTES = 8 * 1024 * 1024

/* --------------------------------------------------------------------------
   กุญแจ VAPID สำหรับเซ็นข้อความ Web Push

   คีย์สาธารณะเปิดเผยได้ (ฝังในหน้าเว็บอยู่แล้ว) ส่วนคีย์ลับควรตั้งผ่าน
   ตัวแปรสภาพแวดล้อมบน Netlify (VAPID_PRIVATE_KEY) ถ้าไม่ได้ตั้งจะใช้ค่าปริยาย
   ที่ให้มากับโปรเจกต์ ทำงานได้ทันทีแต่ควรสร้างชุดใหม่เมื่อใช้จริง (ดู docs/deploy.md)
-------------------------------------------------------------------------- */

export const VAPID_PUBLIC =
  process.env.VAPID_PUBLIC_KEY ??
  'BFUD_grCq4WFPAicnn95v51N4cT3QTGRA46gAdWfzr_Dk6OQ5uJiGmgUAKrocOl_w30Hn6RLOjqP2xqlbwoIcfE'

export const VAPID_PRIVATE =
  process.env.VAPID_PRIVATE_KEY ?? 'x3ptqnAqofT9-mOxhWzDC_I-VQ8ut6AqjrBqNVg-wQ4'

export const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:reminder@example.com'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
export { webpush }

/* --------------------------------------------------------------------------
   คำตอบ JSON แบบไม่ให้แคช
-------------------------------------------------------------------------- */

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })

export function store() {
  return getStore({ name: STORE, consistency: 'strong' })
}

export const tasksKey = (code) => `tasks/${code}`
export const subsKey = (code) => `subs/${code}`

/* --------------------------------------------------------------------------
   อ่าน/เขียนงานค้างของรหัสหนึ่ง — ใช้เลข version กันสองเครื่องเขียนทับกัน
-------------------------------------------------------------------------- */

export async function readTasks(s, code) {
  const found = await s.getWithMetadata(tasksKey(code), { type: 'json', consistency: 'strong' })
  if (!found) return { version: 0, state: null, etag: undefined }
  return { version: found.data?.version ?? 0, state: found.data?.state ?? null, etag: found.etag }
}

/* --------------------------------------------------------------------------
   รายการอุปกรณ์ที่ขอรับแจ้งเตือนของรหัสหนึ่ง
-------------------------------------------------------------------------- */

export async function readSubs(s, code) {
  const data = await s.get(subsKey(code), { type: 'json', consistency: 'strong' })
  const list = Array.isArray(data?.subscriptions) ? data.subscriptions : []
  return list
}

export async function writeSubs(s, code, subscriptions) {
  await s.setJSON(subsKey(code), { subscriptions })
}
