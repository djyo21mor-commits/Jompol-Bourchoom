/* ===========================================================================
   ดาวน์โหลดไฟล์ให้ได้ทั้งสองที่:
   - เปิดแอปตรงๆ (localhost / เว็บของตัวเอง) -> สร้างลิงก์แล้วกดเอง
   - เปิดผ่านหน้าแชร์ของ claude.ai -> ต้องขออนุญาตผู้ใช้ผ่าน window.claude.downloads
     เพราะหน้าแบบนั้นบล็อกการดาวน์โหลดที่หน้าเว็บสั่งเอง
=========================================================================== */

interface ClaudeDownloads {
  save(request: { filename: string; data: string | Blob }): Promise<{ status: 'saved' }>
}

function claudeDownloads(): ClaudeDownloads | undefined {
  return (globalThis as { claude?: { downloads?: ClaudeDownloads } }).claude?.downloads
}

export type DownloadOutcome =
  | { ok: true; note?: string }
  | { ok: false; reason: 'declined' | 'error'; message: string }

/** วิธีเดิม: สร้าง <a download> แล้วกดแทนผู้ใช้ */
function saveViaAnchor(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  // ต้องแปะลง DOM ก่อนกด ไม่งั้นบางเบราว์เซอร์จะไม่สนใจชื่อไฟล์ที่ตั้งไว้
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function errorCode(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : ''
}

/**
 * บันทึกไฟล์ข้อความ คืนผลว่าสำเร็จไหม เพื่อให้หน้าจอบอกผู้ใช้ได้ตรงๆ
 * ถ้านามสกุลไม่ผ่านการอนุญาต (เช่น .csv บางที่) จะลองใหม่เป็น .txt ให้อัตโนมัติ
 * เพราะเนื้อไฟล์เหมือนกันทุกอย่าง แค่เปลี่ยนชื่อ แล้วนำเข้า Excel ได้เหมือนกัน
 */
export async function saveTextFile(filename: string, text: string, mime: string): Promise<DownloadOutcome> {
  const api = claudeDownloads()
  if (!api) {
    saveViaAnchor(filename, text, mime)
    return { ok: true }
  }

  try {
    await api.save({ filename, data: text })
    return { ok: true }
  } catch (err) {
    const code = errorCode(err)

    if (code === 'extension_not_enabled' || code === 'rejected_extension') {
      const fallback = filename.replace(/\.[^.]+$/, '') + '.txt'
      try {
        await api.save({ filename: fallback, data: text })
        return { ok: true, note: `บันทึกเป็น ${fallback} — เนื้อไฟล์เหมือน CSV ทุกอย่าง เปลี่ยนนามสกุลเป็น .csv ได้เลย` }
      } catch (retryErr) {
        if (errorCode(retryErr) === 'declined') return { ok: false, reason: 'declined', message: 'ยกเลิกการบันทึกแล้ว' }
        return { ok: false, reason: 'error', message: 'บันทึกไฟล์ไม่สำเร็จ ลองใช้ปุ่มคัดลอกเป็นข้อความแทน' }
      }
    }

    if (code === 'declined') return { ok: false, reason: 'declined', message: 'ยกเลิกการบันทึกแล้ว' }
    if (code === 'too_large') return { ok: false, reason: 'error', message: 'ไฟล์ใหญ่เกินไป ลองเลือกช่วงวันที่ให้สั้นลง' }
    if (code === 'rate_limited') return { ok: false, reason: 'error', message: 'กดถี่เกินไป รอสักครู่แล้วลองใหม่' }

    // ใช้ไม่ได้ในหน้านี้ — ถอยไปใช้วิธีเดิม เผื่อเบราว์เซอร์ยอม
    saveViaAnchor(filename, text, mime)
    return { ok: true }
  }
}

/** คัดลอกข้อความลงคลิปบอร์ด คืน false ถ้าเบราว์เซอร์ไม่ให้สิทธิ์ */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
