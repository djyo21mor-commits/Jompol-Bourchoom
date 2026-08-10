import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import type { AppState, ChatMessage, CoreState, Item, Recipe, Settings } from '../types'
import { parseScript } from './parser'
import { helpMessages, produce, runCommand, uid } from './engine'
import { today } from './format'

const STORAGE_KEY = 'jompol-bakery/v1'
const MAX_SNAPSHOTS = 20

export const DEFAULT_SETTINGS: Settings = {
  shopName: 'ร้านขนมของฉัน',
  defaultOverhead: { labor: 0, water: 0, electric: 0, misc: 0 },
  defaultMarginPct: 30,
  priceMode: 'markup',
  priceRounding: 0,
  theme: 'system',
}

function emptyCore(): CoreState {
  return {
    items: [],
    purchases: [],
    recipes: [],
    productions: [],
    lots: [],
    sales: [],
    wastes: [],
    settings: { ...DEFAULT_SETTINGS },
  }
}

function welcomeChat(): ChatMessage[] {
  return [
    {
      id: uid('m'),
      role: 'bot',
      at: new Date().toISOString(),
      tone: 'info',
      text: 'สวัสดีค่ะ พิมพ์บอกได้เลยว่าไปซื้ออะไรมา ทำขนมอะไร หรือขายไปเท่าไหร่',
    },
    ...helpMessages(),
  ]
}

function initialState(): AppState {
  return { ...emptyCore(), chat: welcomeChat(), snapshots: [] }
}

/* --------------------------------------------------------------------------
   เก็บลงเครื่อง
-------------------------------------------------------------------------- */

function coreOf(state: AppState): CoreState {
  const { items, purchases, recipes, productions, lots, sales, wastes, settings } = state
  return { items, purchases, recipes, productions, lots, sales, wastes, settings }
}

function load(): AppState {
  if (typeof localStorage === 'undefined') return initialState()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialState()
    const saved = JSON.parse(raw) as Partial<AppState>
    const base = initialState()
    return {
      ...base,
      ...saved,
      settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) },
      chat: saved.chat?.length ? saved.chat : base.chat,
      snapshots: saved.snapshots ?? [],
    }
  } catch {
    // ข้อมูลเสียหาย — เริ่มใหม่ดีกว่าค้างทั้งแอป
    return initialState()
  }
}

function save(state: AppState) {
  if (typeof localStorage === 'undefined') return
  try {
    // เก็บแชทย้อนหลังไม่เกิน 300 ข้อความ กัน storage เต็ม
    const trimmed: AppState = { ...state, chat: state.chat.slice(-300) }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    /* พื้นที่เต็มหรือโหมดส่วนตัว — ปล่อยผ่าน ไม่ทำให้แอปพัง */
  }
}

/* --------------------------------------------------------------------------
   Reducer
-------------------------------------------------------------------------- */

export type Action =
  | { type: 'chat/send'; text: string }
  | { type: 'chat/undo'; msgId: string }
  | { type: 'chat/clear' }
  | { type: 'chat/help' }
  | { type: 'chat/produceThenSell'; recipeId: string; produceQty: number; sellQty: number; unitPrice: number }
  | { type: 'item/save'; item: Item }
  | { type: 'item/delete'; id: string }
  | { type: 'recipe/save'; recipe: Recipe }
  | { type: 'recipe/delete'; id: string }
  | { type: 'recipe/produce'; recipeId: string; qty: number; date: string }
  | { type: 'sale/add'; recipeId: string; qty: number; unitPrice: number; date: string }
  | { type: 'sale/delete'; id: string }
  | { type: 'lot/carryover'; recipeId: string; qty: number; date: string }
  | { type: 'lot/waste'; recipeId: string; qty: number; date: string; reason?: string }
  | { type: 'purchase/delete'; id: string }
  | { type: 'settings/save'; settings: Settings }
  | { type: 'data/replace'; state: AppState }
  | { type: 'data/reset' }

function pushSnapshot(state: AppState, core: CoreState, msgId: string): AppState['snapshots'] {
  return [...state.snapshots, { msgId, core }].slice(-MAX_SNAPSHOTS)
}

function userMessage(text: string): ChatMessage {
  return { id: uid('m'), role: 'user', text, at: new Date().toISOString() }
}

