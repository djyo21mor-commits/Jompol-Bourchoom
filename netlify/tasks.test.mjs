import { describe, it, expect } from 'vitest'
import { handle } from './functions/tasks.mjs'

/* ที่เก็บจำลองในหน่วยความจำ เลียนแบบ Netlify Blobs เท่าที่ handler ใช้ */
function mockStore() {
  const data = new Map()
  let seq = 0
  return {
    async getWithMetadata(key, { type } = {}) {
      const row = data.get(key)
      if (!row) return null
      return { data: type === 'json' ? JSON.parse(row.body) : row.body, etag: row.etag }
    },
    async set(key, body, conditions = {}) {
      const cur = data.get(key)
      if (conditions.onlyIfNew && cur) return { modified: false }
      if (conditions.onlyIfMatch && (!cur || cur.etag !== conditions.onlyIfMatch)) return { modified: false }
      data.set(key, { body, etag: `e${++seq}` })
      return { modified: true }
    },
  }
}

const req = (method, body, query = '') =>
  new Request(`https://x/api/tasks${query}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

const CODE = 'ABCDEF-GHJKMN-PQRSTU-VWXYZ2'

describe('tasks API', () => {
  it('รหัสไม่ถูกต้อง → 400', async () => {
    const res = await handle(req('GET', null, '?code=สั้น'), mockStore())
    expect(res.status).toBe(400)
  })

  it('อ่านครั้งแรกได้ version 0 และ state ว่าง', async () => {
    const res = await handle(req('GET', null, `?code=${CODE}`), mockStore())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ version: 0, state: null })
  })

  it('บันทึกแล้วอ่านกลับมาได้', async () => {
    const s = mockStore()
    const state = { tasks: [{ id: '1', title: 'ส่งงาน', due: '2026-09-01', done: false }] }
    const put = await handle(req('PUT', { code: CODE, baseVersion: 0, state }), s)
    expect(put.status).toBe(200)
    expect(await put.json()).toEqual({ version: 1 })

    const get = await handle(req('GET', null, `?code=${CODE}`), s)
    expect(await get.json()).toEqual({ version: 1, state })
  })

  it('ข้าม version เดิมด้วย since', async () => {
    const s = mockStore()
    await handle(req('PUT', { code: CODE, baseVersion: 0, state: { tasks: [] } }), s)
    const res = await handle(req('GET', null, `?code=${CODE}&since=1`), s)
    expect(await res.json()).toEqual({ version: 1, unchanged: true })
  })

  it('บันทึกทับด้วย baseVersion เก่า → 409 พร้อมข้อมูลล่าสุด', async () => {
    const s = mockStore()
    await handle(req('PUT', { code: CODE, baseVersion: 0, state: { tasks: [{ id: '1' }] } }), s)
    const res = await handle(req('PUT', { code: CODE, baseVersion: 0, state: { tasks: [] } }), s)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.conflict).toBe(true)
    expect(body.version).toBe(1)
  })
})
