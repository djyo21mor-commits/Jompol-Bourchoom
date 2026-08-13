/** หน่วยฐานที่ระบบใช้เก็บสต็อกจริง — ทุกอย่างถูกแปลงมาเป็นหน่วยเหล่านี้ */
export type BaseUnit = 'g' | 'ml' | 'pcs'

/** หมวดหมู่ของวัตถุดิบ/ของใช้ */
export type Category = 'fresh' | 'dry' | 'packaging' | 'other'

export const CATEGORY_LABEL: Record<Category, string> = {
  fresh: 'ของสด',
  dry: 'ของแห้ง',
  packaging: 'บรรจุภัณฑ์',
  other: 'อื่นๆ',
}

/** วัตถุดิบหรือบรรจุภัณฑ์ 1 รายการ */
export interface Item {
  id: string
  name: string
  category: Category
  base: BaseUnit
  /** ชื่อหน่วยที่ใช้เรียกของชิ้นนี้ เช่น "กล่อง" "ฟอง" — ใช้กับ base = 'pcs' */
  unitLabel: string
  /** จำนวนคงเหลือ ในหน่วยฐาน */
  stock: number
  /** ต้นทุนเฉลี่ยต่อหน่วยฐาน (บาท) — คิดแบบถัวเฉลี่ยเคลื่อนที่ */
  avgCost: number
  /** ต้นทุนต่อหน่วยฐานจากการซื้อครั้งล่าสุด */
  lastCost: number
  /** แจ้งเตือนเมื่อสต็อกต่ำกว่านี้ (หน่วยฐาน) — 0 หรือไม่ระบุ = ไม่เตือน */
  lowStock?: number
  createdAt: string
}

/** การซื้อของเข้าร้าน 1 ครั้ง */
export interface Purchase {
  id: string
  date: string // YYYY-MM-DD
  itemId: string
  itemName: string
  /** จำนวนที่ซื้อ ในหน่วยฐาน */
  qty: number
  /** ราคารวมที่จ่าย (บาท) */
  total: number
  /** ต้นทุนต่อหน่วยฐานของครั้งนี้ */
  unitCost: number
  /** ข้อความที่พิมพ์เข้ามาตอนบันทึก (ถ้ามาจากแชท) */
  note?: string
  createdAt: string
}

/** วัตถุดิบ 1 บรรทัดในสูตร */
export interface RecipeLine {
  itemId: string
  /** ปริมาณที่ใช้ต่อ 1 รอบผลิต ในหน่วยฐานของวัตถุดิบนั้น */
  qty: number
}

/** ค่าใช้จ่ายอื่นนอกจากวัตถุดิบ ต่อ 1 รอบผลิต */
export interface Overhead {
  labor: number
  water: number
  electric: number
  misc: number
}

export const EMPTY_OVERHEAD: Overhead = { labor: 0, water: 0, electric: 0, misc: 0 }

export const OVERHEAD_LABEL: Record<keyof Overhead, string> = {
  labor: 'ค่าแรง',
  water: 'ค่าน้ำ',
  electric: 'ค่าไฟ',
  misc: 'ค่าจิปาถะ',
}

/** สูตรขนม 1 เมนู */
export interface Recipe {
  id: string
  name: string
  /** ทำ 1 รอบได้กี่หน่วย */
  yieldQty: number
  /** หน่วยของขนมที่ได้ เช่น "กล่อง" "ชิ้น" */
  yieldUnit: string
  lines: RecipeLine[]
  /** ค่าใช้จ่ายอื่นต่อ 1 รอบผลิต */
  overhead: Overhead
  /** เปอร์เซ็นต์กำไรที่อยากได้ (บวกจากทุน) */
  marginPct: number
  /** ราคาขายที่ตั้งไว้ต่อ 1 หน่วย */
  price: number
  createdAt: string
}

