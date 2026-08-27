import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState, Task } from '../types'
import { EMPTY_STATE } from '../types'
import { mergeById, newId, pruneTombstones } from './tasks'
import { newCode, pullTasks, pushTasks } from './sync'

/* ===========================================================================
   ศูนย์รวมสถานะของแอป

   - เก็บสำเนาไว้ในเครื่อง (localStorage) เปิดมาเห็นทันทีแม้เน็ตช้า
   - ซิงค์กับเซิร์ฟเวอร์เสมอ เพราะการแจ้งเตือนตอนเช้าอ่านงานจากเซิร์ฟเวอร์
   - กันสองเครื่องชนกันด้วยเลข version ถ้าชนก็รวมงานตาม id (ชิ้นที่แก้ล่าสุดชนะ)
=========================================================================== */

const STATE_KEY = 'reminder-state-v1'
const CODE_KEY = 'reminder-code-v1'
const POLL_MS = 30_000

export type SyncPhase = 'idle' | 'syncing' | 'ok' | 'offline'

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return EMPTY_STATE
    const parsed = JSON.parse(raw) as AppState
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] }
  } catch {
    return EMPTY_STATE
  }
}

function loadCode(): string {
  try {
    const existing = localStorage.getItem(CODE_KEY)
    if (existing) return existing
  } catch {
    /* อ่านไม่ได้ */
  }
  const code = newCode()
  try {
    localStorage.setItem(CODE_KEY, code)
  } catch {
    /* เขียนไม่ได้ก็ใช้ในหน่วยความจำไปก่อน */
  }
  return code
}

export interface Store {
  state: AppState
  code: string
  phase: SyncPhase
  addTask: (input: { title: string; due: string | null; note?: string }) => void
  editTask: (id: string, patch: Partial<Pick<Task, 'title' | 'due' | 'note'>>) => void
  toggleDone: (id: string) => void
  removeTask: (id: string) => void
  changeCode: (code: string) => void
}

export function useStore(): Store {
  const [state, setState] = useState<AppState>(loadState)
  const [code, setCode] = useState<string>(loadCode)
  const [phase, setPhase] = useState<SyncPhase>('idle')

  const stateRef = useRef(state)
  stateRef.current = state
  const versionRef = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // เก็บลงเครื่องทุกครั้งที่เปลี่ยน
  useEffect(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state))
    } catch {
      /* เต็มหรือถูกปิด */
    }
  }, [state])

  /** ดันข้อมูลขึ้นเซิร์ฟเวอร์ พร้อมรวมงานใหม่ถ้าชนกับอีกเครื่อง */
  const push = useCallback(async () => {
    setPhase('syncing')
    try {
      let attempt = stateRef.current
      for (let i = 0; i < 4; i++) {
        const res = await pushTasks(code, versionRef.current, attempt)
        if (res.ok) {
          versionRef.current = res.version
          setPhase('ok')
          return
        }
        // ชนกับอีกเครื่อง — รวมงานตาม id แล้วลองใหม่
        const merged = { tasks: mergeById(res.state.tasks ?? [], stateRef.current.tasks) }
        versionRef.current = res.version
        attempt = merged
        setState(merged)
        stateRef.current = merged
      }
      setPhase('ok')
    } catch {
      setPhase('offline')
    }
  }, [code])

  /** ดึงข้อมูลล่าสุดจากเซิร์ฟเวอร์มารวมกับของในเครื่อง */
  const pull = useCallback(async () => {
    try {
      const res = await pullTasks(code, versionRef.current)
      if (res.unchanged) {
        setPhase('ok')
        return
      }
      versionRef.current = res.version
      if (res.state) {
        const merged = { tasks: pruneTombstones(mergeById(res.state.tasks ?? [], stateRef.current.tasks)) }
        setState(merged)
        stateRef.current = merged
        // ถ้าเครื่องนี้มีอะไรที่เซิร์ฟเวอร์ยังไม่มี ให้ดันกลับไป
        if (JSON.stringify(merged) !== JSON.stringify(res.state)) void push()
        else setPhase('ok')
      } else {
        // เซิร์ฟเวอร์ยังว่าง — ดันของในเครื่องขึ้นไปตั้งต้น
        void push()
      }
    } catch {
      setPhase('offline')
    }
  }, [code, push])

  // ซิงค์ตอนเปิด/เปลี่ยนรหัส และดึงซ้ำเป็นระยะ
  useEffect(() => {
    versionRef.current = 0
    void pull()
    const timer = setInterval(() => void pull(), POLL_MS)
    const onFocus = () => void pull()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [pull])

  /** แก้สถานะแล้วตั้งเวลาดันขึ้นเซิร์ฟเวอร์แบบหน่วงเล็กน้อย */
  const commit = useCallback(
    (next: AppState) => {
      setState(next)
      stateRef.current = next
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void push(), 500)
    },
    [push],
  )

  const addTask = useCallback<Store['addTask']>(
    ({ title, due, note }) => {
      const now = new Date().toISOString()
      const task: Task = {
        id: newId(),
        title: title.trim(),
        due: due || null,
        note: note?.trim() ?? '',
        done: false,
        createdAt: now,
        updatedAt: now,
      }
      commit({ tasks: [...stateRef.current.tasks, task] })
    },
    [commit],
  )

  const editTask = useCallback<Store['editTask']>(
    (id, patch) => {
      const now = new Date().toISOString()
      commit({
        tasks: stateRef.current.tasks.map((t) =>
          t.id === id ? { ...t, ...patch, updatedAt: now } : t,
        ),
      })
    },
    [commit],
  )

  const toggleDone = useCallback<Store['toggleDone']>(
    (id) => {
      const now = new Date().toISOString()
      commit({
        tasks: stateRef.current.tasks.map((t) =>
          t.id === id ? { ...t, done: !t.done, updatedAt: now } : t,
        ),
      })
    },
    [commit],
  )

  const removeTask = useCallback<Store['removeTask']>(
    (id) => {
      const now = new Date().toISOString()
      commit({
        tasks: stateRef.current.tasks.map((t) =>
          t.id === id ? { ...t, deleted: true, updatedAt: now } : t,
        ),
      })
    },
    [commit],
  )

  const changeCode = useCallback((next: string) => {
    try {
      localStorage.setItem(CODE_KEY, next)
    } catch {
      /* เขียนไม่ได้ */
    }
    setCode(next)
  }, [])

  return { state, code, phase, addTask, editTask, toggleDone, removeTask, changeCode }
}
