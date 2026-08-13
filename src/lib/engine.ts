import type {
  Asset,
  MoneyCategory,
  BaseUnit,
  ChatMessage,
  CoreState,
  Item,
  Lot,
  PendingRecipe,
  Production,
  Purchase,
  Recipe,
  Sale,
  Transaction,
  TxKind,
  Waste,
} from '../types'
import { CATEGORY_LABEL } from '../types'
import type { ParsedCommand } from './parser'
import { guessCategory } from './parser'
import { finishedStock, recipeCost, sellableLots, suggestPrice } from './calc'
import { addDays, costText, dayLabel, money, num, qtyText, qtyTextFull, today } from './format'
import { costUnitFor } from './units'

/* ===========================================================================
   ตัวลงมือทำจริง: รับคำสั่งที่แปลแล้ว -> แก้ข้อมูล -> ตอบกลับในแชท
   ทุกฟังก์ชันเป็น pure: รับ CoreState เดิม คืน CoreState ใหม่ (ไม่แก้ของเดิม)
=========================================================================== */

export function uid(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}${Date.now().toString(36)}${rand}`
}

export interface RunResult {
  core: CoreState
  messages: ChatMessage[]
  /** true เมื่อคำสั่งนี้ทำให้ข้อมูลเปลี่ยน (ใช้ตัดสินว่าจะโชว์ปุ่มย้อนกลับไหม) */
  changed: boolean
}

/** ข้อความจากบอท — ค่าปกติลงช่องของขาย ระบุ channel เมื่อต้องการส่งไปช่องเงิน */
function botMsg(
  text: string,
  opts: Partial<Pick<ChatMessage, 'tone' | 'details' | 'actions' | 'undoable' | 'channel'>> = {},
): ChatMessage {
  return {
    id: uid('m'),
    channel: 'shop',
    role: 'bot',
    text,
    at: new Date().toISOString(),
    tone: 'info',
    ...opts,
  }
}

/* --------------------------------------------------------------------------
   ค้นหาโดยชื่อแบบยืดหยุ่น
-------------------------------------------------------------------------- */

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s.·]/g, '')
}

/** หาโดยชื่อ: ตรงเป๊ะก่อน แล้วค่อยหาแบบมีคำนั้นอยู่ข้างใน เลือกชื่อที่เจาะจงที่สุด */
export function findByName<T extends { name: string }>(list: T[], name: string): T | undefined {
  const n = norm(name)
  if (!n) return undefined
  const exact = list.find((x) => norm(x.name) === n)
  if (exact) return exact
  const loose = list.filter((x) => {
    const xn = norm(x.name)
    return xn.includes(n) || (n.includes(xn) && xn.length >= 3)
  })
  if (!loose.length) return undefined
  return [...loose].sort((a, b) => norm(b.name).length - norm(a.name).length)[0]
}


/* --------------------------------------------------------------------------
   จับคำที่พิมพ์ -> หมวดหมู่
-------------------------------------------------------------------------- */

export interface CategoryMatch {
  /** ชื่อหมวดที่จะบันทึกจริง */
  name: string
  /** หมวดที่มีอยู่แล้วซึ่งตรงกับที่พิมพ์ (ถ้ามี) */
  matched?: MoneyCategory
  /** true เมื่อเข้าหมวดเพราะไปตรงกับ "คำสั้น" ไม่ใช่ชื่อหมวดเต็ม */
  viaKeyword: boolean
}

/**
 * หาว่าคำที่พิมพ์เข้าหมวดไหน
 * ลำดับ: ชื่อหมวดตรงเป๊ะ -> คำสั้นตรงเป๊ะ -> ไม่เจอก็ถือเป็นหมวดใหม่ตามที่พิมพ์
 * เทียบแบบไม่สนช่องว่างและตัวพิมพ์ใหญ่เล็ก คนพิมพ์เร็วๆ จะได้ไม่พลาด
 */
export function resolveCategory(categories: MoneyCategory[], typed: string, kind: 'income' | 'expense'): CategoryMatch {
  const want = norm(typed)
  const sameKind = categories.filter((c) => c.kind === kind)

  const byName = sameKind.find((c) => norm(c.name) === want)
  if (byName) return { name: byName.name, matched: byName, viaKeyword: false }

  const byKeyword = sameKind.find((c) => c.keywords.some((k) => norm(k) === want))
  if (byKeyword) return { name: byKeyword.name, matched: byKeyword, viaKeyword: true }

  return { name: typed, viaKeyword: false }
}

/** เจอหมวดใหม่ที่ยังไม่เคยใช้ ให้จำไว้เป็นตัวเลือกครั้งหน้า (ถ้ามีอยู่แล้วคืนค่าเดิม) */
export function rememberCategory<S extends { categories: MoneyCategory[] }>(
  settings: S,
  name: string,
  kind: TxKind,
  keywords: string[] = [],
): S {
  const clean = name.trim()
  if (!clean) return settings
  if (resolveCategory(settings.categories, clean, kind).matched) return settings
  return {
    ...settings,
    categories: [...settings.categories, { id: uid('c'), name: clean, kind, keywords }],
  }
}

/* --------------------------------------------------------------------------
   ซื้อของเข้าร้าน
-------------------------------------------------------------------------- */

const BASE_NAME: Record<BaseUnit, string> = { g: 'น้ำหนัก (กรัม)', ml: 'ปริมาตร (มิลลิลิตร)', pcs: 'จำนวนชิ้น' }

function applyPurchase(
  core: CoreState,
  cmd: Extract<ParsedCommand, { kind: 'purchase' }>,
  date: string,
  srcMsgId?: string,
): RunResult {
  const existing = findByName(core.items, cmd.name)

  if (existing && existing.base !== cmd.base) {
    return {
      core,
      changed: false,
      messages: [
        botMsg(`หน่วยไม่ตรงกับที่เคยบันทึกไว้`, {
          tone: 'error',
          details: [
            { label: 'ของในระบบ', value: `${existing.name} — เก็บเป็น${BASE_NAME[existing.base]}` },
            { label: 'ที่พิมพ์มา', value: `${BASE_NAME[cmd.base]}` },
          ],
          actions: [{ kind: 'openItem', label: 'เปิดดูของชิ้นนี้', itemId: existing.id }],
        }),
        botMsg('ถ้าเป็นคนละอย่างกัน ให้ตั้งชื่อให้ต่างกัน เช่น "มะม่วงลูก" กับ "มะม่วงเนื้อ" แล้วพิมพ์ใหม่อีกครั้ง', {
          tone: 'info',
        }),
      ],
    }
  }

  const unitCost = cmd.total / cmd.qty
  let item: Item
  let items: Item[]

  if (existing) {
    const newStock = Math.max(0, existing.stock) + cmd.qty
    const newAvg = (Math.max(0, existing.stock) * existing.avgCost + cmd.total) / newStock
    item = {
      ...existing,
      stock: newStock,
      avgCost: newAvg,
      lastCost: unitCost,
      // ของนับชิ้นที่เคยไม่รู้หน่วยเรียก ให้ยึดตามที่พิมพ์ล่าสุด
      unitLabel: existing.base === 'pcs' && existing.unitLabel === 'ชิ้น' ? cmd.unitLabel : existing.unitLabel,
    }
    items = core.items.map((i) => (i.id === item.id ? item : i))
  } else {
    item = {
      id: uid('i'),
      name: cmd.name,
      category: cmd.category,
      base: cmd.base,
      unitLabel: cmd.unitLabel,
      stock: cmd.qty,
      avgCost: unitCost,
      lastCost: unitCost,
      createdAt: new Date().toISOString(),
    }
    items = [...core.items, item]
  }

  const purchase = {
    id: uid('p'),
    date,
    itemId: item.id,
    itemName: item.name,
    qty: cmd.qty,
    total: cmd.total,
    unitCost,
    note: cmd.raw,
    srcMsgId,
    createdAt: new Date().toISOString(),
  }

  const details = [
    { label: 'หมวดหมู่', value: CATEGORY_LABEL[item.category] },
    {
      label: 'จำนวนที่ซื้อ',
      value: cmd.packNote
        ? `${qtyText(cmd.qty, cmd.base, cmd.unitLabel)} (${cmd.packNote})`
        : qtyTextFull(cmd.qty, cmd.base, cmd.unitLabel),
    },
    { label: 'ราคารวม', value: money(cmd.total) },
    { label: 'ต้นทุนต่อหน่วย', value: costText(unitCost, cmd.base, cmd.unitLabel) },
    { label: 'คงเหลือในสต็อก', value: qtyTextFull(item.stock, item.base, item.unitLabel) },
  ]
  if (existing && Math.abs(existing.avgCost - unitCost) > 1e-9 && existing.stock > 0) {
    const u = costUnitFor(item.base, item.unitLabel)
    details.push({
      label: 'ต้นทุนเฉลี่ยใหม่',
      value: `${num(item.avgCost * u.factor, 2)} บาท/${u.label} (เดิม ${num(existing.avgCost * u.factor, 2)})`,
    })
  }

  return {
    core: { ...core, items, purchases: [purchase, ...core.purchases] },
    changed: true,
    messages: [
      botMsg(`บันทึกแล้ว · ${item.name}`, {
        tone: 'ok',
        details,
        undoable: true,
        actions: [{ kind: 'openItem', label: 'เปิดดูในสต็อก', itemId: item.id }],
      }),
    ],
  }
}

/* --------------------------------------------------------------------------
   สร้าง / แก้สูตร
-------------------------------------------------------------------------- */

/**
 * รับสูตรจากแชทแล้ว "ถามยืนยันก่อน" ตามที่ร้านขอ
 * ยังไม่แตะข้อมูลจริงจนกว่าผู้ใช้จะกดยืนยัน จะได้ทันเห็นว่าอ่านถูกไหมและขาดอะไรบ้าง
 */
function askRecipeConfirm(core: CoreState, cmd: Extract<ParsedCommand, { kind: 'recipe' }>): RunResult {
  for (const ing of cmd.ingredients) {
    const item = findByName(core.items, ing.name)
    if (item && item.base !== ing.base) {
      return {
        core,
        changed: false,
        messages: [
          botMsg(`"${item.name}" ในระบบเก็บเป็น${BASE_NAME[item.base]} แต่ในสูตรพิมพ์เป็น${BASE_NAME[ing.base]}`, {
            tone: 'error',
          }),
        ],
      }
    }
  }

  const existing = findByName(core.recipes, cmd.name)
  const pending: PendingRecipe = {
    name: existing?.name ?? cmd.name,
    yieldQty: cmd.yieldQty,
    yieldUnit: cmd.yieldUnit,
    isUpdate: !!existing,
    raw: cmd.raw,
    ingredients: cmd.ingredients.map((ing) => {
      const item = findByName(core.items, ing.name)
      return {
        name: item?.name ?? ing.name,
        qty: ing.qty,
        base: ing.base,
        unitLabel: ing.unitLabel,
        known: !!item && (item.avgCost > 0 || item.lastCost > 0),
      }
    }),
  }

  const unknown = pending.ingredients.filter((i) => !i.known)
  const hasPackaging = pending.ingredients.some((i) => guessCategory(i.name) === 'packaging')

  const messages: ChatMessage[] = [
    botMsg(`${pending.isUpdate ? 'แก้สูตร' : 'สูตรใหม่'} · ${pending.name} — ถูกต้องแล้วใช่ไหม`, {
      tone: 'warn',
      details: [
        { label: 'ทำ 1 รอบได้', value: `${num(pending.yieldQty)} ${pending.yieldUnit}` },
        ...pending.ingredients.map((i) => ({
          label: i.name,
          value: qtyText(i.qty, i.base, i.unitLabel) + (i.known ? '' : '  ⚠️ ยังไม่รู้ราคา'),
        })),
      ],
      actions: [
        { kind: 'confirmRecipe', label: 'ถูกต้อง บันทึกเลย' },
        { kind: 'cancelRecipe', label: 'ยังไม่ใช่ ขอแก้' },
      ],
    }),
  ]

  const missing: string[] = []
  if (unknown.length) missing.push(`ยังไม่รู้ราคาของ ${unknown.map((i) => i.name).join(', ')}`)
  if (!hasPackaging) missing.push('ยังไม่ได้ใส่บรรจุภัณฑ์ (กล่อง/ถุง) ในสูตร')

  if (missing.length) {
    messages.push(
      botMsg('ตรวจแล้วยังขาดอยู่', {
        tone: 'warn',
        details: missing.map((m, i) => ({ label: `ข้อ ${i + 1}`, value: m })),
      }),
    )
    messages.push(
      botMsg('ถ้ายังไม่ครบ พิมพ์สูตรใหม่ทั้งบรรทัดได้เลย ระบบจะถามยืนยันอีกครั้ง — หรือกดยืนยันไปก่อนแล้วมาเติมทีหลังก็ได้', {
        tone: 'info',
      }),
    )
  } else {
    messages.push(botMsg('ตรวจแล้ววัตถุดิบและบรรจุภัณฑ์ครบ ไม่มีอะไรขาด', { tone: 'ok' }))
  }

  return { core: { ...core, pendingRecipe: pending }, changed: false, messages }
}

/** ผู้ใช้ยืนยันแล้ว — ลงมือบันทึกสูตรจริงและรายงานต้นทุนต่อกล่องกลับไป */
export function commitPendingRecipe(core: CoreState): RunResult {
  const pending = core.pendingRecipe
  if (!pending) {
    return { core, changed: false, messages: [botMsg('ไม่มีสูตรที่รอยืนยันอยู่', { tone: 'info' })] }
  }

  let items = [...core.items]
  const created: string[] = []
  const lines: Recipe['lines'] = []

  for (const ing of pending.ingredients) {
    let item = findByName(items, ing.name)
    if (!item) {
      item = {
        id: uid('i'),
        name: ing.name,
        category: guessCategory(ing.name),
        base: ing.base,
        unitLabel: ing.unitLabel,
        stock: 0,
        avgCost: 0,
        lastCost: 0,
        createdAt: new Date().toISOString(),
      }
      items = [...items, item]
      created.push(item.name)
    }
    lines.push({ itemId: item.id, qty: ing.qty })
  }

  const existing = findByName(core.recipes, pending.name)
  const recipe: Recipe = existing
    ? { ...existing, yieldQty: pending.yieldQty, yieldUnit: pending.yieldUnit, lines }
    : {
        id: uid('r'),
        name: pending.name,
        yieldQty: pending.yieldQty,
        yieldUnit: pending.yieldUnit,
        lines,
        overhead: { ...core.settings.defaultOverhead },
        marginPct: core.settings.defaultMarginPct,
        price: 0,
        createdAt: new Date().toISOString(),
      }

  const recipes = existing ? core.recipes.map((r) => (r.id === recipe.id ? recipe : r)) : [...core.recipes, recipe]
  const nextCore = { ...core, items, recipes, pendingRecipe: undefined }
  const cost = recipeCost(recipe, items)
  const suggestion = suggestPrice(
    cost.costPerUnit,
    recipe.marginPct || core.settings.defaultMarginPct,
    core.settings.priceMode,
    core.settings.priceRounding,
  )

  const messages: ChatMessage[] = [
    botMsg(`${existing ? 'แก้สูตรแล้ว' : 'บันทึกสูตรแล้ว'} · ${recipe.name}`, {
      tone: 'ok',
      undoable: true,
      details: [
        { label: 'ทำ 1 รอบได้', value: `${num(recipe.yieldQty)} ${recipe.yieldUnit}` },
        { label: `ค่าวัตถุดิบต่อ${recipe.yieldUnit}`, value: money(cost.materialPerUnit, 2) },
        { label: `ค่าแรง/น้ำ/ไฟ/จิปาถะต่อ${recipe.yieldUnit}`, value: money(cost.overheadPerUnit, 2) },
        { label: `ต้นทุนรวมต่อ${recipe.yieldUnit}`, value: money(cost.costPerUnit, 2) },
        { label: 'ราคาขายที่แนะนำ', value: `${money(suggestion.price)} (กำไร ${num(suggestion.markupPct, 0)}%)` },
      ],
      actions: [{ kind: 'openRecipe', label: 'เปิดตั้งค่าเมนู', recipeId: recipe.id }],
    }),
  ]
  if (created.length) {
    messages.push(
      botMsg(`เพิ่มวัตถุดิบใหม่ให้ ${created.length} รายการ: ${created.join(', ')}`, {
        tone: 'warn',
        details: [{ label: 'ยังไม่รู้ราคา', value: 'พิมพ์บันทึกการซื้อของพวกนี้ ต้นทุนถึงจะครบ' }],
      }),
    )
  }
  if (cost.unpriced.length) {
    messages.push(
      botMsg(`ต้นทุนที่คิดได้ยังไม่ครบ เพราะยังไม่รู้ราคาของ ${cost.unpriced.join(', ')}`, { tone: 'warn' }),
    )
  }

  return { core: nextCore, messages, changed: true }
}

/** ผู้ใช้บอกว่ายังไม่ถูก — ทิ้งสูตรที่ค้างไว้ */
export function cancelPendingRecipe(core: CoreState): RunResult {
  if (!core.pendingRecipe) {
    return { core, changed: false, messages: [botMsg('ไม่มีสูตรที่รอยืนยันอยู่', { tone: 'info' })] }
  }
  return {
    core: { ...core, pendingRecipe: undefined },
    changed: false,
    messages: [
      botMsg('ยกเลิกสูตรนี้แล้ว พิมพ์สูตรใหม่ได้เลย', {
        tone: 'info',
        details: [{ label: 'ตัวอย่าง', value: 'สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม, กล่อง p39 20 กล่อง' }],
      }),
    ],
  }
}

/* --------------------------------------------------------------------------
   ผลิตขนม
-------------------------------------------------------------------------- */

function missingRecipeMsg(name: string): ChatMessage {
  return botMsg(`ยังไม่มีเมนู "${name}" ในระบบ`, {
    tone: 'warn',
    details: [
      {
        label: 'สร้างจากแชทได้เลย',
        value: `สูตร${name} ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม, แป้งเค้ก 800 กรัม, กล่อง p39 20 กล่อง`,
      },
    ],
    actions: [{ kind: 'openRecipe', label: `สร้างเมนู "${name}"`, name }],
  })
}

export function produce(core: CoreState, recipe: Recipe, qty: number, date: string, srcMsgId?: string): RunResult {
  const scale = recipe.yieldQty > 0 ? qty / recipe.yieldQty : 0
  const cost = recipeCost(recipe, core.items, scale)

  const usedById = new Map(cost.lines.map((l) => [l.itemId, l]))
  const items = core.items.map((i) => {
    const line = usedById.get(i.id)
    return line ? { ...i, stock: i.stock - line.qty } : i
  })

  const production = {
    id: uid('pr'),
    date,
    recipeId: recipe.id,
    recipeName: recipe.name,
    qty,
    unit: recipe.yieldUnit,
    used: cost.lines.map((l) => ({
      itemId: l.itemId,
      itemName: l.name,
      qty: l.qty,
      base: l.base,
      unitLabel: l.unitLabel,
      cost: l.cost,
    })),
    materialCost: cost.materialCost,
    overhead: {
      labor: recipe.overhead.labor * scale,
      water: recipe.overhead.water * scale,
      electric: recipe.overhead.electric * scale,
      misc: recipe.overhead.misc * scale,
    },
    overheadCost: cost.overheadCost,
    totalCost: cost.totalCost,
    costPerUnit: cost.costPerUnit,
    srcMsgId,
    createdAt: new Date().toISOString(),
  }

  const lot: Lot = {
    id: uid('l'),
    recipeId: recipe.id,
    recipeName: recipe.name,
    unit: recipe.yieldUnit,
    date,
    sellDate: date,
    qty,
    remaining: qty,
    costPerUnit: cost.costPerUnit,
    carriedOver: false,
    srcMsgId,
    createdAt: new Date().toISOString(),
  }

  const suggestion = suggestPrice(
    cost.costPerUnit,
    recipe.marginPct || core.settings.defaultMarginPct,
    core.settings.priceMode,
    core.settings.priceRounding,
  )
  const priceLabel = recipe.price > 0 ? money(recipe.price) : `${money(suggestion.price)} (แนะนำ)`

  const messages: ChatMessage[] = [
    botMsg(`ผลิตแล้ว · ${recipe.name} ${num(qty)} ${recipe.yieldUnit}`, {
      tone: 'ok',
      undoable: true,
      details: [
        { label: 'ค่าวัตถุดิบ', value: money(cost.materialCost, 2) },
        { label: 'ค่าแรง/น้ำ/ไฟ/จิปาถะ', value: money(cost.overheadCost, 2) },
        { label: 'ต้นทุนรวม', value: money(cost.totalCost, 2) },
        { label: `ต้นทุนต่อ${recipe.yieldUnit}`, value: money(cost.costPerUnit, 2) },
        { label: 'ราคาขาย', value: priceLabel },
      ],
      actions: [{ kind: 'openRecipe', label: 'ดูรายละเอียดเมนู', recipeId: recipe.id }],
    }),
    botMsg('ตัดสต็อกวัตถุดิบแล้ว', {
      tone: 'info',
      details: cost.lines.map((l) => {
        const after = l.available - l.qty
        return {
          label: l.name,
          value: `ใช้ ${qtyText(l.qty, l.base, l.unitLabel)} · เหลือ ${qtyText(after, l.base, l.unitLabel)}`,
        }
      }),
    }),
  ]

  const short = cost.lines.filter((l) => !l.enough)
  if (short.length) {
    messages.push(
      botMsg('สต็อกติดลบ — น่าจะยังไม่ได้บันทึกการซื้อของพวกนี้', {
        tone: 'warn',
        details: short.map((l) => ({
          label: l.name,
          value: `ขาดอีก ${qtyText(l.qty - l.available, l.base, l.unitLabel)}`,
        })),
      }),
    )
  }
  if (cost.unpriced.length) {
    messages.push(
      botMsg(`ยังไม่รู้ราคาของ ${cost.unpriced.join(', ')} — ต้นทุนที่คิดได้จึงยังไม่ครบ`, { tone: 'warn' }),
    )
  }

  return {
    core: { ...core, items, productions: [production, ...core.productions], lots: [lot, ...core.lots] },
    messages,
    changed: true,
  }
}

function applyProduce(
  core: CoreState,
  cmd: Extract<ParsedCommand, { kind: 'produce' }>,
  date: string,
  srcMsgId?: string,
): RunResult {
  const recipe = findByName(core.recipes, cmd.name)
  if (!recipe) return { core, changed: false, messages: [missingRecipeMsg(cmd.name)] }
  if (!recipe.lines.length) {
    return {
      core,
      changed: false,
      messages: [
        botMsg(`เมนู "${recipe.name}" ยังไม่ได้ใส่ส่วนผสม จึงคิดต้นทุนไม่ได้`, {
          tone: 'warn',
          actions: [{ kind: 'openRecipe', label: 'ใส่ส่วนผสม', recipeId: recipe.id }],
        }),
      ],
    }
  }
  return produce(core, recipe, cmd.qty, date, srcMsgId)
}

/* --------------------------------------------------------------------------
   ขายขนม
-------------------------------------------------------------------------- */

/** ตัดขนมออกจากล็อตแบบเก่าก่อน (FIFO) — ของยกมาจะถูกขายก่อนเสมอ */
function consumeLots(
  lots: Lot[],
  recipeId: string,
  qty: number,
  date: string,
): { lots: Lot[]; taken: number; cost: number; originalCost: number; lotIds: string[] } {
  const queue = sellableLots(lots, recipeId, date)
  let left = qty
  let cost = 0
  let originalCost = 0
  const lotIds: string[] = []
  const updates = new Map<string, number>()

  for (const lot of queue) {
    if (left <= 1e-9) break
    const take = Math.min(lot.remaining, left)
    left -= take
    cost += take * lot.costPerUnit
    originalCost += take * (lot.originalCostPerUnit ?? lot.costPerUnit)
    lotIds.push(lot.id)
    updates.set(lot.id, lot.remaining - take)
  }

  const next = lots.map((l) => (updates.has(l.id) ? { ...l, remaining: updates.get(l.id)! } : l))
  return { lots: next, taken: qty - left, cost, originalCost, lotIds }
}

function applySell(
  core: CoreState,
  cmd: Extract<ParsedCommand, { kind: 'sell' }>,
  date: string,
  srcMsgId?: string,
): RunResult {
  const recipe = findByName(core.recipes, cmd.name)
  if (!recipe) return { core, changed: false, messages: [missingRecipeMsg(cmd.name)] }

  const available = finishedStock(core.lots, recipe.id, date)
  const cost = recipeCost(recipe, core.items)
  const suggestion = suggestPrice(
    cost.costPerUnit,
    recipe.marginPct || core.settings.defaultMarginPct,
    core.settings.priceMode,
    core.settings.priceRounding,
  )
  const unitPrice = cmd.unitPrice ?? (recipe.price > 0 ? recipe.price : suggestion.price)

  if (unitPrice <= 0) {
    return {
      core,
      changed: false,
      messages: [
        botMsg(`ยังไม่รู้ราคาขายของ "${recipe.name}"`, {
          tone: 'warn',
          details: [{ label: 'พิมพ์ราคาต่อท้ายได้', value: `ขาย${recipe.name} ${num(cmd.qty)} ${cmd.unit} กล่องละ 120` }],
          actions: [{ kind: 'openRecipe', label: 'ตั้งราคาขาย', recipeId: recipe.id }],
        }),
      ],
    }
  }

  const sellQty = Math.min(cmd.qty, available)
  const shortfall = cmd.qty - sellQty
  const messages: ChatMessage[] = []

  if (sellQty <= 0) {
    // ของที่ยกไปขายวันหลังยังนับไม่ได้ในวันนี้ — บอกให้ชัด ไม่งั้นผู้ใช้งงว่าของหายไปไหน
    const waiting = core.lots.filter((l) => l.recipeId === recipe.id && l.remaining > 1e-9 && l.sellDate > date)
    const waitingQty = waiting.reduce((s, l) => s + l.remaining, 0)
    messages.push(
      botMsg(`ยังไม่มี "${recipe.name}" พร้อมขายใน${dayLabel(date)}`, {
        tone: 'warn',
        details: [
          { label: 'พร้อมขายตอนนี้', value: `0 ${recipe.yieldUnit}` },
          ...(waitingQty > 0
            ? [
                {
                  label: 'เตรียมไว้ขายวันหลัง',
                  value: `${num(waitingQty)} ${recipe.yieldUnit} · พร้อมขาย${dayLabel(waiting[0].sellDate)}`,
                },
              ]
            : []),
        ],
        actions: [
          {
            kind: 'produceThenSell',
            label: `บันทึกผลิต ${num(cmd.qty)} ${recipe.yieldUnit} แล้วขาย`,
            recipeId: recipe.id,
            produceQty: cmd.qty,
            sellQty: cmd.qty,
            unitPrice,
          },
        ],
      }),
    )
    return { core, changed: false, messages }
  }

  const taken = consumeLots(core.lots, recipe.id, sellQty, date)
  const revenue = sellQty * unitPrice
  const sale = {
    id: uid('s'),
    date,
    recipeId: recipe.id,
    recipeName: recipe.name,
    qty: sellQty,
    unit: recipe.yieldUnit,
    unitPrice,
    revenue,
    cost: taken.cost,
    lotIds: taken.lotIds,
    srcMsgId,
    createdAt: new Date().toISOString(),
  }

  const profit = revenue - taken.cost
  const carriedPart = taken.originalCost - taken.cost
  const details = [
    { label: 'จำนวน', value: `${num(sellQty)} ${recipe.yieldUnit} × ${money(unitPrice)}` },
    { label: 'ยอดขาย', value: money(revenue) },
    { label: 'ต้นทุนของที่ขายไป', value: money(taken.cost, 2) },
    { label: 'กำไร', value: `${money(profit, 2)} (${num((profit / revenue) * 100, 1)}% ของยอดขาย)` },
    { label: 'คงเหลือพร้อมขาย', value: `${num(available - sellQty)} ${recipe.yieldUnit}` },
  ]
  if (carriedPart > 1e-6) {
    details.splice(3, 0, {
      label: 'มีของยกมาจากวันก่อน',
      value: `ไม่คิดต้นทุนซ้ำ (ทุนเดิม ${money(carriedPart, 2)} ถูกคิดไปแล้ววันที่ผลิต)`,
    })
  }

  messages.push(botMsg(`ขายแล้ว · ${recipe.name}`, { tone: 'ok', undoable: true, details }))

  if (shortfall > 0) {
    messages.push(
      botMsg(`มีของไม่พอ ขาดอีก ${num(shortfall)} ${recipe.yieldUnit}`, {
        tone: 'warn',
        actions: [
          {
            kind: 'produceThenSell',
            label: `บันทึกผลิต ${num(shortfall)} แล้วขายเพิ่ม`,
            recipeId: recipe.id,
            produceQty: shortfall,
            sellQty: shortfall,
            unitPrice,
          },
        ],
      }),
    )
  }

  return {
    core: { ...core, lots: taken.lots, sales: [sale, ...core.sales] },
    messages,
    changed: true,
  }
}

/* --------------------------------------------------------------------------
   ของเหลือยกไปขายวันถัดไป
-------------------------------------------------------------------------- */

function applyCarryover(
  core: CoreState,
  cmd: Extract<ParsedCommand, { kind: 'carryover' }>,
  date: string,
  srcMsgId?: string,
): RunResult {
  const recipe = findByName(core.recipes, cmd.name)
  const recipeId = recipe?.id ?? uid('r-ghost')
  const recipeName = recipe?.name ?? cmd.name
  const unit = recipe?.yieldUnit ?? cmd.unit

  // ของที่ผลิตวันนี้ -> ยกไปขายพรุ่งนี้ · ของค้างจากวันก่อน -> พร้อมขายวันนี้เลย
  let left = cmd.qty
  let converted = 0
  const lots = [...core.lots]
  const newLots: Lot[] = []

  if (recipe) {
    const queue = core.lots
      .filter((l) => l.recipeId === recipe.id && l.remaining > 1e-9 && !l.carriedOver)
      .sort((a, b) => a.date.localeCompare(b.date))

    for (const lot of queue) {
      if (left <= 1e-9) break
      const take = Math.min(lot.remaining, left)
      left -= take
      converted += take
      const sellDate = lot.date >= date ? addDays(date, 1) : date
      const idx = lots.findIndex((l) => l.id === lot.id)
      // ตัดจำนวนที่ยกไปออกจากล็อตเดิม แล้วสร้างล็อต "ของยกมา" ที่ทุนเป็น 0
      lots[idx] = { ...lot, remaining: lot.remaining - take }
      newLots.push({
        id: uid('l'),
        recipeId: recipe.id,
        recipeName: recipe.name,
        unit,
        date: lot.date,
        sellDate,
        qty: take,
        remaining: take,
        costPerUnit: 0,
        originalCostPerUnit: lot.costPerUnit,
        carriedOver: true,
        fromLotId: lot.id,
        srcMsgId,
        createdAt: new Date().toISOString(),
      })
    }
  }

  // ส่วนที่ไม่มีล็อตรองรับ (เช่น ไม่ได้บันทึกการผลิตไว้) สร้างเป็นของยกมาทุน 0
  if (left > 1e-9) {
    newLots.push({
      id: uid('l'),
      recipeId,
      recipeName,
      unit,
      date,
      sellDate: addDays(date, 1),
      qty: left,
      remaining: left,
      costPerUnit: 0,
      carriedOver: true,
      srcMsgId,
      createdAt: new Date().toISOString(),
    })
  }

  const sellDates = [...new Set(newLots.map((l) => l.sellDate))].sort()
  const messages: ChatMessage[] = [
    botMsg(`เก็บไว้ขายต่อ · ${recipeName} ${num(cmd.qty)} ${unit}`, {
      tone: 'ok',
      undoable: true,
      details: [
        { label: 'พร้อมขาย', value: sellDates.map((d) => dayLabel(d)).join(' และ ') },
        { label: 'ต้นทุน', value: 'ไม่คิดซ้ำ — คิดไปแล้วตอนผลิต' },
        {
          label: 'กำไรเมื่อขายได้',
          value: 'เท่ากับราคาขายเต็มจำนวน',
        },
      ],
    }),
  ]
  if (!recipe) {
    messages.push(
      botMsg(`ยังไม่มีเมนู "${cmd.name}" ในระบบ แต่บันทึกของเหลือให้แล้ว — สร้างสูตรไว้จะช่วยให้ดูรายงานได้ครบขึ้น`, {
        tone: 'info',
        actions: [{ kind: 'openRecipe', label: `สร้างเมนู "${cmd.name}"`, name: cmd.name }],
      }),
    )
  } else if (converted < cmd.qty - 1e-9) {
    messages.push(
      botMsg(`ในระบบมีของค้างอยู่ ${num(converted)} ${unit} ที่เหลือถือเป็นของยกมาที่ยังไม่ได้บันทึกการผลิต`, {
        tone: 'info',
      }),
    )
  }

  return { core: { ...core, lots: [...newLots, ...lots] }, messages, changed: true }
}

/* --------------------------------------------------------------------------
   ของเสีย / ทิ้ง
-------------------------------------------------------------------------- */

function applyWaste(
  core: CoreState,
  cmd: Extract<ParsedCommand, { kind: 'waste' }>,
  date: string,
  srcMsgId?: string,
): RunResult {
  const recipe = findByName(core.recipes, cmd.name)
  if (!recipe) return { core, changed: false, messages: [missingRecipeMsg(cmd.name)] }

  const taken = consumeLots(core.lots, recipe.id, cmd.qty, date)
  if (taken.taken <= 0) {
    return {
      core,
      changed: false,
      messages: [botMsg(`ไม่มี "${recipe.name}" ค้างอยู่ในระบบให้ตัดทิ้ง`, { tone: 'warn' })],
    }
  }

  const waste = {
    id: uid('w'),
    date,
    recipeId: recipe.id,
    recipeName: recipe.name,
    qty: taken.taken,
    unit: recipe.yieldUnit,
    cost: taken.originalCost,
    lotIds: taken.lotIds,
    reason: cmd.reason,
    srcMsgId,
    createdAt: new Date().toISOString(),
  }

  return {
    core: { ...core, lots: taken.lots, wastes: [waste, ...core.wastes] },
    changed: true,
    messages: [
      botMsg(`บันทึกของเสีย · ${recipe.name} ${num(taken.taken)} ${recipe.yieldUnit}`, {
        tone: 'warn',
        undoable: true,
        details: [
          { label: 'มูลค่าต้นทุนที่เสียไป', value: money(taken.originalCost, 2) },
          ...(cmd.reason ? [{ label: 'สาเหตุ', value: cmd.reason }] : []),
        ],
      }),
    ],
  }
}

/* --------------------------------------------------------------------------
   ปรับสต็อกจากการนับจริง
-------------------------------------------------------------------------- */

function applyAdjust(core: CoreState, cmd: Extract<ParsedCommand, { kind: 'adjust' }>): RunResult {
  const item = findByName(core.items, cmd.name)
  if (!item) {
    return { core, changed: false, messages: [botMsg(`ไม่เจอ "${cmd.name}" ในสต็อก`, { tone: 'warn' })] }
  }
  if (item.base !== cmd.base) {
    return {
      core,
      changed: false,
      messages: [botMsg(`"${item.name}" เก็บเป็น${BASE_NAME[item.base]} — พิมพ์หน่วยให้ตรงกันด้วย`, { tone: 'error' })],
    }
  }
  const diff = cmd.qty - item.stock
  const items = core.items.map((i) => (i.id === item.id ? { ...i, stock: cmd.qty } : i))
  return {
    core: { ...core, items },
    changed: true,
    messages: [
      botMsg(`ปรับสต็อกแล้ว · ${item.name}`, {
        tone: 'ok',
        undoable: true,
        details: [
          { label: 'จากเดิม', value: qtyText(item.stock, item.base, item.unitLabel) },
          { label: 'เป็น', value: qtyText(cmd.qty, item.base, item.unitLabel) },
          { label: 'ส่วนต่าง', value: `${diff >= 0 ? '+' : ''}${qtyText(diff, item.base, item.unitLabel)}` },
        ],
      }),
    ],
  }
}

/* --------------------------------------------------------------------------
   รายรับ-รายจ่ายที่ไม่เกี่ยวกับสต็อก
-------------------------------------------------------------------------- */

function applyMoney(
  core: CoreState,
  cmd: Extract<ParsedCommand, { kind: 'expense' | 'income' }>,
  date: string,
  srcMsgId?: string,
): RunResult {
  const isExpense = cmd.kind === 'expense'
  const match = resolveCategory(core.settings.categories, cmd.category, cmd.kind)

  const tx: Transaction = {
    id: uid('t'),
    date,
    kind: cmd.kind,
    category: match.name,
    detail: cmd.detail,
    amount: cmd.amount,
    by: core.settings.currentPerson,
    srcMsgId,
    createdAt: new Date().toISOString(),
  }

  // หมวดใหม่ที่ยังไม่เคยใช้ ให้จำไว้เป็นตัวเลือกครั้งหน้า
  const settings = rememberCategory(core.settings, match.name, cmd.kind)

  const details = [
    { label: 'หมวดหมู่', value: match.name },
    { label: 'จำนวนเงิน', value: money(cmd.amount, 2) },
    { label: 'วันที่', value: dayLabel(date) },
  ]
  if (cmd.detail) details.push({ label: 'หมายเหตุ', value: cmd.detail })
  if (match.viaKeyword) {
    details.push({ label: 'เข้าหมวดนี้เพราะ', value: `"${cmd.category}" เป็นคำสั้นของหมวด "${match.name}"` })
  }
  if (!match.matched) {
    details.push({ label: 'หมวดใหม่', value: 'จำไว้ให้แล้ว ตั้งคำสั้นเพิ่มได้ในหน้าตั้งค่า' })
  }

  return {
    core: { ...core, transactions: [tx, ...core.transactions], settings },
    changed: true,
    messages: [
      botMsg(`บันทึก${isExpense ? 'รายจ่าย' : 'รายรับ'}แล้ว · ${match.name}`, {
        channel: 'money',
        tone: 'ok',
        undoable: true,
        details,
      }),
    ],
  }
}

/* --------------------------------------------------------------------------
   ทรัพย์สิน
-------------------------------------------------------------------------- */

function applyAsset(
  core: CoreState,
  cmd: Extract<ParsedCommand, { kind: 'asset' }>,
  date: string,
  srcMsgId?: string,
): RunResult {
  const by = core.settings.currentPerson
  const unitLabel = cmd.unitLabel ?? ''
  // ปริมาณที่ได้ = เงินที่จ่าย ÷ ราคาต่อหน่วย เช่น จ่าย 10,000 ทองบาทละ 65,000 -> ได้ 0.1538 บาท
  const qty = cmd.unitPrice && cmd.unitPrice > 0 ? cmd.amount / cmd.unitPrice : 0

  const asset: Asset = {
    id: uid('a'),
    date,
    name: cmd.name,
    qty,
    unitLabel,
    unitPrice: cmd.unitPrice ?? 0,
    amount: cmd.amount,
    by,
    srcMsgId,
    createdAt: new Date().toISOString(),
  }

  // เงินที่จ่ายซื้อทรัพย์สินก็คือเงินที่ออกจากกระเป๋า จึงลงเป็นรายจ่ายด้วย
  const tx: Transaction = {
    id: uid('t'),
    date,
    kind: 'expense',
    category: 'ซื้อทรัพย์สิน',
    detail: cmd.name,
    amount: cmd.amount,
    by,
    srcMsgId,
    createdAt: new Date().toISOString(),
  }

  const settings = rememberCategory(core.settings, 'ซื้อทรัพย์สิน', 'expense', ['ทรัพย์สิน'])

  const details = [
    { label: 'เงินที่จ่าย', value: money(cmd.amount) },
    ...(cmd.unitPrice
      ? [
          { label: 'ราคาต่อหน่วย', value: `${money(cmd.unitPrice)} ต่อ ${unitLabel || 'หน่วย'}` },
          { label: 'ได้มา', value: `${num(qty, 4)} ${unitLabel || 'หน่วย'}` },
        ]
      : [{ label: 'ปริมาณ', value: 'ไม่ได้ระบุราคาต่อหน่วย จึงยังไม่รู้ว่าได้มาเท่าไหร่' }]),
    { label: 'บันทึกเป็น', value: 'รายจ่ายหมวด "ซื้อทรัพย์สิน" ด้วย เพราะเงินออกจากกระเป๋าจริง' },
  ]

  return {
    core: { ...core, assets: [asset, ...core.assets], transactions: [tx, ...core.transactions], settings },
    changed: true,
    messages: [
      botMsg(`บันทึกทรัพย์สินแล้ว · ${cmd.name}`, {
        channel: 'money',
        tone: 'ok',
        undoable: true,
        details,
      }),
    ],
  }
}

/* --------------------------------------------------------------------------
   คำถาม (ไม่แก้ข้อมูล)
-------------------------------------------------------------------------- */

function answerStock(core: CoreState, cmd: Extract<ParsedCommand, { kind: 'stock' }>): ChatMessage[] {
  if (cmd.name) {
    const item = findByName(core.items, cmd.name)
    if (item) {
      return [
        botMsg(`สต็อก · ${item.name}`, {
          tone: 'info',
          details: [
            { label: 'หมวดหมู่', value: CATEGORY_LABEL[item.category] },
            { label: 'คงเหลือ', value: qtyTextFull(item.stock, item.base, item.unitLabel) },
            { label: 'ต้นทุนเฉลี่ย', value: costText(item.avgCost, item.base, item.unitLabel) },
            { label: 'มูลค่าคงเหลือ', value: money(item.stock * item.avgCost, 2) },
          ],
          actions: [{ kind: 'openItem', label: 'เปิดดูรายละเอียด', itemId: item.id }],
        }),
      ]
    }
    const recipe = findByName(core.recipes, cmd.name)
    if (recipe) {
      const ready = finishedStock(core.lots, recipe.id)
      return [
        botMsg(`ขนมพร้อมขาย · ${recipe.name}`, {
          tone: 'info',
          details: [{ label: 'พร้อมขายตอนนี้', value: `${num(ready)} ${recipe.yieldUnit}` }],
        }),
      ]
    }
    return [botMsg(`ไม่เจอ "${cmd.name}" ทั้งในวัตถุดิบและเมนู`, { tone: 'warn' })]
  }

  if (!core.items.length) {
    return [botMsg('ยังไม่มีของในสต็อก — พิมพ์บันทึกการซื้อได้เลย เช่น "ซื้อมะม่วง 3 กิโล 112 บาท"', { tone: 'info' })]
  }
  const top = [...core.items].sort((a, b) => b.stock * b.avgCost - a.stock * a.avgCost).slice(0, 12)
  return [
    botMsg(`สต็อกวัตถุดิบ ${core.items.length} รายการ`, {
      tone: 'info',
      details: top.map((i) => ({
        label: i.name,
        value: `${qtyText(i.stock, i.base, i.unitLabel)} · ${costText(i.avgCost, i.base, i.unitLabel)}`,
      })),
    }),
  ]
}

function answerCost(core: CoreState, cmd: Extract<ParsedCommand, { kind: 'cost' }>): ChatMessage[] {
  const recipe = findByName(core.recipes, cmd.name)
  if (!recipe) return [missingRecipeMsg(cmd.name)]

  const cost = recipeCost(recipe, core.items)
  const pct = cmd.marginPct ?? (recipe.marginPct || core.settings.defaultMarginPct)
  const s = suggestPrice(cost.costPerUnit, pct, core.settings.priceMode, core.settings.priceRounding)
  const unit = recipe.yieldUnit

  const messages: ChatMessage[] = [
    botMsg(`ต้นทุน · ${recipe.name}`, {
      tone: 'info',
      details: [
        { label: `ค่าวัตถุดิบต่อ${unit}`, value: money(cost.materialPerUnit, 2) },
        { label: `ค่าแรง/น้ำ/ไฟ/จิปาถะต่อ${unit}`, value: money(cost.overheadPerUnit, 2) },
        { label: `ต้นทุนรวมต่อ${unit}`, value: money(cost.costPerUnit, 2) },
      ],
      actions: [{ kind: 'openRecipe', label: 'เปิดหน้าคิดราคา', recipeId: recipe.id }],
    }),
    botMsg(`อยากได้กำไร ${num(pct)}% ควรขาย ${money(s.price)} ต่อ${unit}`, {
      tone: 'ok',
      details: [
        { label: 'ราคาขายที่แนะนำ', value: money(s.price) },
        { label: 'กำไรต่อ' + unit, value: money(s.profit, 2) },
        { label: 'คิดเป็น', value: `${num(s.markupPct, 1)}% ของทุน · ${num(s.marginPct, 1)}% ของราคาขาย` },
        ...(recipe.price > 0
          ? [{ label: 'ราคาที่ตั้งไว้ตอนนี้', value: money(recipe.price) }]
          : []),
      ],
    }),
  ]
  if (cost.unpriced.length) {
    messages.push(botMsg(`ยังไม่รู้ราคาของ ${cost.unpriced.join(', ')} — ต้นทุนจริงจะสูงกว่านี้`, { tone: 'warn' }))
  }
  return messages
}

export function helpMessages(): ChatMessage[] {
  return [
    botMsg('พิมพ์แบบที่พูดได้เลย ระบบจะจดและคิดต้นทุนให้เอง', {
      tone: 'info',
      details: [
        { label: 'ซื้อของ', value: 'ซื้อกล่อง p39 1 ลัง ลังละ 1000 กล่อง ราคารวม 1680 บาท' },
        { label: 'ซื้อของสด', value: 'ซื้อมะม่วง 3 กิโล ราคารวม 112 บาท' },
        { label: 'ตั้งสูตร', value: 'สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม, กล่อง p39 20 กล่อง' },
        { label: 'ทำขนม', value: 'ทำเค้กมะม่วง 20 กล่อง' },
        { label: 'ขาย', value: 'ขายเค้กมะม่วง 15 กล่อง กล่องละ 120' },
        { label: 'ของเหลือขายต่อ', value: 'เหลือเค้กมะม่วง 5 กล่อง' },
        { label: 'ของเสีย', value: 'ทิ้งเค้กมะม่วง 2 กล่อง เพราะบูด' },
        { label: 'ค่าใช้จ่ายอื่น', value: 'จ่ายค่าเช่าร้าน 5000 บาท' },
        { label: 'บิลค่าน้ำค่าไฟ', value: 'ค่าไฟ 1200 บาท' },
        { label: 'รายรับอื่น', value: 'รับเงินค่าจ้างทำเค้ก 800 บาท' },
        { label: 'ถามต้นทุน', value: 'ต้นทุนเค้กมะม่วง กำไร 40%' },
        { label: 'ถามสต็อก', value: 'สต็อกมะม่วง' },
        { label: 'นับสต็อกใหม่', value: 'ปรับสต็อกมะม่วง 800 กรัม' },
      ],
    }),
    botMsg('พิมพ์หลายบรรทัดพร้อมกันได้ — บรรทัดต่อไปจะถือว่าเป็นคำสั่งเดียวกับบรรทัดแรก', { tone: 'info' }),
    botMsg('พิมพ์ผิด กดไอคอนถังขยะข้างข้อความได้เลย ระบบจะถอนสต็อก ยอดขาย และตัวเลขในสรุปที่ข้อความนั้นทำไว้ออกให้ด้วย', {
      tone: 'info',
    }),
  ]
}


/* --------------------------------------------------------------------------
   ตารางบันทึกรายวัน — ทำเท่าไหร่ เหลือเท่าไหร่ ขายได้เท่าไหร่
   ขายได้ = ทำ − เหลือ  ระบบคิดให้เอง ไม่ต้องกรอกซ้ำ
-------------------------------------------------------------------------- */

export interface DailySheetInput {
  recipeId: string
  date: string
  produced: number
  leftover: number
  unitPrice: number
}

/** ยอดของเมนูหนึ่งในวันหนึ่ง อ่านกลับจากข้อมูลจริงที่บันทึกไว้ */
export interface DailySheetRow {
  recipeId: string
  name: string
  unit: string
  produced: number
  leftover: number
  sold: number
  unitPrice: number
  revenue: number
  cost: number
  profit: number
}

/** คืนสต็อกวัตถุดิบที่เคยตัดไปของวัน+เมนูนั้น เพื่อให้บันทึกทับได้โดยตัวเลขไม่บวม */
function rollbackDay(core: CoreState, recipeId: string, date: string): CoreState {
  const stale = core.productions.filter((p) => p.recipeId === recipeId && p.date === date)
  if (!stale.length && !core.sales.some((x) => x.recipeId === recipeId && x.date === date)) return core

  const restore = new Map<string, number>()
  for (const prod of stale) {
    for (const u of prod.used) restore.set(u.itemId, (restore.get(u.itemId) ?? 0) + u.qty)
  }

  return {
    ...core,
    items: core.items.map((i) => (restore.has(i.id) ? { ...i, stock: i.stock + restore.get(i.id)! } : i)),
    productions: core.productions.filter((p) => !(p.recipeId === recipeId && p.date === date)),
    sales: core.sales.filter((x) => !(x.recipeId === recipeId && x.date === date)),
    lots: core.lots.filter((l) => !(l.recipeId === recipeId && l.date === date)),
  }
}

/**
 * บันทึกยอดของวัน — เขียนทับของเดิมได้เรื่อยๆ (แก้ตัวเลขกี่รอบก็ไม่ซ้ำซ้อน)
 * ของที่เหลือจะกลายเป็นล็อตยกไปขายวันถัดไปโดยไม่คิดต้นทุนซ้ำ
 */
export function recordDailySheet(core: CoreState, input: DailySheetInput): RunResult {
  const recipe = core.recipes.find((r) => r.id === input.recipeId)
  if (!recipe) return { core, changed: false, messages: [botMsg('ไม่เจอเมนูนี้', { tone: 'error' })] }

  const produced = Math.max(0, input.produced)
  const leftover = Math.min(Math.max(0, input.leftover), produced)
  const sold = produced - leftover

  let next = rollbackDay(core, recipe.id, input.date)
  if (produced <= 0) {
    return {
      core: next,
      changed: true,
      messages: [botMsg(`ล้างยอดของ ${recipe.name} วัน${dayLabel(input.date)} แล้ว`, { tone: 'info' })],
    }
  }

  // ผลิต: ตัดสต็อกวัตถุดิบและคิดต้นทุน
  const prodResult = produce(next, recipe, produced, input.date)
  next = prodResult.core
  const production = next.productions[0]
  const lot = next.lots.find((l) => l.recipeId === recipe.id && l.date === input.date)!

  const unitPrice = input.unitPrice > 0 ? input.unitPrice : recipe.price
  let saleCost = 0

  if (sold > 0) {
    saleCost = sold * lot.costPerUnit
    next = {
      ...next,
      lots: next.lots.map((l) => (l.id === lot.id ? { ...l, remaining: l.remaining - sold } : l)),
      sales: [
        {
          id: uid('s'),
          date: input.date,
          recipeId: recipe.id,
          recipeName: recipe.name,
          qty: sold,
          unit: recipe.yieldUnit,
          unitPrice,
          revenue: sold * unitPrice,
          cost: saleCost,
          lotIds: [lot.id],
          createdAt: new Date().toISOString(),
        },
        ...next.sales,
      ],
    }
  }

  // ที่เหลือ ยกไปขายวันถัดไป ต้นทุนคิดไปแล้ววันนี้จึงเป็น 0
  if (leftover > 0) {
    next = {
      ...next,
      lots: next.lots.map((l) =>
        l.id === lot.id
          ? { ...l, remaining: 0 }
          : l,
      ),
    }
    next = {
      ...next,
      lots: [
        {
          id: uid('l'),
          recipeId: recipe.id,
          recipeName: recipe.name,
          unit: recipe.yieldUnit,
          date: input.date,
          sellDate: addDays(input.date, 1),
          qty: leftover,
          remaining: leftover,
          costPerUnit: 0,
          originalCostPerUnit: lot.costPerUnit,
          carriedOver: true,
          createdAt: new Date().toISOString(),
        },
        ...next.lots,
      ],
    }
  }

  const revenue = sold * unitPrice
  const details = [
    { label: 'ทำไป', value: `${num(produced)} ${recipe.yieldUnit}` },
    { label: 'เหลือ', value: `${num(leftover)} ${recipe.yieldUnit}` },
    { label: 'ขายได้ (ทำ − เหลือ)', value: `${num(sold)} ${recipe.yieldUnit}` },
    { label: 'ราคาต่อหน่วย', value: money(unitPrice) },
    { label: 'ยอดขาย', value: money(revenue) },
    { label: `ต้นทุนต่อ${recipe.yieldUnit}`, value: money(production.costPerUnit, 2) },
    { label: 'ต้นทุนที่ผลิตวันนี้', value: money(production.totalCost, 2) },
    { label: 'กำไรวันนี้', value: money(revenue - production.totalCost, 2) },
  ]
  if (leftover > 0) {
    details.push({ label: 'ของเหลือ', value: `ยกไปขาย${dayLabel(addDays(input.date, 1))} ไม่คิดต้นทุนซ้ำ` })
  }

  return {
    core: next,
    changed: true,
    messages: [
      botMsg(`บันทึกยอดวัน${dayLabel(input.date)} · ${recipe.name}`, { tone: 'ok', details }),
    ],
  }
}

/** อ่านยอดของทุกเมนูในวันที่กำหนด สำหรับแสดงเป็นตาราง */
export function readDailySheet(core: CoreState, date: string): DailySheetRow[] {
  return core.recipes.map((recipe) => {
    const production = core.productions.find((p) => p.recipeId === recipe.id && p.date === date)
    const sale = core.sales.find((x) => x.recipeId === recipe.id && x.date === date)
    const carried = core.lots.find((l) => l.recipeId === recipe.id && l.date === date && l.carriedOver)
    const produced = production?.qty ?? 0
    const leftover = carried?.qty ?? 0
    const sold = sale?.qty ?? Math.max(0, produced - leftover)
    const unitPrice = sale?.unitPrice ?? recipe.price
    const revenue = sale?.revenue ?? sold * unitPrice
    const cost = production?.totalCost ?? 0
    return {
      recipeId: recipe.id,
      name: recipe.name,
      unit: recipe.yieldUnit,
      produced,
      leftover,
      sold,
      unitPrice,
      revenue,
      cost,
      profit: revenue - cost,
    }
  })
}

/** ข้อความช่วยเหลือของช่องรายรับ-รายจ่าย */
export function moneyHelpMessages(): ChatMessage[] {
  return [
    botMsg('พิมพ์สั้นๆ ได้เลย ระบบเดาให้ว่าเป็นรายจ่าย', {
      channel: 'money',
      tone: 'info',
      details: [
        { label: 'แบบสั้นที่สุด', value: 'ลูก 100  →  รายจ่ายหมวด "ลูก" 100 บาท' },
        { label: 'ค่าอาหาร', value: 'กิน 100' },
        { label: 'ใส่คำว่าจ่ายก็ได้', value: 'จ่ายค่าเช่าร้าน 5000 บาท' },
        { label: 'เงินเข้า ใส่ + นำหน้า', value: '+ รับจ้างทำเค้ก 800' },
        { label: 'หรือพิมพ์เต็ม', value: 'รับเงินค่าจ้างทำเค้ก 800 บาท' },
        { label: 'ทรัพย์สิน', value: 'ซื้อทองคำ จำนวน 10000 บาท ที่ราคาบาทละ 65000 บาท' },
      ],
    }),
    botMsg('คำสั้นอย่าง "กิน" หรือ "ค่าไฟ" ตั้งเองได้ในหน้าตั้งค่า > หมวดหมู่รายรับ-รายจ่าย', {
      channel: 'money',
      tone: 'info',
      details: [
        { label: 'ตัวอย่าง', value: 'หมวด "ค่าอาหาร" ตั้งคำสั้นเป็น กิน / อาหาร / ข้าว' },
        { label: 'พิมพ์แล้วได้อะไร', value: 'พิมพ์ "กิน 100" → บันทึกเป็นค่าอาหาร 100 บาท' },
      ],
    }),
    botMsg('ค่าซื้อของสำหรับขาย ระบบดึงมาจากช่องของขายให้เองแล้ว ไม่ต้องพิมพ์ซ้ำที่นี่', {
      channel: 'money',
      tone: 'info',
    }),
    botMsg('พิมพ์ผิดหรือบันทึกซ้ำ กดไอคอนถังขยะข้างข้อความได้เลย ระบบจะถอนข้อมูลของข้อความนั้นออกจากสรุปให้ด้วย', {
      channel: 'money',
      tone: 'info',
    }),
  ]
}


/**
 * ข้อความสรุป "รายรับของขาย" ของทั้งวัน สำหรับส่งไปช่องรายรับ-รายจ่าย
 * รวมทุกเมนูที่ขายได้ในวันนั้น (จำนวนที่ขายได้ × ราคาต่อหน่วย) เป็นยอดเดียว
 *
 * ใช้ id คงที่ต่อหนึ่งวัน เพื่อให้แก้ยอดกี่รอบก็มีสรุปของวันนั้นอยู่ข้อความเดียว
 * ไม่ใช่กองข้อความซ้ำกันจนอ่านไม่รู้เรื่อง
 */
export function dailyIncomeMessageId(date: string): string {
  return `daily-income:${date}`
}

export function dailyIncomeMessage(core: CoreState, date: string): ChatMessage | null {
  const sold = core.sales.filter((s) => s.date === date && s.qty > 0)
  if (!sold.length) return null

  const total = sold.reduce((sum, s) => sum + s.revenue, 0)
  const details = sold.map((s) => ({
    label: s.recipeName,
    value: `${num(s.qty)} ${s.unit} × ${money(s.unitPrice)} = ${money(s.revenue)}`,
  }))
  details.push({ label: 'รวมรายรับของขาย', value: money(total) })
  details.push({ label: 'บันทึกแล้ว', value: 'นับเป็นรายรับในบัญชีให้แล้ว ไม่ต้องบันทึกซ้ำ' })

  return {
    id: dailyIncomeMessageId(date),
    channel: 'money',
    role: 'bot',
    at: new Date().toISOString(),
    tone: 'ok',
    text: `รายรับของขาย · ${dayLabel(date)}`,
    details,
  }
}

/* --------------------------------------------------------------------------
   ลบข้อความในแชท พร้อมถอนข้อมูลที่ข้อความนั้นสร้างไว้
   ทุกรายการที่เกิดจากแชทจะติด srcMsgId ของข้อความต้นทางไว้ ตรงนี้จึงตามเก็บได้ครบ
-------------------------------------------------------------------------- */

export interface DeleteResult {
  core: CoreState
  changed: boolean
  /** สรุปสั้นๆ ว่าถอนอะไรออกไปบ้าง ใช้ตอบกลับในแชท */
  removed: string[]
}

/** รายการที่จะถอนออก แยกตามชนิด */
interface Picked {
  sales: Sale[]
  wastes: Waste[]
  lots: Lot[]
  productions: Production[]
  purchases: Purchase[]
  transactions: Transaction[]
  assets: Asset[]
}

const NOTHING: Picked = {
  sales: [], wastes: [], lots: [], productions: [], purchases: [], transactions: [], assets: [],
}

/**
 * ถอนรายการที่เลือกออกจากระบบ พร้อมคืนค่าทุกอย่างที่รายการนั้นเคยเปลี่ยนไป
 * ใช้ร่วมกันทั้งตอนลบข้อความในแชท และตอนลบรายการจากหน้าบัญชี
 */
function removeRecords(core: CoreState, pick: Partial<Picked>): DeleteResult {
  const p: Picked = { ...NOTHING, ...pick }
  const removed: string[] = []
  let items = core.items
  let lots = core.lots

  /** คืนของกลับเข้าล็อตที่เคยถูกตัดไป ไม่ให้เกินจำนวนเดิมของล็อต */
  const giveBack = (lotIds: string[] | undefined, qty: number) => {
    if (!lotIds?.length) return
    let left = qty
    lots = lots.map((l) => {
      if (left <= 1e-9 || !lotIds.includes(l.id)) return l
      const room = l.qty - l.remaining
      const give = Math.min(room, left)
      left -= give
      return { ...l, remaining: l.remaining + give }
    })
  }

  // 1) การขาย — ของที่ขายไปกลับเข้าล็อตเดิม
  for (const s of p.sales) giveBack(s.lotIds, s.qty)
  if (p.sales.length) removed.push(`ยอดขาย ${num(p.sales.reduce((a, s) => a + s.revenue, 0))} บาท`)

  // 2) ของเสีย — คืนกลับเข้าล็อตเช่นกัน
  for (const w of p.wastes) giveBack(w.lotIds, w.qty)
  if (p.wastes.length) removed.push(`ของเสีย ${p.wastes.length} รายการ`)

  // 3) ล็อตที่ถูกลบ — ของยกมาต้องคืนจำนวนกลับล็อตต้นทางก่อนทิ้ง
  for (const l of p.lots) {
    if (!l.carriedOver || !l.fromLotId) continue
    // ใช้จำนวนล่าสุดหลังคืนของจากการขายแล้ว ไม่งั้นคืนกลับล็อตต้นทางไม่ครบ
    const now = lots.find((x) => x.id === l.id) ?? l
    giveBack([l.fromLotId], now.remaining)
  }
  if (p.lots.some((l) => l.carriedOver)) removed.push('ของยกมา')
  const goneLots = new Set(p.lots.map((l) => l.id))
  lots = lots.filter((l) => !goneLots.has(l.id))

  // 4) การผลิต — คืนวัตถุดิบที่ตัดไปกลับเข้าสต็อก
  if (p.productions.length) {
    const back = new Map<string, number>()
    for (const pr of p.productions) {
      for (const u of pr.used) back.set(u.itemId, (back.get(u.itemId) ?? 0) + u.qty)
    }
    items = items.map((i) => (back.has(i.id) ? { ...i, stock: i.stock + back.get(i.id)! } : i))
    removed.push(`การผลิต ${p.productions.map((pr) => `${pr.recipeName} ${num(pr.qty)} ${pr.unit}`).join(', ')}`)
  }

  // 5) การซื้อของ — ถอนของออกจากสต็อกและถอนต้นทุนออกจากค่าเฉลี่ย
  for (const pu of p.purchases) {
    items = items.map((i) => {
      if (i.id !== pu.itemId) return i
      const stock = i.stock - pu.qty
      const totalValue = i.stock * i.avgCost - pu.total
      return { ...i, stock, avgCost: stock > 1e-9 ? Math.max(0, totalValue / stock) : 0 }
    })
  }
  if (p.purchases.length) {
    removed.push(
      `ค่าซื้อของ ${num(p.purchases.reduce((a, x) => a + x.total, 0))} บาท (${p.purchases.map((x) => x.itemName).join(', ')})`,
    )
  }

  // 6) รายรับ-รายจ่ายและทรัพย์สิน
  if (p.transactions.length) {
    removed.push(p.transactions.map((t) => `${t.category} ${num(t.amount)} บาท`).join(', '))
  }
  if (p.assets.length) removed.push(`ทรัพย์สิน ${p.assets.map((a) => a.name).join(', ')}`)

  const goneIds = <T extends { id: string }>(list: T[]) => new Set(list.map((x) => x.id))
  const drop = <T extends { id: string }>(all: T[], picked: T[]) => {
    if (!picked.length) return all
    const ids = goneIds(picked)
    return all.filter((x) => !ids.has(x.id))
  }

  return {
    core: {
      ...core,
      items,
      lots,
      sales: drop(core.sales, p.sales),
      wastes: drop(core.wastes, p.wastes),
      productions: drop(core.productions, p.productions),
      purchases: drop(core.purchases, p.purchases),
      transactions: drop(core.transactions, p.transactions),
      assets: drop(core.assets, p.assets),
    },
    changed: Object.values(p).some((list) => list.length > 0),
    removed,
  }
}

export function deleteByMessage(core: CoreState, msgId: string): DeleteResult {
  const by = <T extends { srcMsgId?: string }>(list: T[]) => list.filter((x) => x.srcMsgId === msgId)
  return removeRecords(core, {
    sales: by(core.sales),
    wastes: by(core.wastes),
    lots: by(core.lots),
    productions: by(core.productions),
    purchases: by(core.purchases),
    transactions: by(core.transactions),
    assets: by(core.assets),
  })
}

/**
 * ลบรายการเดียวจากหน้าบัญชี — ใช้กับทั้งยอดขาย ค่าซื้อของ และรายการที่บันทึกเอง
 * ทางนี้ไม่ต้องพึ่งข้อความในแชท จึงลบรายการเก่าที่บันทึกไว้ก่อนหน้านี้ได้ด้วย
 */
export function deleteMoneyEntry(core: CoreState, source: 'sale' | 'purchase' | 'manual', refId: string): DeleteResult {
  if (source === 'sale') {
    const sale = core.sales.find((s) => s.id === refId)
    return sale ? removeRecords(core, { sales: [sale] }) : { core, changed: false, removed: [] }
  }

  if (source === 'purchase') {
    const purchase = core.purchases.find((p) => p.id === refId)
    return purchase ? removeRecords(core, { purchases: [purchase] }) : { core, changed: false, removed: [] }
  }

  const tx = core.transactions.find((t) => t.id === refId)
  if (!tx) return { core, changed: false, removed: [] }
  // รายจ่ายค่าซื้อทรัพย์สินมีทรัพย์สินผูกอยู่ ต้องหายไปพร้อมกัน ไม่งั้นมูลค่าค้างอยู่ข้างเดียว
  const assets = core.assets.filter((a) =>
    tx.srcMsgId ? a.srcMsgId === tx.srcMsgId : a.name === tx.detail && a.date === tx.date && a.amount === tx.amount,
  )
  return removeRecords(core, { transactions: [tx], assets })
}

/**
 * ลบยอดขายทั้งวัน — ใช้เมื่อผู้ใช้ลบข้อความสรุป "รายรับของขาย" ของวันนั้นทิ้ง
 * ของที่ขายไปกลับเข้าล็อตให้ครบ ส่วนการผลิตยังอยู่ (ทำไปแล้วจริง)
 */
export function deleteSalesOfDay(core: CoreState, date: string): DeleteResult {
  const sales = core.sales.filter((s) => s.date === date)
  return sales.length ? removeRecords(core, { sales }) : { core, changed: false, removed: [] }
}

/** ลบทรัพย์สิน พร้อมรายจ่ายที่คู่กัน — เงินออกกับมูลค่าที่ได้มาต้องหายไปพร้อมกัน */
export function deleteAsset(core: CoreState, id: string): DeleteResult {
  const asset = core.assets.find((a) => a.id === id)
  if (!asset) return { core, changed: false, removed: [] }
  const paired = core.transactions.filter((t) =>
    asset.srcMsgId
      ? t.srcMsgId === asset.srcMsgId && t.category === 'ซื้อทรัพย์สิน'
      : t.category === 'ซื้อทรัพย์สิน' && t.detail === asset.name && t.date === asset.date && t.amount === asset.amount,
  )
  return removeRecords(core, { assets: [asset], transactions: paired.slice(0, 1) })
}

/* --------------------------------------------------------------------------
   ตัวสั่งงานหลัก
-------------------------------------------------------------------------- */

export function runCommand(core: CoreState, cmd: ParsedCommand, date = today(), srcMsgId?: string): RunResult {
  switch (cmd.kind) {
    case 'purchase':
      return applyPurchase(core, cmd, date, srcMsgId)
    case 'recipe':
      return askRecipeConfirm(core, cmd)
    case 'produce':
      return applyProduce(core, cmd, date, srcMsgId)
    case 'sell':
      return applySell(core, cmd, date, srcMsgId)
    case 'carryover':
      return applyCarryover(core, cmd, date, srcMsgId)
    case 'waste':
      return applyWaste(core, cmd, date, srcMsgId)
    case 'adjust':
      return applyAdjust(core, cmd)
    case 'expense':
    case 'income':
      return applyMoney(core, cmd, date, srcMsgId)
    case 'asset':
      return applyAsset(core, cmd, date, srcMsgId)
    case 'confirm':
      return cmd.yes ? commitPendingRecipe(core) : cancelPendingRecipe(core)
    case 'stock':
      return { core, changed: false, messages: answerStock(core, cmd) }
    case 'cost':
      return { core, changed: false, messages: answerCost(core, cmd) }
    case 'help':
      return { core, changed: false, messages: helpMessages() }
    default:
      return {
        core,
        changed: false,
        messages: [
          botMsg(cmd.reason, {
            tone: 'error',
            actions: [],
          }),
          botMsg('พิมพ์ "ช่วย" เพื่อดูตัวอย่างคำสั่งทั้งหมด', { tone: 'info' }),
        ],
      }
  }
}
