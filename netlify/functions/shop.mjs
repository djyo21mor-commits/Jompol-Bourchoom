import { getStore } from '@netlify/blobs'

/* ===========================================================================
   ที่เก็บข้อมูลกลางของร้าน — ให้สองเครื่องอ่านเขียนข้อมูลชุดเดียวกัน

   เก็บทั้งร้านเป็นเอกสาร JSON ก้อนเดียวต่อ "รหัสร้าน" 1 รหัส
   ทุกครั้งที่บันทึก เลข version จะเพิ่มขึ้น 1

   กันสองเครื่องเขียนทับกัน: เครื่องที่จะบันทึกต้องบอกมาว่าอ่าน version ไหนไป
   ถ้าไม่ตรงกับของจริง เซิร์ฟเวอร์จะไม่เขียนทับ แต่ตอบ 409 พร้อมข้อมูลล่าสุดกลับไป
   ให้เครื่องนั้นเอาสิ่งที่เพิ่งพิมพ์ไปทำซ้ำบนข้อมูลใหม่แล้วส่งมาอีกที
   (ใช้ onlyIfMatch ของ Netlify Blobs เทียบ ETag อีกชั้น กันจังหวะที่ชนกันพอดี)
=========================================================================== */

const STORE = 'shop-data'
const CODE_RE = /^[A-Za-z0-9_-]{16,64}$/
const MAX_BYTES = 8 * 1024 * 1024

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })

function keyOf(code) {
  return `shop/${code}`
}

async function read(store, code) {
  const found = await store.getWithMetadata(keyOf(code), { type: 'json', consistency: 'strong' })
  if (!found) return { version: 0, state: null, etag: undefined }
  return { version: found.data?.version ?? 0, state: found.data?.state ?? null, etag: found.etag }
}

/**
 * ตัวจัดการจริง แยกที่เก็บข้อมูลออกมาเป็นพารามิเตอร์
 * จะได้ทดสอบด้วยที่เก็บจำลองได้โดยไม่ต้องมี Netlify
 */
export async function handle(req, store) {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const code = url.searchParams.get('code') ?? ''
    if (!CODE_RE.test(code)) return json({ error: 'รหัสร้านไม่ถูกต้อง' }, 400)

    const doc = await read(store, code)
    // ส่ง version มาด้วยเสมอ เครื่องที่ยังไม่มีอะไรเปลี่ยนจะได้ข้ามการดึงข้อมูลก้อนใหญ่
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
    if (!CODE_RE.test(code ?? '')) return json({ error: 'รหัสร้านไม่ถูกต้อง' }, 400)
    if (typeof baseVersion !== 'number' || baseVersion < 0) return json({ error: 'baseVersion ไม่ถูกต้อง' }, 400)
    if (!state || typeof state !== 'object') return json({ error: 'ไม่มีข้อมูลให้บันทึก' }, 400)

    const payload = JSON.stringify({ version: baseVersion + 1, state })
    if (payload.length > MAX_BYTES) return json({ error: 'ข้อมูลใหญ่เกินไป' }, 413)

    const current = await read(store, code)
    if (current.version !== baseVersion) {
      return json({ conflict: true, version: current.version, state: current.state }, 409)
    }

    const conditions = current.etag ? { onlyIfMatch: current.etag } : { onlyIfNew: true }
    const res = await store.set(keyOf(code), payload, conditions)
    if (!res.modified) {
      // มีเครื่องอื่นเขียนแทรกพอดีระหว่างที่เรากำลังเขียน — ให้ฝั่งนั้นชนะแล้วบอกให้ลองใหม่
      const latest = await read(store, code)
      return json({ conflict: true, version: latest.version, state: latest.state }, 409)
    }

    return json({ version: baseVersion + 1 })
  }

  return json({ error: 'วิธีเรียกไม่ถูกต้อง' }, 405)
}

export default async function handler(req) {
  return handle(req, getStore({ name: STORE, consistency: 'strong' }))
}

export const config = { path: '/api/shop' }
