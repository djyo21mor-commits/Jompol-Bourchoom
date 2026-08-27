import { useEffect, useState } from 'react'
import { disablePush, enablePush, isSubscribed, permission, pushSupported, sendTest } from '../lib/push'
import { isValidCode, normalizeCode } from '../lib/sync'

/* แผงตั้งค่าการแจ้งเตือน — เปิดรับเตือน 7 โมงเช้า, ทดสอบ, และใช้รหัสร่วมกับอีกเครื่อง */
export function NotifyPanel({ code, onChangeCode }: { code: string; onChangeCode: (c: string) => void }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [showCode, setShowCode] = useState(false)
  const [codeInput, setCodeInput] = useState('')

  const supported = pushSupported()

  useEffect(() => {
    void isSubscribed().then(setOn)
  }, [code])

  const flash = (kind: 'ok' | 'err', text: string) => {
    setMsg({ kind, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const toggle = async () => {
    setBusy(true)
    try {
      if (on) {
        await disablePush(code)
        setOn(false)
        flash('ok', 'ปิดการแจ้งเตือนบนเครื่องนี้แล้ว')
      } else {
        await enablePush(code)
        setOn(true)
        flash('ok', 'เปิดแล้ว — จะเตือนงานค้างทุกเช้า 7 โมง')
      }
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    try {
      const n = await sendTest(code)
      flash('ok', n > 0 ? `ส่งทดสอบไป ${n} อุปกรณ์แล้ว` : 'ยังไม่มีอุปกรณ์ที่เปิดรับ')
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'ส่งทดสอบไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const applyCode = () => {
    const c = normalizeCode(codeInput)
    if (!isValidCode(c)) {
      flash('err', 'รหัสไม่ถูกต้อง')
      return
    }
    onChangeCode(c)
    setShowCode(false)
    setCodeInput('')
    flash('ok', 'เปลี่ยนรหัสแล้ว — กำลังดึงงานของรหัสนี้')
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code)
      flash('ok', 'คัดลอกรหัสแล้ว')
    } catch {
      flash('err', 'คัดลอกไม่ได้ ลองจดเอง')
    }
  }

  return (
    <section className="card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold">แจ้งเตือนทุกเช้า 7 โมง</div>
          <div className="text-sm" style={{ color: 'var(--ink-2)' }}>
            สรุปงานค้างส่งเข้ามือถือ แม้ไม่ได้เปิดแอปไว้
          </div>
        </div>
        <button
          className={`btn ${on ? 'btn-ghost' : 'btn-primary'}`}
          onClick={toggle}
          disabled={busy || !supported}
        >
          {on ? 'ปิด' : 'เปิดรับเตือน'}
        </button>
      </div>

      {!supported && (
        <p className="text-sm" style={{ color: 'var(--overdue)' }}>
          เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน — บน iPhone ให้กด “แชร์ → เพิ่มไปยังหน้าจอโฮม” แล้วเปิดจากไอคอนนั้น
        </p>
      )}

      {supported && permission() === 'denied' && (
        <p className="text-sm" style={{ color: 'var(--today)' }}>
          เบราว์เซอร์ถูกตั้งให้บล็อกการแจ้งเตือน — เปิดสิทธิ์แจ้งเตือนของเว็บนี้ในตั้งค่าเบราว์เซอร์ก่อน
        </p>
      )}

      {on && (
        <button className="btn btn-ghost text-sm" onClick={test} disabled={busy}>
          ส่งแจ้งเตือนทดสอบเดี๋ยวนี้
        </button>
      )}

      {msg && (
        <p className="text-sm" style={{ color: msg.kind === 'ok' ? 'var(--done)' : 'var(--overdue)' }}>
          {msg.text}
        </p>
      )}

      <div className="border-t pt-3" style={{ borderColor: 'var(--line)' }}>
        {!showCode ? (
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm min-w-0" style={{ color: 'var(--ink-2)' }}>
              รหัสของคุณ:{' '}
              <button onClick={copyCode} className="font-mono font-semibold" style={{ color: 'var(--brand)' }}>
                {code}
              </button>
            </div>
            <button className="text-sm shrink-0" style={{ color: 'var(--ink-3)' }} onClick={() => setShowCode(true)}>
              ใช้รหัสอื่น
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
              ใส่รหัสจากอีกเครื่องเพื่อดูงานชุดเดียวกัน
            </p>
            <input
              className="field font-mono"
              placeholder="วางรหัสที่นี่"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
            />
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" onClick={applyCode}>
                ใช้รหัสนี้
              </button>
              <button className="btn btn-ghost" onClick={() => setShowCode(false)}>
                ยกเลิก
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
