/* ===========================================================================
   เปิด/ปิดการรับแจ้งเตือนแบบ Web Push บนเครื่องนี้

   ขั้นตอน: ลงทะเบียน service worker → ขออนุญาตแจ้งเตือน → สมัครกับเบราว์เซอร์
   แล้วส่งข้อมูลการสมัครขึ้นเซิร์ฟเวอร์ ผูกกับรหัสเตือน
=========================================================================== */

const PUSH_API = '/api/push'
const PUSH_API_FALLBACK = '/.netlify/functions/push'

export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function permission(): NotificationPermission {
  return typeof Notification !== 'undefined' ? Notification.permission : 'denied'
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(PUSH_API + path, init)
  if (res.status === 404 || !(res.headers.get('content-type') ?? '').includes('json')) {
    return fetch(PUSH_API_FALLBACK + path, init)
  }
  return res
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration()
  if (existing) return existing
  return navigator.serviceWorker.register('/sw.js')
}

/** อุปกรณ์นี้กำลังรับแจ้งเตือนอยู่หรือไม่ */
export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return false
  return !!(await reg.pushManager.getSubscription())
}

/** เปิดรับแจ้งเตือนบนเครื่องนี้ ผูกกับรหัสที่ให้มา */
export async function enablePush(code: string): Promise<void> {
  if (!pushSupported()) throw new Error('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน')

  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('ยังไม่ได้อนุญาตให้แจ้งเตือน')

  const keyRes = await api('', { method: 'GET' })
  const { vapidPublicKey } = (await keyRes.json()) as { vapidPublicKey: string }

  const reg = await registration()
  await navigator.serviceWorker.ready

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    })
  }

  const res = await api('', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, subscription: sub.toJSON() }),
  })
  if (!res.ok) throw new Error('บันทึกการสมัครไม่สำเร็จ')
}

/** ปิดรับแจ้งเตือนบนเครื่องนี้ */
export async function disablePush(code: string): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await api('', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, endpoint: sub.endpoint }),
  }).catch(() => {})
  await sub.unsubscribe()
}

/** ส่งแจ้งเตือนทดสอบเดี๋ยวนี้ คืนจำนวนอุปกรณ์ที่ส่งถึง */
export async function sendTest(code: string): Promise<number> {
  const res = await api('?test=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  const body = (await res.json()) as { sent?: number; error?: string }
  if (!res.ok) throw new Error(body.error ?? 'ส่งทดสอบไม่สำเร็จ')
  return body.sent ?? 0
}
