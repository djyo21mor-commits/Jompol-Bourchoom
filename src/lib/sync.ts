import type { AppState } from '../types'

/* ===========================================================================
   ใช้ร่วมกันสองเครื่อง

   ข้อมูลทั้งร้านถูกเก็บเป็นก้อนเดียวบนเซิร์ฟเวอร์ ผูกกับ "รหัสร้าน" หนึ่งรหัส
   ทุกเครื่องที่ใส่รหัสเดียวกันจะเห็นข้อมูลชุดเดียวกัน

   กันเขียนทับกัน: ตอนบันทึกต้องบอกไปว่าอ่าน version ไหนมา ถ้าไม่ตรงแปลว่าอีกเครื่อง
   บันทึกแทรกไปก่อน เซิร์ฟเวอร์จะส่งข้อมูลล่าสุดกลับมา แล้วเครื่องนี้จะเอาสิ่งที่
   เพิ่งพิมพ์ (ที่ยังไม่ได้ขึ้นเซิร์ฟเวอร์) ไปทำซ้ำบนข้อมูลใหม่แล้วส่งขึ้นไปอีกรอบ
   ทำแบบนี้ได้เพราะ reducer ของแอปเป็นฟังก์ชันบริสุทธิ์ ผลลัพธ์จึงคาดเดาได้
=========================================================================== */

export const SYNC_API = '/api/shop'
/** เผื่อกฎ redirect ของ Netlify ไม่ทำงาน ยังเรียกฟังก์ชันตรงๆ ได้ */
export const SYNC_API_FALLBACK = '/.netlify/functions/shop'

let endpoint = SYNC_API

/**
 * ถ้าเส้นทางหลักหาไม่เจอ ให้ลองเส้นทางสำรองอีกรอบแล้วจำไว้ใช้ต่อ
 * หน้าเว็บของเราเป็นหน้าเดียว เส้นทางที่ไม่มีจริงจะได้ index.html กลับมา (200 แต่เป็น HTML)
 * จึงต้องเช็คชนิดข้อมูลด้วย ไม่ใช่ดูแค่รหัสสถานะ
 */
async function callApi(path: string, init?: RequestInit): Promise<Response> {
  const attempt = (base: string) => fetch(base + path, init)

  let res = await attempt(endpoint)
  if (!looksLikeApi(res) && endpoint !== SYNC_API_FALLBACK) {
    const alt = await attempt(SYNC_API_FALLBACK)
    if (looksLikeApi(alt)) {
      endpoint = SYNC_API_FALLBACK
      return alt
    }
    return res
  }
  return res
}

function looksLikeApi(res: Response): boolean {
  if (res.status === 404) return false
  return (res.headers.get('content-type') ?? '').includes('json')
}

/** ค่าที่เก็บเฉพาะเครื่องนี้ ไม่ได้ส่งขึ้นเซิร์ฟเวอร์ */
export interface SyncConfig {
  code: string
  enabled: boolean
}

export const EMPTY_SYNC: SyncConfig = { code: '', enabled: false }

const CONFIG_KEY = 'jompol-sync-v1'

export function loadSyncConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return EMPTY_SYNC
    const parsed = JSON.parse(raw) as Partial<SyncConfig>
    return { code: parsed.code ?? '', enabled: !!parsed.enabled && !!parsed.code }
  } catch {
    return EMPTY_SYNC
  }
}

export function saveSyncConfig(config: SyncConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch {
    /* เบราว์เซอร์ไม่ให้เขียน ก็ปล่อยไป ครั้งหน้าค่อยตั้งใหม่ */
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 24

/**
 * รหัสร้านแบบสุ่ม 24 ตัว — ใครถือรหัสนี้เข้าถึงข้อมูลได้ จึงต้องเดาไม่ได้
 * ตัดตัวที่สับสนออก (0/O, 1/I/L) เพราะต้องอ่านออกเสียงหรือพิมพ์ตามกันได้
 * ทิ้งค่าที่หารไม่ลงตัวแล้วสุ่มใหม่ ทุกตัวอักษรจะได้มีโอกาสออกเท่ากันจริงๆ
 */
export function newShopCode(): string {
  const limit = 256 - (256 % CODE_ALPHABET.length)
  let body = ''
  while (body.length < CODE_LENGTH) {
    const bytes = new Uint8Array(CODE_LENGTH)
    crypto.getRandomValues(bytes)
    for (const b of bytes) {
      if (b >= limit || body.length >= CODE_LENGTH) continue
      body += CODE_ALPHABET[b % CODE_ALPHABET.length]
    }
  }
  return body.replace(/(.{6})(?=.)/g, '$1-')
}

/** รหัสที่ยอมรับ — ขีดคั่นใส่หรือไม่ใส่ก็ได้ */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '')
}

