import { beforeEach, describe, expect, it } from 'vitest'

/* ที่เก็บข้อมูลปลอมสำหรับเทสต์ — เลียนแบบ Netlify Blobs เท่าที่ฟังก์ชันนี้ใช้จริง */
const blobs = new Map()
let etagSeq = 0

const fakeStore = {
  async getWithMetadata(key) {
    const found = blobs.get(key)
    return found ? { data: JSON.parse(found.body), etag: found.etag } : null
  },
  async set(key, body, conditions = {}) {
    const found = blobs.get(key)
    if (conditions.onlyIfNew && found) return { modified: false }
    if (conditions.onlyIfMatch && found?.etag !== conditions.onlyIfMatch) return { modified: false }
    const etag = `e${++etagSeq}`
    blobs.set(key, { body, etag })
    return { modified: true, etag }
  },
}

const { handle } = await import('./shop.mjs')
const handler = (req) => handle(req, fakeStore)

const CODE = 'ABC123-DEF456-GHJ789-KLM234'

const get = (code, since) =>
  handler(new Request(`https://example.test/api/shop?code=${encodeURIComponent(code)}${since === undefined ? '' : `&since=${since}`}`))

const put = (body) =>
  handler(
    new Request('https://example.test/api/shop', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  blobs.clear()
  etagSeq = 0
})

describe('ที่เก็บข้อมูลกลางของร้าน', () => {
  it('รหัสที่ยังไม่มีข้อมูล ตอบ version 0 และ state ว่าง', async () => {
    const res = await get(CODE)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ version: 0, state: null })
  })

  it('บันทึกครั้งแรกแล้วอ่านกลับมาได้', async () => {
    const saved = await put({ code: CODE, baseVersion: 0, state: { items: ['มะม่วง'] } })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ version: 1 })

    const res = await get(CODE)
    expect(await res.json()).toEqual({ version: 1, state: { items: ['มะม่วง'] } })
  })

  it('ถ้ายังเป็น version เดิม ไม่ต้องส่งข้อมูลก้อนใหญ่กลับมา', async () => {
    await put({ code: CODE, baseVersion: 0, state: { a: 1 } })
    const res = await get(CODE, 1)
    expect(await res.json()).toEqual({ version: 1, unchanged: true })
  })

  it('อีกเครื่องบันทึกแทรกไปก่อน ต้องไม่เขียนทับ แต่ส่งข้อมูลล่าสุดกลับไป', async () => {
    await put({ code: CODE, baseVersion: 0, state: { by: 'สามี' } })

    // ภรรยายังถือ version 0 อยู่
    const res = await put({ code: CODE, baseVersion: 0, state: { by: 'ภรรยา' } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ conflict: true, version: 1, state: { by: 'สามี' } })

    // ข้อมูลบนเซิร์ฟเวอร์ต้องยังเป็นของสามี ไม่โดนทับ
    const after = await get(CODE)
    expect((await after.json()).state).toEqual({ by: 'สามี' })
  })

  it('บันทึกต่อจาก version ล่าสุดได้ตามปกติ', async () => {
    await put({ code: CODE, baseVersion: 0, state: { n: 1 } })
    const res = await put({ code: CODE, baseVersion: 1, state: { n: 2 } })
    expect(await res.json()).toEqual({ version: 2 })
  })

  it('รหัสร้านคนละรหัส ข้อมูลไม่ปนกัน', async () => {
    const other = 'ZZZ999-YYY888-XXX777-WWW666'
    await put({ code: CODE, baseVersion: 0, state: { shop: 'ก' } })
    await put({ code: other, baseVersion: 0, state: { shop: 'ข' } })

    expect((await (await get(CODE)).json()).state).toEqual({ shop: 'ก' })
    expect((await (await get(other)).json()).state).toEqual({ shop: 'ข' })
  })

  it('รหัสสั้นเกินไปหรือมีอักขระแปลกๆ ไม่รับ', async () => {
    expect((await get('สั้น')).status).toBe(400)
    expect((await put({ code: 'AB', baseVersion: 0, state: {} })).status).toBe(400)
  })

  it('ไม่มี state มาให้ ไม่บันทึก', async () => {
    expect((await put({ code: CODE, baseVersion: 0 })).status).toBe(400)
  })

  it('วิธีเรียกอื่นไม่รองรับ', async () => {
    const res = await handler(new Request('https://example.test/api/shop', { method: 'DELETE' }))
    expect(res.status).toBe(405)
  })
})
