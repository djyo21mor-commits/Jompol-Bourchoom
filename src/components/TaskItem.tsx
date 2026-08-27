import { useState } from 'react'
import type { Task } from '../types'
import { describeDue } from '../lib/tasks'

const TONE_CLASS: Record<string, string> = {
  overdue: 'pill-overdue',
  today: 'pill-today',
  soon: 'pill-soon',
  later: 'pill-later',
  none: 'pill-none',
}

/* แถวงานหนึ่งชิ้น — ติ๊กเสร็จ, ดูวันครบกำหนด, แก้ไข, ลบ */
export function TaskItem({
  task,
  today,
  onToggle,
  onEdit,
  onRemove,
}: {
  task: Task
  today: string
  onToggle: () => void
  onEdit: (patch: Partial<Pick<Task, 'title' | 'due' | 'note'>>) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [due, setDue] = useState(task.due ?? '')
  const [note, setNote] = useState(task.note)

  const info = describeDue(task.due, today)

  const save = () => {
    if (!title.trim()) return
    onEdit({ title: title.trim(), due: due || null, note: note.trim() })
    setEditing(false)
  }

  if (editing) {
    return (
      <li className="card p-4 flex flex-col gap-3">
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="ชื่องาน" />
        <input type="date" className="field" value={due} onChange={(e) => setDue(e.target.value)} aria-label="วันครบกำหนด" />
        <textarea className="field py-3" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="โน้ต" aria-label="โน้ต" />
        <div className="flex gap-2">
          <button className="btn btn-primary flex-1" onClick={save}>บันทึก</button>
          <button className="btn btn-ghost" onClick={() => setEditing(false)}>ยกเลิก</button>
        </div>
      </li>
    )
  }

  return (
    <li className="card p-3.5 flex items-start gap-3">
      <button
        onClick={onToggle}
        className="mt-0.5 shrink-0 grid place-items-center rounded-lg transition-colors"
        style={{
          width: '1.75rem',
          height: '1.75rem',
          border: `2px solid ${task.done ? 'var(--done)' : 'var(--line-strong)'}`,
          background: task.done ? 'var(--done)' : 'transparent',
          color: '#fff',
        }}
        aria-label={task.done ? 'ทำเครื่องหมายว่ายังไม่เสร็จ' : 'ทำเครื่องหมายว่าเสร็จ'}
      >
        {task.done ? '✓' : ''}
      </button>

      <div className="min-w-0 flex-1">
        <div
          className="font-medium break-words"
          style={{
            textDecoration: task.done ? 'line-through' : 'none',
            color: task.done ? 'var(--ink-3)' : 'var(--ink)',
          }}
        >
          {task.title}
        </div>

        {!task.done && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className={`pill ${TONE_CLASS[info.tone]}`}>
              {info.tone === 'overdue' ? '⚠️ ' : ''}
              {info.label}
            </span>
            {info.full && (
              <span className="text-sm" style={{ color: 'var(--ink-3)' }}>
                {info.full}
              </span>
            )}
          </div>
        )}

        {task.note && (
          <p className="mt-1.5 text-sm" style={{ color: 'var(--ink-2)' }}>
            {task.note}
          </p>
        )}
      </div>

      <div className="flex shrink-0 gap-1">
        <button
          onClick={() => setEditing(true)}
          className="grid place-items-center rounded-lg"
          style={{ width: '2.25rem', height: '2.25rem', color: 'var(--ink-3)' }}
          aria-label="แก้ไข"
        >
          ✏️
        </button>
        <button
          onClick={onRemove}
          className="grid place-items-center rounded-lg"
          style={{ width: '2.25rem', height: '2.25rem', color: 'var(--ink-3)' }}
          aria-label="ลบ"
        >
          🗑️
        </button>
      </div>
    </li>
  )
}
