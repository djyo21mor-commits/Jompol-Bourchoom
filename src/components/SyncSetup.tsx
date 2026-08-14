import { useState } from 'react'
import { useStore } from '../lib/store'
import { EMPTY_SYNC, isValidCode, newShopCode, normalizeCode, type SyncPhase } from '../lib/sync'
import { copyText } from '../lib/download'
import { timeText } from '../lib/format'
import { Card, ConfirmButton, Field, Icon } from './ui'

/* ===========================================================================
   ตั้งค่าให้สองเครื่องใช้ข้อมูลชุดเดียวกัน
   เครื่องแรกสร้างรหัสร้าน เครื่องที่สองเอารหัสนั้นมาใส่
=========================================================================== */

const PHASE_TEXT: Record<SyncPhase, { label: string; className: string }> = {
  off: { label: 'ยังไม่ได้เชื่อม', className: 'text-ink-3' },
  connecting: { label: 'กำลังเชื่อมต่อ…', className: 'text-ink-2' },
  ok: { label: 'ข้อมูลตรงกันแล้ว', className: 'text-good-ink' },
  saving: { label: 'กำลังส่งข้อมูล…', className: 'text-ink-2' },
  error: { label: 'เชื่อมต่อไม่ได้', className: 'text-bad-ink' },
}

export default function SyncSetup() {
  const { sync, syncConfig, setSyncConfig } = useStore()
  const [joining, setJoining] = useState('')
  const [joinError, setJoinError] = useState('')
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(false)

  const linked = syncConfig.enabled && !!syncConfig.code
  const phase = PHASE_TEXT[sync.phase]

  function create() {
    setSyncConfig({ code: newShopCode(), enabled: true })
    setRevealed(true)
    setJoinError('')
  }

  function join() {
    const code = normalizeCode(joining)
    if (!isValidCode(code)) {
      setJoinError('รหัสไม่ถูกต้อง — ต้องเป็นรหัสที่ได้จากอีกเครื่องหนึ่ง')
      return
    }
    setSyncConfig({ code, enabled: true })
    setJoining('')
    setJoinError('')
  }

  async function copy() {
    if (await copyText(syncConfig.code)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!linked) {
    return (
      <Card
        title="ใช้ร่วมกันสองเครื่อง"
        subtitle="ตอนนี้ข้อมูลอยู่ในเครื่องนี้เครื่องเดียว เชื่อมแล้วอีกเครื่องจะเห็นข้อมูลชุดเดียวกัน"
      >
        <button type="button" onClick={create} className="btn-primary w-full">
          <Icon name="plus" className="size-4" />
          สร้างรหัสร้านสำหรับเครื่องนี้
        </button>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
          กดปุ่มนี้ที่ <strong className="font-semibold text-ink-2">เครื่องหลักที่มีข้อมูลอยู่แล้ว</strong> —
          ข้อมูลในเครื่องนี้จะถูกส่งขึ้นไปเป็นชุดตั้งต้น
          <br />
          ใช้ได้เมื่อเปิดจากลิงก์ร้านที่ติดตั้งไว้เอง (เช่น Netlify) — ลิงก์แชร์ของ Claude ยังซิงค์ไม่ได้
        </p>

        <div className="mt-4 border-t border-line pt-4">
          <Field label="หรือถ้าอีกเครื่องสร้างรหัสไว้แล้ว ให้ใส่รหัสนั้นที่นี่">
            <input
              className="field"
              value={joining}
              onChange={(e) => {
                setJoining(e.target.value)
                setJoinError('')
              }}
              placeholder="เช่น ABC123-DEF456-GHJ789-KLM234"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <button type="button" onClick={join} disabled={!joining.trim()} className="btn-outline mt-2 w-full">
            เชื่อมกับรหัสนี้
          </button>
          {joinError && <p className="mt-2 text-[13px] text-bad-ink">{joinError}</p>}
          <p className="mt-2 rounded-xl bg-warn/15 px-3 py-2.5 text-[12.5px] leading-relaxed text-warn-ink">
            <strong className="font-semibold">ระวัง:</strong> เมื่อเชื่อมแล้ว
            ข้อมูลในเครื่องนี้จะถูกแทนที่ด้วยข้อมูลของรหัสนั้น
            ถ้าเครื่องนี้มีข้อมูลที่ยังไม่ได้เก็บไว้ที่อื่น ให้ดาวน์โหลดไฟล์สำรองก่อน
          </p>
        </div>
      </Card>
    )
  }

  return (
    <Card title="ใช้ร่วมกันสองเครื่อง" subtitle="ทุกเครื่องที่ใส่รหัสนี้จะเห็นข้อมูลชุดเดียวกัน">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`text-[13.5px] font-semibold ${phase.className}`}>{phase.label}</span>
        {sync.lastAt && sync.phase !== 'error' && (
          <span className="text-[12.5px] text-ink-3">ล่าสุด {timeText(sync.lastAt)}</span>
        )}
        {sync.pending > 0 && (
          <span className="text-[12.5px] text-warn-ink">ค้างส่งอยู่ {sync.pending} รายการ</span>
        )}
      </div>
      {sync.phase === 'error' && sync.message && (
        <p className="mt-2 rounded-xl bg-bad/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-bad-ink">
          {sync.message}
          <br />
          ระบบจะลองใหม่ให้เองเรื่อยๆ ระหว่างนี้พิมพ์ต่อได้ตามปกติ ข้อมูลจะถูกส่งขึ้นไปเมื่อเชื่อมต่อได้
        </p>
      )}

      <Field label="รหัสร้าน" className="mt-3" hint="เอารหัสนี้ไปใส่ในเครื่องที่สอง">
        <div className="flex items-center gap-2">
          <input
            className="field flex-1 tnum tracking-wide"
            value={revealed ? syncConfig.code : syncConfig.code.replace(/[^-]/g, '•')}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            aria-label="รหัสร้าน"
          />
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="btn-outline !px-3"
            aria-label={revealed ? 'ซ่อนรหัส' : 'แสดงรหัส'}
          >
            {revealed ? 'ซ่อน' : 'ดู'}
          </button>
        </div>
      </Field>
      <button type="button" onClick={() => void copy()} className="btn-outline mt-2 w-full">
        <Icon name={copied ? 'check' : 'copy'} className="size-4" />
        {copied ? 'คัดลอกรหัสแล้ว' : 'คัดลอกรหัส'}
      </button>

      <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
        <strong className="font-semibold text-ink">ใครมีรหัสนี้เข้าถึงข้อมูลร้านได้ทั้งหมด</strong> —
        ส่งให้กันทางแชทส่วนตัว อย่าโพสต์ที่สาธารณะ ถ้ารหัสหลุดให้กดสร้างรหัสใหม่แล้วตั้งค่าใหม่ทั้งสองเครื่อง
      </p>

      <div className="mt-3 border-t border-line pt-3">
        <ConfirmButton
          onConfirm={() => setSyncConfig(EMPTY_SYNC)}
          label="เลิกใช้ร่วมกัน (เก็บข้อมูลไว้ในเครื่องนี้)"
          confirmLabel="กดอีกครั้งเพื่อเลิกเชื่อม"
          className="btn-ghost btn-sm w-full text-ink-2"
        />
      </div>
    </Card>
  )
}
