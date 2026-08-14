import { describe, expect, it } from 'vitest'
import type { AppState } from '../types'
import { reducer, DEFAULT_SETTINGS } from './store'
import { isValidCode, mergeShared, newShopCode, normalizeCode, toShared } from './sync'

function blank(): AppState {
  return {
    items: [],
    purchases: [],
    recipes: [],
    productions: [],
    lots: [],
    sales: [],
    wastes: [],
    transactions: [],
    assets: [],
    settings: { ...DEFAULT_SETTINGS },
    chat: [],
    snapshots: [],
  }
}

const type = (state: AppState, text: string, channel: 'shop' | 'money' = 'shop') =>
  reducer(state, { type: 'chat/send', text, channel })

describe('รหัสร้าน', () => {
  it('สุ่มยาวพอที่จะเดาไม่ได้ และไม่ซ้ำกัน', () => {
    const a = newShopCode()
    const b = newShopCode()
    expect(a).not.toBe(b)
    expect(a.replace(/-/g, '').length).toBe(24)
    expect(isValidCode(a)).toBe(true)
  })

  it('ตัดตัวอักษรที่สับสนออก ไม่มี 0 O 1 I L', () => {
    const codes = Array.from({ length: 40 }, () => newShopCode()).join('')
    expect(codes).not.toMatch(/[01OIL]/)
  })

  it('พิมพ์ตัวเล็กหรือมีช่องว่างติดมา ก็ยังใช้ได้', () => {
    expect(normalizeCode('  abc123-def456-ghj789-klm234 ')).toBe('ABC123-DEF456-GHJ789-KLM234')
    expect(isValidCode(normalizeCode(' abc123-def456-ghj789-klm234 '))).toBe(true)
  })

  it('รหัสสั้นเกินไปไม่รับ', () => {
    expect(isValidCode('ABC123')).toBe(false)
    expect(isValidCode('')).toBe(false)
  })
})

describe('ข้อมูลที่แชร์กัน', () => {
  it('ไม่ส่งของเฉพาะเครื่องขึ้นไป — ปุ่มย้อนกลับและสูตรที่รอยืนยัน', () => {
    const state = type(blank(), 'ซื้อมะม่วง 3 กิโล ราคารวม 300 บาท')
    const shared = toShared(state) as Record<string, unknown>

    expect(state.snapshots.length).toBeGreaterThan(0)
    expect(shared.snapshots).toBeUndefined()
    expect(shared.pendingRecipe).toBeUndefined()
    expect(shared.purchases).toHaveLength(1)
  })

  it('รับข้อมูลจากอีกเครื่อง แต่ชื่อคนบันทึกกับธีมสียังเป็นของเครื่องนี้', () => {
    const local: AppState = {
      ...blank(),
      settings: { ...DEFAULT_SETTINGS, currentPerson: 'ภรรยา', theme: 'dark' },
    }
    const remote = toShared({
      ...type(blank(), 'ซื้อมะม่วง 3 กิโล ราคารวม 300 บาท'),
      settings: { ...DEFAULT_SETTINGS, currentPerson: 'สามี', theme: 'light', shopName: 'ร้านใหม่' },
    })

    const merged = mergeShared(local, remote)
    expect(merged.settings.currentPerson).toBe('ภรรยา')
    expect(merged.settings.theme).toBe('dark')
    expect(merged.settings.shopName).toBe('ร้านใหม่') // ชื่อร้านเป็นของร่วมกัน จึงตามอีกเครื่อง
    expect(merged.purchases).toHaveLength(1)
    expect(merged.snapshots).toEqual([]) // ย้อนกลับข้ามการซิงค์ไม่ได้
  })
})

describe('สองเครื่องบันทึกพร้อมกัน', () => {
  it('ของทั้งสองคนอยู่ครบ ไม่มีใครโดนเขียนทับ', () => {
    const base = blank()

    // สามีพิมพ์ในเครื่องตัวเอง แล้วส่งขึ้นเซิร์ฟเวอร์ก่อน
    const husband = type(base, 'ซื้อมะม่วง 3 กิโล ราคารวม 300 บาท')
    const onServer = toShared(husband)

    // ภรรยาพิมพ์จากข้อมูลชุดเดิม ยังไม่ทันเห็นของสามี
    const wifeAction = { type: 'chat/send' as const, text: 'จ่ายค่าเช่าร้าน 5000 บาท', channel: 'money' as const }
    const wifeLocal = reducer(base, wifeAction)
    expect(wifeLocal.purchases).toHaveLength(0)

    // ส่งไม่ผ่านเพราะชนกัน -> รับของสามีมาแล้วทำของตัวเองซ้ำทับ
    const settled = reducer(wifeLocal, { type: 'sync/adopt', shared: onServer, replay: [wifeAction] })

    expect(settled.purchases).toHaveLength(1)
    expect(settled.purchases[0].itemName).toBe('มะม่วง')
    expect(settled.transactions).toHaveLength(1)
    expect(settled.transactions[0]).toMatchObject({ category: 'ค่าเช่าร้าน', amount: 5000 })
    // ข้อความในแชทของทั้งสองคนอยู่ครบ
    expect(settled.chat.some((m) => m.text.includes('ซื้อมะม่วง'))).toBe(true)
    expect(settled.chat.some((m) => m.text.includes('ค่าเช่าร้าน'))).toBe(true)
  })

  it('ไม่มีอะไรค้างอยู่ ให้ใช้ข้อมูลจากเซิร์ฟเวอร์ตรงๆ', () => {
    const remote = toShared(type(blank(), 'ซื้อมะม่วง 3 กิโล ราคารวม 300 บาท'))
    const settled = reducer(blank(), { type: 'sync/adopt', shared: remote, replay: [] })

    expect(settled.purchases).toHaveLength(1)
    expect(settled.items[0].stock).toBe(3000)
  })

  it('ทำซ้ำแล้วสต็อกไม่บวมเกินจริง เพราะเริ่มจากข้อมูลของเซิร์ฟเวอร์เสมอ', () => {
    const base = blank()
    const buy = { type: 'chat/send' as const, text: 'ซื้อมะม่วง 3 กิโล ราคารวม 300 บาท', channel: 'shop' as const }

    const mine = reducer(base, buy)
    const theirs = toShared(reducer(base, { type: 'chat/send', text: 'ซื้อนม 2 ลิตร ราคารวม 100 บาท', channel: 'shop' }))
    const settled = reducer(mine, { type: 'sync/adopt', shared: theirs, replay: [buy] })

    const mango = settled.items.find((i) => i.name === 'มะม่วง')!
    expect(mango.stock).toBe(3000) // ไม่ใช่ 6000
    expect(settled.items.some((i) => i.name === 'นม')).toBe(true)
  })
})