function systemNote(text: string, tone: ChatMessage['tone'] = 'info'): ChatMessage {
  return { id: uid('m'), role: 'bot', text, tone, at: new Date().toISOString() }
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'chat/send': {
      const text = action.text.trim()
      if (!text) return state
      const before = coreOf(state)
      let core = before
      const replies: ChatMessage[] = []
      let changed = false

      for (const cmd of parseScript(text)) {
        const res = runCommand(core, cmd, today())
        core = res.core
        changed = changed || res.changed
        replies.push(...res.messages)
      }

      // ผูกปุ่มย้อนกลับไว้กับข้อความแรกที่ทำให้ข้อมูลเปลี่ยน
      const anchor = replies.find((m) => m.undoable)
      const snapshots = changed && anchor ? pushSnapshot(state, before, anchor.id) : state.snapshots

      return { ...state, ...core, chat: [...state.chat, userMessage(text), ...replies], snapshots }
    }

    case 'chat/undo': {
      const snap = state.snapshots.find((s) => s.msgId === action.msgId)
      if (!snap) return state
      return {
        ...state,
        ...snap.core,
        chat: [...state.chat.map((m) => (m.id === action.msgId ? { ...m, undoable: false } : m)), systemNote('ย้อนกลับรายการล่าสุดแล้ว', 'ok')],
        snapshots: state.snapshots.filter((s) => s.msgId !== action.msgId),
      }
    }

    case 'chat/help':
      return { ...state, chat: [...state.chat, ...helpMessages()] }

    case 'chat/clear':
      return { ...state, chat: welcomeChat(), snapshots: [] }

    case 'chat/produceThenSell': {
      const recipe = state.recipes.find((r) => r.id === action.recipeId)
      if (!recipe) return state
      const before = coreOf(state)
      const prod = produce(before, recipe, action.produceQty, today())
      const sold = runCommand(
        prod.core,
        {
          kind: 'sell',
          name: recipe.name,
          qty: action.sellQty,
          unit: recipe.yieldUnit,
          unitPrice: action.unitPrice,
          raw: '',
        },
        today(),
      )
      const replies = [...prod.messages, ...sold.messages]
      const anchor = replies.find((m) => m.undoable)
      return {
        ...state,
        ...sold.core,
        chat: [...state.chat, ...replies],
        snapshots: anchor ? pushSnapshot(state, before, anchor.id) : state.snapshots,
      }
    }

    case 'item/save': {
      const exists = state.items.some((i) => i.id === action.item.id)
      return {
        ...state,
        items: exists ? state.items.map((i) => (i.id === action.item.id ? action.item : i)) : [...state.items, action.item],
      }
    }

    case 'item/delete':
      return {
        ...state,
        items: state.items.filter((i) => i.id !== action.id),
        recipes: state.recipes.map((r) => ({ ...r, lines: r.lines.filter((l) => l.itemId !== action.id) })),
      }

    case 'recipe/save': {
      const exists = state.recipes.some((r) => r.id === action.recipe.id)
      return {
        ...state,
        recipes: exists
          ? state.recipes.map((r) => (r.id === action.recipe.id ? action.recipe : r))
          : [...state.recipes, action.recipe],
      }
    }

    case 'recipe/delete':
      return { ...state, recipes: state.recipes.filter((r) => r.id !== action.id) }

    case 'recipe/produce': {
      const recipe = state.recipes.find((r) => r.id === action.recipeId)
      if (!recipe || action.qty <= 0) return state
      const res = produce(coreOf(state), recipe, action.qty, action.date)
      return { ...state, ...res.core, chat: [...state.chat, ...res.messages] }
    }

    case 'sale/add': {
      const recipe = state.recipes.find((r) => r.id === action.recipeId)
      if (!recipe || action.qty <= 0) return state
      const res = runCommand(
        coreOf(state),
        { kind: 'sell', name: recipe.name, qty: action.qty, unit: recipe.yieldUnit, unitPrice: action.unitPrice, raw: '' },
        action.date,
      )
      return { ...state, ...res.core, chat: [...state.chat, ...res.messages] }
    }

    case 'lot/carryover': {
      const recipe = state.recipes.find((r) => r.id === action.recipeId)
      if (!recipe || action.qty <= 0) return state
      const res = runCommand(
        coreOf(state),
        { kind: 'carryover', name: recipe.name, qty: action.qty, unit: recipe.yieldUnit, raw: '' },
        action.date,
      )
      return { ...state, ...res.core, chat: [...state.chat, ...res.messages] }
    }

    case 'lot/waste': {
      const recipe = state.recipes.find((r) => r.id === action.recipeId)
      if (!recipe || action.qty <= 0) return state
      const res = runCommand(
        coreOf(state),
        { kind: 'waste', name: recipe.name, qty: action.qty, unit: recipe.yieldUnit, reason: action.reason, raw: '' },
        action.date,
      )
      return { ...state, ...res.core, chat: [...state.chat, ...res.messages] }
    }

    case 'sale/delete': {
      const sale = state.sales.find((s) => s.id === action.id)
      if (!sale) return state
      // คืนจำนวนกลับเข้าล็อตที่ตัดไป (เฉลี่ยตามล็อตที่บันทึกไว้)
      let left = sale.qty
      const lots = state.lots.map((l) => {
        if (left <= 1e-9 || !sale.lotIds.includes(l.id)) return l
        const room = l.qty - l.remaining
        const give = Math.min(room, left)
        left -= give
        return { ...l, remaining: l.remaining + give }
      })
      return { ...state, lots, sales: state.sales.filter((s) => s.id !== action.id) }
    }

    case 'purchase/delete': {
      const purchase = state.purchases.find((p) => p.id === action.id)
      if (!purchase) return state
      const items = state.items.map((i) => {
        if (i.id !== purchase.itemId) return i
        const stock = i.stock - purchase.qty
        // ถอนต้นทุนของล็อตนั้นออกจากค่าเฉลี่ย
        const totalValue = i.stock * i.avgCost - purchase.total
        return { ...i, stock, avgCost: stock > 1e-9 ? Math.max(0, totalValue / stock) : 0 }
      })
      return { ...state, items, purchases: state.purchases.filter((p) => p.id !== action.id) }
    }

    case 'settings/save':
      return { ...state, settings: action.settings }

    case 'data/replace':
      return { ...action.state, chat: [...action.state.chat, systemNote('นำเข้าข้อมูลสำเร็จ', 'ok')] }

    case 'data/reset':
      return initialState()

    default:
      return state
  }
}

