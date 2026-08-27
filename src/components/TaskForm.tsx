import { useState } from 'react'
import { todayYmd } from '../lib/tasks'

/* ฟอร์มเพิ่มงานใหม่ — ชื่อกับวันครบกำหนดเป็นหลัก โน้ตเสริมได้ */
export function TaskForm({
  onAdd,
}: {
  onAdd: (input: { title: string; due: string | null; note?: string }) => void
}) {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onAdd({ title, due: due || null, note })
    setTitle('')
    setDue('')
    setNote('')
    setShowNote(false)
  }

  const quickDue = (days: number) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    setDue(todayYmd(d))
  }

  return (
    <form onSubmit={submit} className="card p-4 flex flex-col gap-3">
      <input
        className="field"
        placeholder="งานที่ต้องทำ / ต้องส่ง…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="ชื่องาน"
      />

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          className="field flex-1 min-w-[10rem]"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="วันครบกำหนด"
        />
        <div className="flex gap-1.5">
          <button type="button" className="btn btn-ghost px-3 text-sm" onClick={() => quickDue(0)}>
            วันนี้
          </button>
          <button type="button" className="btn btn-ghost px-3 text-sm" onClick={() => quickDue(1)}>
            พรุ่งนี้
          </button>
          <button type="button" className="btn btn-ghost px-3 text-sm" onClick={() => quickDue(7)}>
            +7 วัน
          </button>
        </div>
      </div>

      {showNote ? (
        <textarea
          className="field py-3"
          placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="โน้ต"
        />
      ) : (
        <button
          type="button"
          className="text-sm self-start"
          style={{ color: 'var(--ink-3)' }}
          onClick={() => setShowNote(true)}
        >
          + เพิ่มรายละเอียด
        </button>
      )}

      <button type="submit" className="btn btn-primary" disabled={!title.trim()}>
        เพิ่มงาน
      </button>
    </form>
  )
}