export function isValidCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(code)
}

/**
 * ส่วนของข้อมูลที่แชร์กัน
 * ไม่รวม snapshots (ปุ่มย้อนกลับของเครื่องนี้) และสูตรที่รอยืนยัน เพราะเป็นของชั่วคราวรายเครื่อง
 */
export type SharedState = Omit<AppState, 'snapshots' | 'pendingRecipe'>

export function toShared(state: AppState): SharedState {
  const { snapshots: _snapshots, pendingRecipe: _pendingRecipe, ...shared } = state
  return shared
}

/**
 * เอาข้อมูลจากเซิร์ฟเวอร์มาใช้ แต่คงค่าที่เป็นของเครื่องนี้ไว้
 * ชื่อคนที่กำลังบันทึกกับธีมสี ต่างคนต่างตั้ง ไม่ควรโดนอีกเครื่องเปลี่ยนให้
 */
export function mergeShared(local: AppState, shared: SharedState): AppState {
  return {
    ...shared,
    settings: {
      ...shared.settings,
      currentPerson: local.settings.currentPerson,
      theme: local.settings.theme,
    },
    pendingRecipe: local.pendingRecipe,
    // ย้อนกลับข้ามการซิงค์ไม่ได้ เพราะสถานะก่อนหน้าเป็นของเครื่องนี้ล้วนๆ
    snapshots: [],
  }
}

/* --------------------------------------------------------------------------
   คุยกับเซิร์ฟเวอร์
-------------------------------------------------------------------------- */

export interface PullResult {
  version: number
  /** null = ยังไม่เคยมีข้อมูลของรหัสนี้บนเซิร์ฟเวอร์ */
  state: SharedState | null
  /** true = ยังเป็น version เดิมที่เครื่องนี้มีอยู่แล้ว ไม่ต้องเอาข้อมูลมาทั้งก้อน */
  unchanged?: boolean
}

export type PushResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; version: number; state: SharedState }

export async function pullShop(code: string, since: number, signal?: AbortSignal): Promise<PullResult> {
  const res = await callApi(`?code=${encodeURIComponent(code)}&since=${since}`, { signal })
  if (!res.ok || !looksLikeApi(res)) throw new Error(await errorText(res))
  return (await res.json()) as PullResult
}

export async function pushShop(
  code: string,
  baseVersion: number,
  state: SharedState,
  signal?: AbortSignal,
): Promise<PushResult> {
  const res = await callApi('', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, baseVersion, state }),
    signal,
  })

  if (res.status === 409) {
    const body = (await res.json()) as { version: number; state: SharedState }
    return { ok: false, conflict: true, version: body.version, state: body.state }
  }
  if (!res.ok || !looksLikeApi(res)) throw new Error(await errorText(res))

  const body = (await res.json()) as { version: number }
  return { ok: true, version: body.version }
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    /* ไม่ใช่ JSON ก็ใช้ข้อความมาตรฐาน */
  }
  if (!looksLikeApi(res)) {
    return 'ลิงก์นี้ยังไม่มีตัวเก็บข้อมูลกลาง — ต้องเปิดจากลิงก์ร้านที่ติดตั้งไว้เอง (ดู docs/deploy.md)'
  }
  return `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${res.status})`
}

/* --------------------------------------------------------------------------
   สถานะที่เอาไปแสดงในหน้าตั้งค่า
-------------------------------------------------------------------------- */

export type SyncPhase = 'off' | 'connecting' | 'ok' | 'saving' | 'error'

export interface SyncStatus {
  phase: SyncPhase
  /** เวลาที่ซิงค์สำเร็จครั้งล่าสุด */
  lastAt?: string
  /** จำนวนที่พิมพ์ไว้แต่ยังไม่ได้ขึ้นเซิร์ฟเวอร์ */
  pending: number
  version: number
  message?: string
}

export const IDLE_STATUS: SyncStatus = { phase: 'off', pending: 0, version: 0 }
