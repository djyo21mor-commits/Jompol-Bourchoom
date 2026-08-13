import type { BaseUnit, Category } from '../types'
import { isKnownUnit, lookupUnit } from './units'

/* ===========================================================================
   ตัวแปลภาษาไทยจากช่องแชท -> คำสั่งที่ระบบเข้าใจ
   ออกแบบให้ "พิมพ์แบบที่พูด" ได้ เช่น
     ซื้อกล่อง p39 1 ลัง ลังละ 1000 กล่อง ราคารวม 1680 บาท
     ซื้อมะม่วง 3 กิโล ราคารวม 112 บาท
     ทำเค้กมะม่วง 20 กล่อง
     ขายเค้กมะม่วง 15 กล่อง กล่องละ 120
     เหลือเค้กมะม่วง 5 กล่อง
   ไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ทั้งหมด (ไม่แตะ state) จึงเทสต์ได้ง่าย
=========================================================================== */

/** ผลของการอ่านปริมาณ เช่น "3 กิโล" -> 3000 กรัม พร้อมข้อความส่วนที่เหลือ */
export interface QtyRead {
  /** ข้อความที่เหลือหลังตัดจำนวนกับหน่วยออกแล้ว */
  rest: string
  /** จำนวนในหน่วยฐาน */
  qty: number
  base: BaseUnit
  unitLabel: string
  /** ข้อความหน่วยที่ผู้ใช้พิมพ์มาจริง */
  rawUnit: string
}

export interface ParsedIngredient {
  name: string
  qty: number
  base: BaseUnit
  unitLabel: string
}

export type ParsedCommand =
  | {
      kind: 'purchase'
      name: string
      category: Category
      qty: number
      base: BaseUnit
      unitLabel: string
      total: number
      /** คำอธิบายวิธีคิด เช่น "1 ลัง × 1,000 กล่อง" */
      packNote?: string
      raw: string
    }
  | { kind: 'produce'; name: string; qty: number; unit: string; raw: string }
  | { kind: 'sell'; name: string; qty: number; unit: string; unitPrice?: number; raw: string }
  | { kind: 'carryover'; name: string; qty: number; unit: string; raw: string }
  | { kind: 'waste'; name: string; qty: number; unit: string; reason?: string; raw: string }
  | {
      kind: 'recipe'
      name: string
      yieldQty: number
      yieldUnit: string
      ingredients: ParsedIngredient[]
      raw: string
    }
  | { kind: 'adjust'; name: string; qty: number; base: BaseUnit; unitLabel: string; raw: string }
  | { kind: 'expense'; category: string; detail: string; amount: number; raw: string }
  | { kind: 'income'; category: string; detail: string; amount: number; raw: string }
  | {
      kind: 'asset'
      name: string
      /** เงินที่จ่ายไปทั้งหมด */
      amount: number
      /** ราคาต่อหน่วย ถ้าบอกมา */
      unitPrice?: number
      /** หน่วยของทรัพย์สิน เช่น บาท (ทอง) */
      unitLabel?: string
      raw: string
    }
  | { kind: 'confirm'; yes: boolean; raw: string }
  | { kind: 'stock'; name?: string; raw: string }
  | { kind: 'cost'; name: string; marginPct?: number; raw: string }
  | { kind: 'help'; raw: string }
  | { kind: 'unknown'; raw: string; reason: string }

/* --------------------------------------------------------------------------
   ทำความสะอาดข้อความก่อนอ่าน
-------------------------------------------------------------------------- */

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙'

export function normalizeText(input: string): string {
  let s = input ?? ''
  // เลขไทย -> เลขอารบิก
  s = s.replace(/[๐-๙]/g, (c) => String(THAI_DIGITS.indexOf(c)))
  // ตัดคอมมาคั่นหลักพันในตัวเลข: 1,680 -> 1680
  s = s.replace(/(\d),(?=\d{3}\b)/g, '$1')
  // สัญลักษณ์ที่ใช้แทน "บาท"
  s = s.replace(/฿/g, ' บาท ')
  // ยุบช่องว่างซ้ำ
  s = s.replace(/[\t ]+/g, ' ').replace(/ {2,}/g, ' ')
  return s.trim()
}

/** ตัวอักษรที่ประกอบเป็น "คำ" ได้ (ไทย + อังกฤษ + จุด) — ไม่รวมตัวเลข */
const W = '[\\u0E00-\\u0E7Fa-zA-Z.]'
const NUM = '\\d+(?:\\.\\d+)?'

/** ตัดข้อความที่ตรงกับ regex ออก แล้วคืนข้อความที่เหลือ + ผลการจับคู่ */
function cut(text: string, re: RegExp): { rest: string; m: RegExpMatchArray | null } {
  const m = text.match(re)
  if (!m || m.index === undefined) return { rest: text, m: null }
  const rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/ {2,}/g, ' ').trim()
  return { rest, m }
}

