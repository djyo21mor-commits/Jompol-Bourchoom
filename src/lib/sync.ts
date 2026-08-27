import type { AppState } from '../types'

/* ===========================================================================
   คุยกับเซิร์ฟเวอร์เก็บงานกลาง

   งานทั้งหมดของหนึ่ง "รหัสเตือน" เก็บเป็นก้อนเดียวบนเซิร์ฟเวอร์
   จำเป็นต้องมี เพราะฟังก์ชันตั้งเวลาตอนเช้าอ่านงานจากที่นี่ไปแจ้งเตือน
   และยังทำให้เปิดรายการเดียวกันบนอีกเครื่องได้ด้วยการใส่รหัสเดียวกัน
=========================================================================== */

export const API = '/api/tasks'
export const API_FALLBACK = '/.netlify/functions/tasks'

let endpoint = API

async function callApi(path: string, init?: RequestInit): Promise<Response> {
  const attempt = (base: string) => fetch(base + path, init)
  const res = await attempt(endpoint)
  if (!looksLikeApi(res) && endpoint !== API_FALLBACK) {
    const alt = await attempt(API_FALLBACK)
    if (looksLikeApi(alt)) {
      endpoint = API_FALLBACK
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

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 24

/** รหัสสุ่ม 24 ตัว ตัดตัวที่สับสน (0/O, 1/I/L) ออก ใครถือรหัสนี้เข้าถึงงานได้ */
export function newCode(): string {
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

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '')
}

export function isValidCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(code)
}

export interface PullResult {
  version: number
  state: AppState | null
  unchanged?: boolean
}

export type PushResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; version: number; state: AppState }

export async function pullTasks(code: string, since: number, signal?: AbortSignal): Promise<PullResult> {
  const res = await callApi(`?code=${encodeURIComponent(code)}&since=${since}`, { signal })
  if (!res.ok || !looksLikeApi(res)) throw new Error(await errorText(res))
  return (await res.json()) as PullResult
}

export async function pushTasks(
  code: string,
  baseVersion: number,
  state: AppState,
  signal?: AbortSignal,
): Promise<PushResult> {
  const res = await callApi('', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, baseVersion, state }),
    signal,
  })
  if (res.status === 409) {
    const body = (await res.json()) as { version: number; state: AppState }
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
    /* ไม่ใช่ JSON */
  }
  if (!looksLikeApi(res)) {
    return 'ลิงก์นี้ยังไม่ได้ต่อกับเซิร์ฟเวอร์ — ต้องเปิดจากลิงก์ที่ติดตั้งบน Netlify (ดู docs/deploy.md)'
  }
  return `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${res.status})`
}
