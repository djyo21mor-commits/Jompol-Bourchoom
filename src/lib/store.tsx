import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import type { AppState, ChatChannel, ChatMessage, CoreState, Item, Recipe, Settings, Transaction } from '../types'
import { parseScript } from './parser'
import {
  cancelPendingRecipe,
  commitPendingRecipe,
  dailyIncomeMessage,
  dailyIncomeMessageId,
  helpMessages,
  moneyHelpMessages,
  produce,
  recordDailySheet,
  runCommand,
  uid,
} from './engine'
import { today } from './format'

const STORAGE_KEY = 'jompol-bakery/v1'
const MAX_SNAPSHOTS = 20

export const DEFAULT_SETTINGS: Settings = {
  shopName: 'ร้านขนมของฉัน',
  defaultOverhead: { labor: 0, water: 0, electric: 0, misc: 0 },
  defaultMarginPct: 30,
  priceMode: 'markup',
  priceRounding: 0,
  expenseCategories: [
    'ค่าเช่าร้าน', 'ค่าน้ำ', 'ค่าไฟ', 'ค่าแก๊ส', 'ค่าจ้างพนักงาน',
    'ค่าเดินทาง', 'ค่าโทรศัพท์/เน็ต', 'ค่าอุปกรณ์', 'ค่าการตลาด', 'ค่าธรรมเนียม',
  ],
  incomeCategories: ['รับจ้างทำขนม', 'ขายของอื่น', 'เงินทุนเพิ่ม', 'รายได้อื่น'],
  people: ['ฉัน'],
  currentPerson: 'ฉัน',
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
    transactions: [],
    assets: [],
    settings: { ...DEFAULT_SETTINGS },
  }
}

function welcomeChat(): ChatMessage[] {
  const at = new Date().toISOString()
  return [
    {
      id: uid('m'),
      channel: 'shop',
      role: 'bot',
      at,
      tone: 'info',
      text: 'ช่องนี้ไว้คุยเรื่องของขาย — ซื้อวัตถุดิบ ตั้งสูตร ทำขนม',
    },
    ...helpMessages(),
    {
      id: uid('m'),
      channel: 'money',
      role: 'bot',
      at,
      tone: 'info',
      text: 'ช่องนี้ไว้จดรายรับ-รายจ่าย พิมพ์สั้นๆ ได้เลย',
    },
    ...moneyHelpMessages(),
  ]
}

function initialState(): AppState {
  return { ...emptyCore(), chat: welcomeChat(), snapshots: [] }
}

/* --------------------------------------------------------------------------
   เก็บลงเครื่อง
-------------------------------------------------------------------------- */