/** ตัดการจับคู่ "ตัวสุดท้าย" ออก (ใช้กับราคาที่มักอยู่ท้ายประโยค) */
function cutLast(text: string, reSource: string): { rest: string; m: RegExpMatchArray | null } {
  const re = new RegExp(reSource, 'g')
  let last: RegExpExecArray | null = null
  let cur: RegExpExecArray | null
  while ((cur = re.exec(text)) !== null) {
    last = cur
    if (cur.index === re.lastIndex) re.lastIndex++
  }
  if (!last) return { rest: text, m: null }
  const rest = (text.slice(0, last.index) + ' ' + text.slice(last.index + last[0].length))
    .replace(/ {2,}/g, ' ')
    .trim()
  return { rest, m: last }
}

/** เก็บกวาดชื่อของที่เหลือจากการตัด — ตัดคำเชื่อมและเครื่องหมายที่ไม่ต้องการ */
function cleanName(s: string): string {
  return s
    .replace(/^(?:ที่|ของ|เป็น|จำนวน|ทั้งหมด|มา|ไป|ได้|แล้ว|อีก|เพิ่ม)+\s*/g, '')
    .replace(/\s*(?:แล้ว|ครับ|ค่ะ|คะ|จ้า|นะ|น่ะ|ด้วย|เลย|อีก|จำนวน|มา|ไป)+$/g, '')
    .replace(/[,;:•\-–—]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/* --------------------------------------------------------------------------
   หมวดหมู่อัตโนมัติ
-------------------------------------------------------------------------- */

const CATEGORY_HINTS: { category: Category; words: string[] }[] = [
  {
    category: 'packaging',
    words: [
      'กล่อง', 'ถุง', 'ซอง', 'ฝา', 'ช้อน', 'ส้อม', 'สติกเกอร์', 'สติ๊กเกอร์', 'ริบบิ้น', 'โบว์',
      'ถ้วย', 'แก้ว', 'หลอด', 'ฟิล์ม', 'แรป', 'ตะกร้า', 'กระดาษรอง', 'กระดาษไข', 'พลาสติก',
      'บรรจุภัณฑ์', 'ถาด', 'เชือก', 'ป้าย', 'การ์ด', 'ที่รองเค้ก', 'ฐานเค้ก', 'ไม้เสียบ', 'คัพ',
    ],
  },
  {
    category: 'fresh',
    words: [
      'มะม่วง', 'สตรอ', 'บลูเบอร์รี', 'กล้วย', 'ส้ม', 'ทุเรียน', 'มะพร้าว', 'สับปะรด', 'แอปเปิ้ล',
      'องุ่น', 'เสาวรส', 'มะนาว', 'ลิ้นจี่', 'ลำไย', 'แตงโม', 'เมล่อน', 'ผลไม้', 'ผัก', 'ใบเตย',
      'นม', 'ไข่', 'เนย', 'ครีม', 'ชีส', 'วิปครีม', 'โยเกิร์ต', 'ชีสครีม', 'มาสคาโปเน่',
      'เนื้อ', 'หมู', 'ไก่', 'กุ้ง', 'ปู', 'แฮม', 'ไส้กรอก', 'สด',
    ],
  },
  {
    category: 'dry',
    words: [
      'แป้ง', 'น้ำตาล', 'เกลือ', 'ยีสต์', 'ผงฟู', 'เบกกิ้ง', 'โกโก้', 'กาแฟ', 'ชา', 'ผงชา',
      'ถั่ว', 'งา', 'วานิลลา', 'เจลาติน', 'ผงวุ้น', 'ครีมออฟทาร์ทาร์', 'ช็อกโกแลต', 'ช็อคโกแลต',
      'นมข้น', 'กะทิ', 'น้ำมัน', 'สี', 'กลิ่น', 'ลูกเกด', 'ผลไม้อบแห้ง', 'มอลต์', 'ข้าว', 'ผง',
    ],
  },
]

export function guessCategory(name: string): Category {
  const n = name.toLowerCase()
  for (const hint of CATEGORY_HINTS) {
    if (hint.words.some((w) => n.includes(w))) return hint.category
  }
  return 'other'
}

/* --------------------------------------------------------------------------
   อ่านปริมาณ "<จำนวน> <หน่วย>" จากข้อความ
-------------------------------------------------------------------------- */

/**
 * ตัวเลขที่ "ติดกับตัวอักษร" เช่น 39 ใน "p39" เป็นส่วนหนึ่งของชื่อสินค้า ไม่ใช่จำนวน
 * lookbehind นี้จึงกันไม่ให้อ่านเลขพวกนั้นผิดเป็นปริมาณ
 */
const NOT_IN_WORD = '(?<![\\u0E00-\\u0E7Fa-zA-Z])'

function sliceOut(text: string, index: number, length: number): string {
  return (text.slice(0, index) + ' ' + text.slice(index + length)).replace(/ {2,}/g, ' ').trim()
}

/**
 * หา "<จำนวน> <หน่วย>" คู่แรกที่หน่วยเป็นหน่วยที่รู้จัก
 * ระบุ onlyUnit เพื่อบังคับให้จับเฉพาะหน่วยนั้น (ใช้ตอนรู้แล้วว่าซื้อยกลัง)
 */
function readQty(text: string, onlyUnit?: string): QtyRead | null {
  const re = new RegExp(`${NOT_IN_WORD}(${NUM})\\s*(${W}+)`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const def = lookupUnit(m[2])
    if (!def) continue
    if (onlyUnit && m[2] !== onlyUnit && def !== lookupUnit(onlyUnit)) continue
    return {
      rest: sliceOut(text, m.index, m[0].length),
      qty: parseFloat(m[1]) * def.factor,
      base: def.base,
      unitLabel: def.label,
      rawUnit: m[2],
    }
  }
  return null
}

/** หาตัวเลขโดดๆ ตัวแรกในข้อความ (ใช้ตอนไม่ระบุหน่วย เช่น "ทำเค้กมะม่วง 20") */
function readBareNumber(text: string): { rest: string; value: number } | null {
  const m = text.match(new RegExp(`${NOT_IN_WORD}(${NUM})`))
  if (!m || m.index === undefined) return null
  return { rest: sliceOut(text, m.index, m[0].length), value: parseFloat(m[1]) }
}

/**
 * อ่าน "จำนวน + หน่วยนับขนม" จากคำสั่ง ทำ/ขาย/เหลือ/ทิ้ง
 * คืนหน่วยตามที่พิมพ์ (กล่อง/ชิ้น/ถุง) เพราะขนมสำเร็จรูปนับเป็นชิ้นเสมอ
 */
function readCountQty(text: string, fallbackUnit = 'กล่อง'): { rest: string; qty: number; unit: string } | null {
  const re = new RegExp(`${NOT_IN_WORD}(${NUM})\\s*(${W}+)?`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const unitRaw = (m[2] ?? '').trim()
    const def = unitRaw ? lookupUnit(unitRaw) : null
    // หน่วยชั่ง/ตวง ไม่ใช่หน่วยนับขนมสำเร็จรูป จึงข้ามไป
    if (unitRaw && def && def.base !== 'pcs') continue
    // หน่วยที่ไม่รู้จักถือเป็นส่วนหนึ่งของชื่อ จึงตัดออกแค่ตัวเลข
    const consumed = def ? m[0].length : m[1].length
    return {
      rest: sliceOut(text, m.index, consumed),
      qty: parseFloat(m[1]) * (def?.factor ?? 1),
      unit: def?.label ?? fallbackUnit,
    }
  }
  return null
}

/* --------------------------------------------------------------------------
   คำนำหน้าบอกเจตนา
-------------------------------------------------------------------------- */

const INTENTS: { kind: string; re: RegExp }[] = [
  { kind: 'help', re: /^(?:ช่วย(?:เหลือ)?$|help$|วิธีใช้|ใช้ยังไง|\?$|คำสั่ง$)/i },
  { kind: 'recipe', re: /^(?:สูตร|ตั้งสูตร|เพิ่มสูตร|เมนูใหม่|สร้างเมนู)/ },
  { kind: 'cost', re: /^(?:ต้นทุน|ทุน|คิดราคา|ตั้งราคา|ราคาขาย|คำนวณราคา|ขายเท่าไหร่|ขายเท่าไร)/ },
  { kind: 'stock', re: /^(?:สต็อก|สต๊อก|สตอก|stock|เช็ค|ดูของ|ของเหลือเท่าไหร่|คงเหลือ|มีอะไรบ้าง)/i },
  { kind: 'asset', re: /^(?:ซื้อทรัพย์สิน|บันทึกทรัพย์สิน|ทรัพย์สิน)\s*/ },
  { kind: 'purchase', re: /^(?:ซื้อ|ซิ้อ|สั่งซื้อ|รับของ|เติมของ|เติม|ลงของ)/ },
  // "จ่าย…" คือค่าใช้จ่ายที่ไม่เข้าสต็อก ส่วน "ซื้อ…" คือของที่เข้าสต็อก
  // ข้อความที่ขึ้นต้นด้วย "ค่า" ตรงๆ (ค่าเช่าร้าน 5000) จับด้วย lookahead เพื่อไม่ให้ตัดคำว่า "ค่า" ทิ้ง
  { kind: 'expense', re: /^(?:จ่ายเงิน|จ่าย)(?=ค่า)|^(?:จ่ายเงิน|จ่าย)\s*|^(?=ค่า)/ },
  { kind: 'income', re: /^(?:รับเงินจาก|รับเงิน|ได้เงินจาก|ได้เงิน|เงินเข้า|รายรับ|รายได้)\s*/ },
  { kind: 'produce', re: /^(?:ทำ|ทํา|ผลิต|อบ|ได้ขนม|ทำขนม)/ },
  { kind: 'sell', re: /^(?:ขายได้|ขาย|จำหน่าย|ส่งลูกค้า)/ },
  { kind: 'carryover', re: /^(?:เหลือ|ของเหลือ|ค้าง|ยกมา|ยกไป|เก็บไว้ขาย|ขายต่อ)/ },
  { kind: 'waste', re: /^(?:ทิ้ง|เสีย|ของเสีย|หมดอายุ|เท|บูด|ขึ้นรา)/ },
  { kind: 'adjust', re: /^(?:ปรับสต็อก|แก้สต็อก|นับสต็อก|ตั้งสต็อก)/ },
]

function detectIntent(text: string): { kind: string; rest: string } | null {
  for (const it of INTENTS) {
    const m = text.match(it.re)
    if (m) return { kind: it.kind, rest: text.slice(m[0].length).trim() }
  }
  return null
}

/* --------------------------------------------------------------------------
   ตัวอ่านหลักของแต่ละเจตนา
-------------------------------------------------------------------------- */

function parsePurchase(body: string, raw: string): ParsedCommand {
  let s = body

  // 1) "<หน่วย>ละ <จำนวน> บาท" -> ราคาต่อหน่วย
  let pricePerUnit: { unit: string; price: number } | null = null
  {
    const r = cut(s, new RegExp(`(${W}+?)\\s*ละ\\s*(${NUM})\\s*บาท`))
    if (r.m) {
      pricePerUnit = { unit: r.m[1], price: parseFloat(r.m[2]) }
      s = r.rest
    }
  }

  // 2) "<หน่วยนอก>ละ <จำนวน> <หน่วยใน>" -> ขนาดบรรจุ เช่น ลังละ 1000 กล่อง
  let pack: { outer: string; innerQty: number; innerUnit: string } | null = null
  {
    const r = cut(s, new RegExp(`(${W}+?)\\s*ละ\\s*(${NUM})\\s*(${W}+)`))
    if (r.m && isKnownUnit(r.m[3])) {
      pack = { outer: r.m[1], innerQty: parseFloat(r.m[2]), innerUnit: r.m[3] }
      s = r.rest
    }
  }

  // 3) "<หน่วย>ละ <จำนวน>" (ไม่มีคำว่าบาทต่อท้าย) -> ราคาต่อหน่วย
  if (!pricePerUnit && !pack) {
    const r = cut(s, new RegExp(`(${W}+?)\\s*ละ\\s*(${NUM})`))
    if (r.m) {
      pricePerUnit = { unit: r.m[1], price: parseFloat(r.m[2]) }
      s = r.rest
    }
  }

  // 4) ราคารวม
  let total: number | null = null
  for (const src of [
    `(?:ราคารวม|รวมราคา|ราคาทั้งหมด|ราคา|เป็นเงิน|จ่ายไป|จ่าย|คิดเงิน|เสียเงิน)\\s*(${NUM})\\s*(?:บาท)?`,
    `(?:รวม|ทั้งหมด|ทั้งสิ้น)\\s*(${NUM})\\s*บาท`,
    `(${NUM})\\s*บาท`,
  ]) {
    const r = cutLast(s, src)
    if (r.m) {
      total = parseFloat(r.m[1])
      s = r.rest
      break
    }
  }

  // 5) จำนวนที่ซื้อ
  let qtyBase: number
  let base: BaseUnit
  let unitLabel: string
  let packNote: string | undefined
  let outerCount = 1

  if (pack) {
    const innerDef = lookupUnit(pack.innerUnit)!
    // จำนวนลัง/แพ็คที่ซื้อ — เอาหน่วยที่ตรงกับหน่วยบรรจุก่อน แล้วค่อยลดหลั่นลงมา
    const outer = readQty(s, pack.outer) ?? readQty(s)
    if (outer) {
      const outerDef = lookupUnit(outer.rawUnit)
      outerCount = outerDef ? outer.qty / outerDef.factor : outer.qty
      s = outer.rest
    } else {
      const b = readBareNumber(s)
      if (b) {
        outerCount = b.value
        s = b.rest
      }
    }
    qtyBase = outerCount * pack.innerQty * innerDef.factor
    base = innerDef.base
    unitLabel = innerDef.label
    packNote = `${fmtPlain(outerCount)} ${pack.outer} × ${fmtPlain(pack.innerQty)} ${innerDef.label}`
  } else if (readQty(s)) {
    const q = readQty(s)!
    qtyBase = q.qty
    base = q.base
    unitLabel = q.unitLabel
    s = q.rest
  } else {
    const b = readBareNumber(s)
    if (!b) {
      return { kind: 'unknown', raw, reason: 'ไม่เจอจำนวนที่ซื้อ — ลองพิมพ์เช่น "ซื้อมะม่วง 3 กิโล 112 บาท"' }
    }
    qtyBase = b.value
    base = 'pcs'
    unitLabel = 'ชิ้น'
    s = b.rest
  }

  // 6) แปลงราคาต่อหน่วย -> ราคารวม
  if (total === null && pricePerUnit) {
    const def = lookupUnit(pricePerUnit.unit)
    if (def && def.base === base) {
      total = (qtyBase / def.factor) * pricePerUnit.price
    } else if (pack && (pricePerUnit.unit === pack.outer || def?.base === 'pcs')) {
      total = outerCount * pricePerUnit.price
    } else {
      total = (qtyBase / (lookupUnit(unitLabel)?.factor ?? 1)) * pricePerUnit.price
    }
  }

  const name = cleanName(s)
  if (!name) {
    return { kind: 'unknown', raw, reason: 'ไม่เจอชื่อของที่ซื้อ — ลองพิมพ์เช่น "ซื้อมะม่วง 3 กิโล 112 บาท"' }
  }
  if (total === null) {
    return {
      kind: 'unknown',
      raw,
      reason: `ไม่เจอราคาของ "${name}" — เติมราคาต่อท้าย เช่น "${name} ${fmtPlain(qtyBase)} ${unitLabel} 100 บาท"`,
    }
  }
  if (qtyBase <= 0) {
    return { kind: 'unknown', raw, reason: 'จำนวนต้องมากกว่า 0' }
  }

  return {
    kind: 'purchase',
    name,
    category: guessCategory(name),
    qty: qtyBase,
    base,
    unitLabel,
    total,
    packNote,
    raw,
  }
}

function parseCountCommand(
  kind: 'produce' | 'sell' | 'carryover' | 'waste',
  body: string,
  raw: string,
): ParsedCommand {
  let s = body
  let unitPrice: number | undefined

  if (kind === 'sell') {
    // "กล่องละ 120 บาท" หรือ "ราคา 120"
    const r = cut(s, new RegExp(`(${W}+?)\\s*ละ\\s*(${NUM})\\s*(?:บาท)?`))
    if (r.m) {
      unitPrice = parseFloat(r.m[2])
      s = r.rest
    } else {
      const r2 = cutLast(s, `(?:ราคา|ขายที่|ที่ราคา|อันละ|ชิ้นละ)\\s*(${NUM})\\s*(?:บาท)?`)
      if (r2.m) {
        unitPrice = parseFloat(r2.m[1])
        s = r2.rest
      }
    }
  }

  let reason: string | undefined
  if (kind === 'waste') {
    const r = cut(s, /(?:เพราะ|เนื่องจาก|สาเหตุ)\s*(.+)$/)
    if (r.m) {
      reason = r.m[1].trim()
      s = r.rest
    }
  }

  const q = readCountQty(s)
  if (!q) {
    const verb = { produce: 'ทำ', sell: 'ขาย', carryover: 'เหลือ', waste: 'ทิ้ง' }[kind]
    return { kind: 'unknown', raw, reason: `ไม่เจอจำนวน — ลองพิมพ์เช่น "${verb}เค้กมะม่วง 20 กล่อง"` }
  }

  const name = cleanName(q.rest)
  if (!name) {
    return { kind: 'unknown', raw, reason: 'ไม่เจอชื่อเมนู — พิมพ์ชื่อเมนูต่อจากคำสั่งได้เลย' }
  }
  if (q.qty <= 0) return { kind: 'unknown', raw, reason: 'จำนวนต้องมากกว่า 0' }

  if (kind === 'sell') return { kind, name, qty: q.qty, unit: q.unit, unitPrice, raw }
  if (kind === 'waste') return { kind, name, qty: q.qty, unit: q.unit, reason, raw }
  return { kind, name, qty: q.qty, unit: q.unit, raw }
}

function parseRecipe(body: string, raw: string): ParsedCommand {
  // แยกส่วนหัว (ชื่อ + จำนวนที่ได้) ออกจากรายการวัตถุดิบ
  const splitAt = body.search(/(?:ใช้|ส่วนผสม|วัตถุดิบ|ประกอบด้วย)\s*/)
  if (splitAt < 0) {
    return {
      kind: 'unknown',
      raw,
      reason: 'บอกส่วนผสมด้วยคำว่า "ใช้" เช่น "สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม, แป้ง 500 กรัม"',
    }
  }
  const head = body.slice(0, splitAt).trim()
  const tail = body.slice(splitAt).replace(/^(?:ใช้|ส่วนผสม|วัตถุดิบ|ประกอบด้วย)\s*/, '').trim()

  let name = head
  let yieldQty = 1
  let yieldUnit = 'กล่อง'
  const yr = cut(head, new RegExp(`(?:ได้|ทำได้|จำนวน|ต่อ)\\s*(${NUM})\\s*(${W}+)?`))
  if (yr.m) {
    yieldQty = parseFloat(yr.m[1])
    const def = yr.m[2] ? lookupUnit(yr.m[2]) : null
    if (def && def.base === 'pcs') yieldUnit = def.label
    name = yr.rest
  }
  name = cleanName(name)
  if (!name) return { kind: 'unknown', raw, reason: 'ไม่เจอชื่อเมนู' }

  const ingredients: ParsedIngredient[] = []
  for (const part of tail.split(/[,;+\n]|\sและ\s|\sกับ\s/)) {
    const chunk = part.trim()
    if (!chunk) continue
    const q = readQty(chunk)
    if (!q) continue
    const ingName = cleanName(q.rest)
    if (!ingName) continue
    ingredients.push({ name: ingName, qty: q.qty, base: q.base, unitLabel: q.unitLabel })
    // หมายเหตุ: หน่วยนับที่ผู้ใช้พิมพ์ (กล่อง/ฟอง) ถูกเก็บไว้ใช้ตอนจับคู่กับวัตถุดิบจริง
  }

  if (!ingredients.length) {
    return { kind: 'unknown', raw, reason: 'ไม่เจอส่วนผสม — เขียนเป็น "มะม่วง 1500 กรัม, แป้ง 500 กรัม"' }
  }
  return { kind: 'recipe', name, yieldQty: yieldQty > 0 ? yieldQty : 1, yieldUnit, ingredients, raw }
}

function parseAdjust(body: string, raw: string): ParsedCommand {
  const q = readQty(body)
  if (!q) return { kind: 'unknown', raw, reason: 'ลองพิมพ์เช่น "ปรับสต็อกมะม่วง 800 กรัม"' }
  const name = cleanName(q.rest)
  if (!name) return { kind: 'unknown', raw, reason: 'ไม่เจอชื่อวัตถุดิบ' }
  return { kind: 'adjust', name, qty: q.qty, base: q.base, unitLabel: q.unitLabel, raw }
}

/**
 * อ่านรายรับ/รายจ่ายที่ไม่เกี่ยวกับสต็อก เช่น
 *   จ่ายค่าเช่าร้าน 5000 บาท
 *   ค่าไฟ 1200
 *   รับเงินค่าจ้างทำเค้ก 800 บาท
 * ข้อความที่เหลือหลังตัดจำนวนเงินออก จะกลายเป็นชื่อหมวดหมู่
 */
function parseMoney(kind: 'expense' | 'income', body: string, raw: string): ParsedCommand {
  let s = body
  let amount: number | null = null

  for (const src of [
    `(?:จำนวน|เป็นเงิน|รวม|ทั้งหมด|ราคา)\\s*(${NUM})\\s*(?:บาท)?`,
    `(${NUM})\\s*บาท`,
    `(${NUM})`,
  ]) {
    const r = cutLast(s, src)
    if (r.m) {
      amount = parseFloat(r.m[1])
      s = r.rest
      break
    }
  }

  const verb = kind === 'expense' ? 'จ่ายค่าเช่าร้าน 5000 บาท' : 'รับเงินค่าจ้างทำเค้ก 800 บาท'
  if (amount === null) {
    return { kind: 'unknown', raw, reason: `ไม่เจอจำนวนเงิน — ลองพิมพ์เช่น "${verb}"` }
  }
  if (amount <= 0) return { kind: 'unknown', raw, reason: 'จำนวนเงินต้องมากกว่า 0' }

  // แยกหมายเหตุที่คั่นด้วยเครื่องหมายหรือคำว่า "หมายเหตุ"
  let detail = ''
  const noteCut = cut(s, /(?:\s[-–—]\s|หมายเหตุ|สำหรับ|เพราะ)\s*(.+)$/)
  if (noteCut.m) {
    detail = noteCut.m[1].trim()
    s = noteCut.rest
  }

  const category = cleanName(s.replace(/^(?:ค่าใช้จ่าย|รายจ่าย|รายรับ|รายได้)\s*/, ''))
  if (!category) {
    return { kind: 'unknown', raw, reason: `ไม่เจอว่าเป็นค่าอะไร — ลองพิมพ์เช่น "${verb}"` }
  }
  return { kind, category, detail, amount, raw }
}

/**
 * อ่านการซื้อทรัพย์สิน เช่น
 *   ซื้อทองคำ จำนวน 10000 บาท ที่ราคาบาทละ 65000 บาท
 * "จำนวน 10000 บาท" = เงินที่จ่ายไป · "บาทละ 65000" = ราคาต่อหน่วย
 * ปริมาณที่ได้ = เงินที่จ่าย ÷ ราคาต่อหน่วย
 */
function parseAsset(body: string, raw: string): ParsedCommand {
  let s = body

  // ราคาต่อหน่วย "<หน่วย>ละ <จำนวน>"
  let unitPrice: number | undefined
  let unitLabel: string | undefined
  {
    const r = cut(s, new RegExp(`(${W}+?)\\s*ละ\\s*(${NUM})\\s*(?:บาท)?`))
    if (r.m) {
      // regex จับตั้งแต่ต้นข้อความ จึงอาจติดคำนำหน้ามาด้วย เช่น "ที่ราคาบาท" — ตัดออกให้เหลือแค่หน่วย
      unitLabel = r.m[1].replace(/^(?:ที่|ใน|ราคา|อัตรา)+/g, '').trim() || undefined
      unitPrice = parseFloat(r.m[2])
      s = r.rest
    }
  }

  // เงินที่จ่าย
  let amount: number | null = null
  for (const src of [
    `(?:จำนวน|เป็นเงิน|เป็นจำนวน|รวม|ทั้งหมด|มูลค่า)\\s*(${NUM})\\s*(?:บาท)?`,
    `(${NUM})\\s*บาท`,
    `(${NUM})`,
  ]) {
    const r = cutLast(s, src)
    if (r.m) {
      amount = parseFloat(r.m[1])
      s = r.rest
      break
    }
  }

  if (amount === null || amount <= 0) {
    return {
      kind: 'unknown',
      raw,
      reason: 'ไม่เจอจำนวนเงิน — ลองพิมพ์เช่น "ซื้อทองคำ จำนวน 10000 บาท ที่ราคาบาทละ 65000 บาท"',
    }
  }

  const name = cleanName(s.replace(/^(?:ทรัพย์สิน|สินทรัพย์)\s*/, ''))
  if (!name) return { kind: 'unknown', raw, reason: 'ไม่เจอชื่อทรัพย์สิน' }

  return { kind: 'asset', name, amount, unitPrice, unitLabel, raw }
}

/** คำตอบรับ/ปฏิเสธสั้นๆ ตอนบอทถามยืนยัน */
function parseConfirm(text: string): ParsedCommand | null {
  if (/^(?:ใช่|ถูก(?:ต้อง)?(?:แล้ว)?|ตกลง|โอเค|ok|yes|y|ยืนยัน|บันทึกเลย|เอาเลย|ได้)\s*[!.]*$/i.test(text)) {
    return { kind: 'confirm', yes: true, raw: text }
  }
  if (/^(?:ไม่(?:ใช่|ถูก)?|ยกเลิก|แก้|ผิด|no|n|cancel)\s*[!.]*$/i.test(text)) {
    return { kind: 'confirm', yes: false, raw: text }
  }
  return null
}

/**
 * คำสั่งสั้นในช่องรายรับ-รายจ่าย: "<หมวด> <จำนวน>" หรือ "<จำนวน> <หมวด>"
 * เช่น "ลูก 100" = รายจ่ายหมวดลูก 100 บาท
 * ใช้เฉพาะช่องเงิน เพราะในช่องของขาย "มะม่วง 3" อาจหมายถึงจำนวนของ ไม่ใช่เงิน
 */
function parseShortMoney(text: string, raw: string): ParsedCommand | null {
  // ขึ้นต้นด้วย + หมายถึงเงินเข้า
  const income = /^\+\s*/.test(text)
  const body = text.replace(/^\+\s*/, '').trim()

  let m = body.match(new RegExp(`^(${W}[\\u0E00-\\u0E7Fa-zA-Z0-9 .]*?)\\s+(${NUM})\\s*(?:บาท)?$`))
  if (!m) {
    const flipped = body.match(new RegExp(`^(${NUM})\\s*(?:บาท)?\\s+(${W}[\\u0E00-\\u0E7Fa-zA-Z0-9 .]*)$`))
    if (flipped) m = [flipped[0], flipped[2], flipped[1]] as unknown as RegExpMatchArray
  }
  if (!m) return null

  const category = cleanName(m[1])
  const amount = parseFloat(m[2])
  if (!category || !(amount > 0)) return null

  return { kind: income ? 'income' : 'expense', category, detail: '', amount, raw }
}

function parseCost(body: string, raw: string): ParsedCommand {
  let s = body
  let marginPct: number | undefined
  const r = cut(s, new RegExp(`(?:กำไร|บวก|เอา|ขอ)?\\s*(${NUM})\\s*(?:%|เปอร์เซ็น(?:ต์)?|เปอร์เซนต์)`))
  if (r.m) {
    marginPct = parseFloat(r.m[1])
    s = r.rest
  }
  const name = cleanName(s.replace(/^(?:ของ|เมนู)\s*/, ''))
  if (!name) return { kind: 'unknown', raw, reason: 'บอกชื่อเมนูด้วย เช่น "ต้นทุนเค้กมะม่วง กำไร 40%"' }
  return { kind: 'cost', name, marginPct, raw }
}

/* --------------------------------------------------------------------------
   จุดเข้าใช้งาน
-------------------------------------------------------------------------- */

/** ช่องแชทที่กำลังพิมพ์อยู่ — มีผลกับการเดาความหมายของข้อความสั้นๆ */
export type ParseChannel = 'shop' | 'money'

/** อ่านคำสั่งเดียว (1 บรรทัด) */
export function parseLine(input: string, channel: ParseChannel = 'shop'): ParsedCommand {
  const raw = input.trim()
  const text = normalizeText(raw)
  if (!text) return { kind: 'unknown', raw, reason: 'ข้อความว่าง' }

  // คำตอบยืนยันสั้นๆ ต้องดูก่อนอย่างอื่น ไม่งั้น "ใช่" จะไปโดนกฎอื่นจับ
  const confirm = parseConfirm(text)
  if (confirm) return confirm

  const intent = detectIntent(text)
  if (!intent) {
    if (channel === 'money') {
      // ช่องเงิน: "ลูก 100" = รายจ่ายหมวดลูก 100 บาท
      const short = parseShortMoney(text, raw)
      if (short) return short
      return {
        kind: 'unknown',
        raw,
        reason: 'ยังไม่เข้าใจข้อความนี้ — พิมพ์สั้นๆ ได้เลย เช่น "ลูก 100" หรือ "+ ขายของ 500" สำหรับเงินเข้า',
      }
    }
    // ช่องของขาย: ไม่มีคำนำหน้า แต่ถ้ามีราคา + จำนวน ก็เดาว่าเป็นการซื้อของ
    if (/บาท/.test(text) && /\d/.test(text)) return parsePurchase(text, raw)
    return {
      kind: 'unknown',
      raw,
      reason: 'ยังไม่เข้าใจข้อความนี้ — ขึ้นต้นด้วย ซื้อ / ทำ / ขาย / เหลือ / ทิ้ง / สูตร / ต้นทุน แล้วพิมพ์ต่อได้เลย',
    }
  }

  switch (intent.kind) {
    case 'help':
      return { kind: 'help', raw }
    case 'purchase':
      // ช่องเงินไม่มีสต็อก — "ซื้อทองคำ จำนวน 10000 บาท ที่ราคาบาทละ 65000" คือการซื้อทรัพย์สิน
      return channel === 'money' ? parseAsset(intent.rest, raw) : parsePurchase(intent.rest, raw)
    case 'produce':
    case 'sell':
    case 'carryover':
    case 'waste':
      return parseCountCommand(intent.kind, intent.rest, raw)
    case 'recipe':
      return parseRecipe(intent.rest, raw)
    case 'adjust':
      return parseAdjust(intent.rest, raw)
    case 'expense':
    case 'income':
      return parseMoney(intent.kind, intent.rest, raw)
    case 'asset':
      return parseAsset(intent.rest, raw)
    case 'cost':
      return parseCost(intent.rest, raw)
    case 'stock': {
      const name = cleanName(intent.rest.replace(/^(?:สต็อก|สต๊อก|ของ|ดู)\s*/, ''))
      return { kind: 'stock', name: name || undefined, raw }
    }
    default:
      return { kind: 'unknown', raw, reason: 'ยังไม่รองรับคำสั่งนี้' }
  }
}

/**
 * อ่านหลายคำสั่งพร้อมกัน — แยกตามบรรทัด
 * บรรทัดที่ไม่ได้ขึ้นต้นด้วยคำสั่ง จะสืบทอดคำสั่งจากบรรทัดก่อนหน้า
 * เช่น  "ซื้อมะม่วง 3 กิโล 112 บาท\nแป้งเค้ก 1 กก. 45 บาท"
 */
export function parseScript(input: string, channel: ParseChannel = 'shop'): ParsedCommand[] {
  const text = normalizeText(input)
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length <= 1) return [parseLine(input, channel)]

  const out: ParsedCommand[] = []
  let lastVerb = ''
  for (const line of lines) {
    const bullet = line.replace(/^(?:[-•*]|\d+[.)])\s*/, '')
    const intent = detectIntent(bullet)
    if (intent) {
      lastVerb = bullet.slice(0, bullet.length - intent.rest.length).trim()
      out.push(parseLine(bullet, channel))
    } else if (lastVerb) {
      out.push(parseLine(`${lastVerb}${bullet}`, channel))
    } else {
      out.push(parseLine(bullet, channel))
    }
  }
  return out
}

/** ตัวเลขแบบสั้นสำหรับข้อความในแชท */
function fmtPlain(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('th-TH') : String(Math.round(n * 100) / 100)
}