/** การผลิต 1 ครั้ง */
export interface Production {
  id: string
  date: string
  recipeId: string
  recipeName: string
  /** จำนวนที่ผลิตได้ */
  qty: number
  unit: string
  /** วัตถุดิบที่ถูกตัดออกจากสต็อกจริง */
  used: { itemId: string; itemName: string; qty: number; base: BaseUnit; unitLabel: string; cost: number }[]
  materialCost: number
  overhead: Overhead
  overheadCost: number
  totalCost: number
  costPerUnit: number
  createdAt: string
}

/** ล็อตขนมที่พร้อมขาย */
export interface Lot {
  id: string
  recipeId: string
  recipeName: string
  unit: string
  /** วันที่ผลิต หรือวันที่รับยกมา */
  date: string
  /** วันที่พร้อมขาย — ของยกมาจะเป็นวันถัดไป */
  sellDate: string
  qty: number
  remaining: number
  /** ต้นทุนต่อหน่วยของล็อตนี้ (ของยกมาจากเมื่อวาน = 0 เพราะคิดทุนไปแล้ววันที่ผลิต) */
  costPerUnit: number
  /** ต้นทุนเดิมก่อนยกมา — เก็บไว้ดูย้อนหลัง */
  originalCostPerUnit?: number
  carriedOver: boolean
  createdAt: string
}

/** การขาย 1 รายการ */
export interface Sale {
  id: string
  date: string
  recipeId: string
  recipeName: string
  qty: number
  unit: string
  unitPrice: number
  revenue: number
  /** ต้นทุนของสินค้าที่ขายไป (ของยกมา = 0) */
  cost: number
  lotIds: string[]
  createdAt: string
}

/** ของเสีย/ของที่ทิ้ง */
export interface Waste {
  id: string
  date: string
  recipeId: string
  recipeName: string
  qty: number
  unit: string
  /** มูลค่าต้นทุนที่เสียไป */
  cost: number
  reason?: string
  createdAt: string
}

/** ทิศทางของเงิน */
export type TxKind = 'income' | 'expense'

export const TX_KIND_LABEL: Record<TxKind, string> = { income: 'รายรับ', expense: 'รายจ่าย' }

/**
 * รายรับ-รายจ่ายที่บันทึกเอง — ทุกอย่างที่ไม่ได้มาจากการขายขนมหรือการซื้อของเข้าสต็อก
 * เช่น ค่าเช่าร้าน บิลค่าไฟจริง ค่าจ้างพนักงาน เงินที่ได้จากงานรับจ้าง
 */
export interface Transaction {
  id: string
  date: string
  kind: TxKind
  /** หมวดหมู่ เช่น ค่าเช่าร้าน ค่าไฟ — เพิ่มหมวดใหม่ได้อิสระ */
  category: string
  /** รายละเอียดเพิ่มเติม ไม่ใส่ก็ได้ */
  detail: string
  amount: number
  /** ชื่อคนที่บันทึก — ใช้ตอนทำงานกันสองคน */
  by: string
  createdAt: string
}

/**
 * ทรัพย์สินที่ซื้อเก็บไว้ เช่น ทองคำ
 * เงินที่จ่ายถือเป็นรายจ่าย (เงินออกจากกระเป๋าจริง) แต่ยังเก็บมูลค่าไว้ดูแยกได้
 */
export interface Asset {
  id: string
  date: string
  name: string
  /** ปริมาณที่ได้มา เช่น 0.1538 (บาททอง) */
  qty: number
  /** หน่วยของทรัพย์สิน เช่น บาท (ทอง) กรัม หุ้น */
  unitLabel: string
  /** ราคาต่อหน่วยตอนซื้อ */
  unitPrice: number
  /** เงินที่จ่ายไปจริง */
  amount: number
  by: string
  createdAt: string
}

/** ช่องแชท — แยกเรื่องเงินส่วนตัวออกจากเรื่องของขาย */
export type ChatChannel = 'shop' | 'money'

export const CHANNEL_LABEL: Record<ChatChannel, string> = {
  shop: 'ของขาย',
  money: 'รายรับ-รายจ่าย',
}

export type ChatRole = 'user' | 'bot'

export type ChatTone = 'ok' | 'info' | 'warn' | 'error'