function coreOf(state: AppState): CoreState {
  const { items, purchases, recipes, productions, lots, sales, wastes, transactions, assets, pendingRecipe, settings } =
    state
  return { items, purchases, recipes, productions, lots, sales, wastes, transactions, assets, pendingRecipe, settings }
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
  | { type: 'chat/send'; text: string; channel: ChatChannel }
  | { type: 'chat/undo'; msgId: string }
  | { type: 'chat/clear'; channel: ChatChannel }
  | { type: 'chat/help'; channel: ChatChannel }
  | { type: 'recipe/confirm' }
  | { type: 'recipe/cancel' }
  | { type: 'daily/save'; recipeId: string; date: string; produced: number; leftover: number; unitPrice: number }
  | { type: 'asset/delete'; id: string }
  | { type: 'person/switch'; name: string }
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
  | { type: 'tx/save'; tx: Transaction }
  | { type: 'tx/delete'; id: string }
  | { type: 'settings/save'; settings: Settings }
  | { type: 'data/replace'; state: AppState }
  | { type: 'data/reset' }


/**
 * รีเฟรชข้อความ "รายรับของขาย" ของวันนั้นในช่องรายรับ-รายจ่าย
 * เก็บไว้วันละข้อความเดียว แก้ยอดกี่รอบก็ทับของเดิม ไม่กองซ้ำ
 */
function withDailyIncomeNotice(chat: ChatMessage[], core: CoreState, date: string): ChatMessage[] {
  const without = chat.filter((m) => m.id !== dailyIncomeMessageId(date))
  const notice = dailyIncomeMessage(core, date)
  return notice ? [...without, notice] : without
}

function pushSnapshot(state: AppState, core: CoreState, msgId: string): AppState['snapshots'] {
  return [...state.snapshots, { msgId, core }].slice(-MAX_SNAPSHOTS)
}

function userMessage(text: string, channel: ChatChannel, by: string): ChatMessage {
  return { id: uid('m'), channel, role: 'user', by, text, at: new Date().toISOString() }
}

function systemNote(text: string, channel: ChatChannel, tone: ChatMessage['tone'] = 'info'): ChatMessage {
  return { id: uid('m'), channel, role: 'bot', text, tone, at: new Date().toISOString() }
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
      let soldToday = false

      for (const cmd of parseScript(text, action.channel)) {
        const res = runCommand(core, cmd, today())
        core = res.core
        changed = changed || res.changed
        // ข้อความที่ไม่ได้ระบุช่องไว้เอง ให้ตอบกลับในช่องที่ผู้ใช้พิมพ์มา
        replies.push(...res.messages.map((m) => (m.channel === 'shop' ? { ...m, channel: action.channel } : m)))

        if (cmd.kind === 'sell' && res.changed) soldToday = true

        // ซื้อของเข้าร้าน = เงินออกจริง จึงแจ้งเตือนไปที่ช่องรายรับ-รายจ่ายด้วย
        if (cmd.kind === 'purchase' && res.changed) {
          replies.push({
            id: uid('m'),
            channel: 'money',
            role: 'bot',
            at: new Date().toISOString(),
            tone: 'info',
            text: `ค่าของขาย · ${cmd.name}`,
            details: [
              { label: 'จำนวนเงิน', value: `${cmd.total.toLocaleString('th-TH')} บาท` },
              { label: 'มาจาก', value: 'ช่องของขาย — นับเป็นรายจ่ายให้แล้ว ไม่ต้องบันทึกซ้ำ' },
            ],
          })
        }
      }

      // ผูกปุ่มย้อนกลับไว้กับข้อความแรกที่ทำให้ข้อมูลเปลี่ยน
      const anchor = replies.find((m) => m.undoable)
      const snapshots = changed && anchor ? pushSnapshot(state, before, anchor.id) : state.snapshots

      const chat = [...state.chat, userMessage(text, action.channel, state.settings.currentPerson), ...replies]
      return {
        ...state,
        ...core,
        chat: soldToday ? withDailyIncomeNotice(chat, core, today()) : chat,
        snapshots,
      }
    }

    case 'recipe/confirm':
    case 'recipe/cancel': {
      const before = coreOf(state)
      const res = action.type === 'recipe/confirm' ? commitPendingRecipe(before) : cancelPendingRecipe(before)
      const anchor = res.messages.find((m) => m.undoable)
      return {
        ...state,
        ...res.core,
        chat: [...state.chat, ...res.messages],
        snapshots: res.changed && anchor ? pushSnapshot(state, before, anchor.id) : state.snapshots,
      }
    }

    case 'daily/save': {
      const res = recordDailySheet(coreOf(state), action)
      return {
        ...state,
        ...res.core,
        chat: withDailyIncomeNotice([...state.chat, ...res.messages], res.core, action.date),
      }
    }

    case 'asset/delete': {
      const asset = state.assets.find((a) => a.id === action.id)
      if (!asset) return state
      // ลบทรัพย์สินแล้วต้องลบรายจ่ายที่คู่กันด้วย ไม่งั้นเงินจะหายไปข้างเดียว
      const txIndex = state.transactions.findIndex(
        (t) => t.category === 'ซื้อทรัพย์สิน' && t.detail === asset.name && t.date === asset.date && t.amount === asset.amount,
      )
      return {
        ...state,
        assets: state.assets.filter((a) => a.id !== action.id),
        transactions: txIndex < 0 ? state.transactions : state.transactions.filter((_, i) => i !== txIndex),
      }
    }

    case 'person/switch': {
      const people = state.settings.people.includes(action.name)
        ? state.settings.people
        : [...state.settings.people, action.name]
      return { ...state, settings: { ...state.settings, people, currentPerson: action.name } }
    }

    case 'chat/undo': {
      const snap = state.snapshots.find((s) => s.msgId === action.msgId)
      if (!snap) return state
      return {
        ...state,
        ...snap.core,
        chat: [
          ...state.chat.map((m) => (m.id === action.msgId ? { ...m, undoable: false } : m)),
          systemNote('ย้อนกลับรายการล่าสุดแล้ว', state.chat.find((m) => m.id === action.msgId)?.channel ?? 'shop', 'ok'),
        ],
        snapshots: state.snapshots.filter((s) => s.msgId !== action.msgId),
      }
    }

    case 'chat/help':
      return {
        ...state,
        chat: [
          ...state.chat,
          ...(action.channel === 'money' ? moneyHelpMessages() : helpMessages()),
        ],
      }

    case 'chat/clear':
      // ล้างเฉพาะช่องที่เปิดอยู่ อีกช่องยังอยู่ครบ
      return {
        ...state,
        chat: [
          ...state.chat.filter((m) => m.channel !== action.channel),
          ...welcomeChat().filter((m) => m.channel === action.channel),
        ],
        snapshots: [],
      }

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
        chat: withDailyIncomeNotice([...state.chat, ...replies], sold.core, today()),
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
      return {
        ...state,
        ...res.core,
        chat: withDailyIncomeNotice([...state.chat, ...res.messages], res.core, action.date),
      }
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

    case 'tx/save': {
      const exists = state.transactions.some((t) => t.id === action.tx.id)
      const transactions = exists
        ? state.transactions.map((t) => (t.id === action.tx.id ? action.tx : t))
        : [action.tx, ...state.transactions]
      // จำหมวดใหม่ไว้ให้เลือกครั้งหน้า
      const key = action.tx.kind === 'expense' ? 'expenseCategories' : 'incomeCategories'
      const known = state.settings[key]
      const settings = known.includes(action.tx.category)
        ? state.settings
        : { ...state.settings, [key]: [...known, action.tx.category] }
      return { ...state, transactions, settings }
    }

    case 'tx/delete':
      return { ...state, transactions: state.transactions.filter((t) => t.id !== action.id) }

    case 'settings/save':
      return { ...state, settings: action.settings }

    case 'data/replace':
      return { ...action.state, chat: [...action.state.chat, systemNote('นำเข้าข้อมูลสำเร็จ', 'shop', 'ok')] }

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
