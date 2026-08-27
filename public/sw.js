/* Service worker — รับข้อความ Web Push แล้วแสดงการแจ้งเตือน
   และเปิดแอปเมื่อผู้ใช้แตะการแจ้งเตือน */

self.addEventListener('push', (event) => {
  let data = { title: 'งานค้าง', body: '' }
  try {
    if (event.data) data = event.data.json()
  } catch {
    if (event.data) data = { title: 'งานค้าง', body: event.data.text() }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'งานค้าง', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'reminder',
      renotify: true,
      lang: 'th',
      requireInteraction: false,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow('/')
    }),
  )
})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