/** ปุ่มที่บอทเสนอให้กดต่อในแชท */
export type ChatAction =
  | { kind: 'undo'; label: string }
  | { kind: 'produceThenSell'; label: string; recipeId: string; produceQty: number; sellQty: number; unitPrice: number }
  | { kind: 'openRecipe'; label: string; recipeId?: string; name?: string }
  | { kind: 'openItem'; label: string; itemId: string }
  | { kind: 'confirmRecipe'; label: string }
  | { kind: 'cancelRecipe'; label: string }
  | { kind: 'openSalesDay'; label: string; date: string }

export interface ChatMessage {
  id: string
  /** ข้อความนี้อยู่ในช่องแชทไหน */
  channel: ChatChannel
  role: ChatRole
  /** ชื่อคนที่พิมพ์ (เฉพาะข้อความของผู้ใช้) */
  by?: string
  text: string
  tone?: ChatTone
  /** รายละเอียดเพิ่มเติมแบบตาราง key: value */
  details?: { label: string; value: string }[]
  actions?: ChatAction[]
  /** true เมื่อข้อความนี้ทำให้ข้อมูลเปลี่ยน และยังย้อนกลับได้ */
  undoable?: boolean
  at: string
}

/** ค่าตั้งต้นของร้าน */
export interface Settings {
  shopName: string
  /** ค่าใช้จ่ายอื่นตั้งต้น ใช้เติมให้สูตรใหม่อัตโนมัติ */
  defaultOverhead: Overhead
  /** เปอร์เซ็นต์กำไรตั้งต้น */
  defaultMarginPct: number
  /** วิธีคิดราคาขาย: บวกจากทุน (markup) หรือ คิดเป็นสัดส่วนของราคาขาย (margin) */
  priceMode: 'markup' | 'margin'
  /** ปัดราคาขายขึ้นเป็นจำนวนเต็มกี่บาท (0 = ไม่ปัด) */
  priceRounding: number
  /** หมวดหมู่รายจ่ายที่ใช้บ่อย — เพิ่มเองได้ และระบบจะจำหมวดใหม่ที่พิมพ์ในแชทให้ */
  expenseCategories: string[]
  /** หมวดหมู่รายรับอื่นที่ไม่ใช่การขายขนม */
  incomeCategories: string[]
  /** คนที่ช่วยกันบันทึก เช่น ["สามี", "ภรรยา"] */
  people: string[]
  /** คนที่กำลังบันทึกอยู่ตอนนี้ */
  currentPerson: string
  theme: 'light' | 'dark' | 'system'
}

/** ข้อมูลหลักทั้งหมด (ส่วนที่ย้อนกลับได้) */
export interface CoreState {
  items: Item[]
  purchases: Purchase[]
  recipes: Recipe[]
  productions: Production[]
  lots: Lot[]
  sales: Sale[]
  wastes: Waste[]
  /** รายรับ-รายจ่ายที่บันทึกเอง นอกเหนือจากการขายและการซื้อของ */
  transactions: Transaction[]
  /** ทรัพย์สินที่ซื้อเก็บไว้ */
  assets: Asset[]
  /** สูตรที่บอทถามยืนยันอยู่ ยังไม่บันทึกจนกว่าผู้ใช้จะตอบ */
  pendingRecipe?: PendingRecipe
  settings: Settings
}

/** สูตรที่รอผู้ใช้ยืนยันก่อนบันทึกจริง */
export interface PendingRecipe {
  name: string
  yieldQty: number
  yieldUnit: string
  ingredients: { name: string; qty: number; base: BaseUnit; unitLabel: string; known: boolean }[]
  /** true = แก้สูตรเดิมที่มีอยู่แล้ว */
  isUpdate: boolean
  raw: string
}

export interface AppState extends CoreState {
  chat: ChatMessage[]
  /** สแนปช็อตสำหรับปุ่ม "ย้อนกลับ" ในแชท — เก็บไว้ 20 รายการล่าสุด */
  snapshots: { msgId: string; core: CoreState }[]
}
