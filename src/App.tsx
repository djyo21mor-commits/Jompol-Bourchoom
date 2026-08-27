import { useMemo, useState } from 'react'
import { useStore } from './lib/store'
import { countTasks, sortForDisplay, todayYmd, visibleTasks } from './lib/tasks'
import { TaskForm } from './components/TaskForm'
import { TaskItem } from './components/TaskItem'
import { NotifyPanel } from './components/NotifyPanel'

const PHASE_LABEL: Record<string, string> = {
  idle: '',
  syncing: 'กำลังซิงค์…',
  ok: 'ซิงค์แล้ว',
  offline: 'ออฟไลน์ — เก็บไว้ในเครื่องก่อน',
}

export default function App() {
  const store = useStore()
  const today = todayYmd()
  const [showDone, setShowDone] = useState(false)

  const tasks = useMemo(() => visibleTasks(store.state.tasks), [store.state.tasks])
  const counts = useMemo(() => countTasks(tasks, today), [tasks, today])
  const sorted = useMemo(() => sortForDisplay(tasks, today), [tasks, today])

  const pending = sorted.filter((t) => !t.done)
  const done = sorted.filter((t) => t.done)

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-xl px-4 pb-24 pt-6 flex flex-col gap-4">
        <header className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">งานค้าง</h1>
            <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
              เตือนทุกเช้า 7 โมง ว่ามีอะไรต้องส่งบ้าง
            </p>
          </div>
          <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
            {PHASE_LABEL[store.phase]}
          </span>
        </header>

        <div className="grid grid-cols-3 gap-2">
          <Stat label="ค้างทั้งหมด" value={counts.pending} tone="ink" />
          <Stat label="เลยกำหนด" value={counts.overdue} tone="overdue" />
          <Stat label="ครบวันนี้" value={counts.today} tone="today" />
        </div>

        <NotifyPanel code={store.code} onChangeCode={store.changeCode} />

        <TaskForm onAdd={store.addTask} />

        {pending.length === 0 ? (
          <div className="card p-8 text-center" style={{ color: 'var(--ink-3)' }}>
            <div className="text-3xl mb-2">🎉</div>
            ไม่มีงานค้าง เพิ่มงานใหม่ได้เลย
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {pending.map((t) => (
              <TaskItem
                key={t.id}
                task={t}
                today={today}
                onToggle={() => store.toggleDone(t.id)}
                onEdit={(patch) => store.editTask(t.id, patch)}
                onRemove={() => store.removeTask(t.id)}
              />
            ))}
          </ul>
        )}

        {done.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <button
              className="text-sm self-start"
              style={{ color: 'var(--ink-3)' }}
              onClick={() => setShowDone((v) => !v)}
            >
              {showDone ? 'ซ่อน' : 'ดู'}งานที่เสร็จแล้ว ({done.length})
            </button>
            {showDone && (
              <ul className="flex flex-col gap-2.5">
                {done.map((t) => (
                  <TaskItem
                    key={t.id}
                    task={t}
                    today={today}
                    onToggle={() => store.toggleDone(t.id)}
                    onEdit={(patch) => store.editTask(t.id, patch)}
                    onRemove={() => store.removeTask(t.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        <footer className="pt-4 text-center text-xs" style={{ color: 'var(--ink-3)' }}>
          ข้อมูลเก็บบนเครื่องและซิงค์ตามรหัสของคุณ
        </footer>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'ink' | 'overdue' | 'today' }) {
  const color = tone === 'overdue' ? 'var(--overdue)' : tone === 'today' ? 'var(--today)' : 'var(--ink)'
  return (
    <div className="card p-3 text-center">
      <div className="text-2xl font-bold" style={{ color: value > 0 ? color : 'var(--ink-3)' }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: 'var(--ink-2)' }}>
        {label}
      </div>
    </div>
  )
}
