/** งานหนึ่งชิ้นที่ต้องส่ง/ต้องทำ */
export interface Task {
  id: string
  title: string
  /** วันครบกำหนดส่ง รูปแบบ YYYY-MM-DD หรือ null ถ้ายังไม่กำหนด */
  due: string | null
  note: string
  done: boolean
  createdAt: string
  updatedAt: string
  /** ป้ายหลุมศพ — ลบแล้วแต่คงไว้ชั่วคราวเพื่อให้อีกเครื่องรู้ว่าถูกลบ */
  deleted?: boolean
}

export interface AppState {
  tasks: Task[]
}

export const EMPTY_STATE: AppState = { tasks: [] }