/* --------------------------------------------------------------------------
   Context
-------------------------------------------------------------------------- */

interface StoreValue {
  state: AppState
  dispatch: React.Dispatch<Action>
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load)

  useEffect(() => {
    save(state)
  }, [state])

  // ธีมสว่าง/มืด — เมื่อผู้ใช้ตั้งไว้ที่ "ตามเครื่อง" ให้ตามการตั้งค่าของหน้าเว็บที่ฝังแอปนี้อยู่ก่อน
  // (เช่น เปิดผ่าน Artifact ที่มีสวิตช์ธีมของตัวเอง) แล้วค่อยตามธีมของระบบปฏิบัติการเป็นค่าสำรอง
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      let wantDark: boolean
      if (state.settings.theme === 'dark') wantDark = true
      else if (state.settings.theme === 'light') wantDark = false
      else {
        const hostTheme = root.getAttribute('data-theme')
        wantDark = hostTheme === 'dark' || (hostTheme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      }
      root.classList.toggle('dark', wantDark)
    }
    apply()
    if (state.settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const observer = new MutationObserver(apply)
    mq.addEventListener('change', apply)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      mq.removeEventListener('change', apply)
      observer.disconnect()
    }
  }, [state.settings.theme])

  const value = useMemo(() => ({ state, dispatch }), [state])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore ต้องอยู่ภายใน <StoreProvider>')
  return ctx
}

/** ส่งออกข้อมูลทั้งหมดเป็นไฟล์สำรอง */
export function exportData(state: AppState): string {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString(), version: 1 }, null, 2)
}

/** อ่านไฟล์สำรองกลับเข้ามา — โยน error ถ้าไฟล์ไม่ถูกต้อง */
export function parseImport(text: string): AppState {
  const data = JSON.parse(text) as Partial<AppState>
  if (!data || !Array.isArray(data.items) || !Array.isArray(data.recipes)) {
    throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของแอป')
  }
  const base = initialState()
  return {
    ...base,
    ...data,
    settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) },
    chat: data.chat ?? base.chat,
    snapshots: [],
  }
}
