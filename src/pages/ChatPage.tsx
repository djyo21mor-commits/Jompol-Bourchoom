import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatAction, ChatChannel, ChatMessage } from '../types'
import { useStore } from '../lib/store'
import { Icon } from '../components/ui'
import { timeText } from '../lib/format'

const TONE_STYLE: Record<string, { bubble: string; icon: string; iconClass: string }> = {
  ok: { bubble: 'border-good/35 bg-good/8', icon: 'check', iconClass: 'text-good-ink' },
  warn: { bubble: 'border-warn/45 bg-warn/10', icon: 'warn', iconClass: 'text-warn-ink' },
  error: { bubble: 'border-bad/35 bg-bad/8', icon: 'warn', iconClass: 'text-bad-ink' },
  info: { bubble: 'border-line bg-surface', icon: 'info', iconClass: 'text-ink-3' },
}

const QUICK: Record<ChatChannel, { label: string; text: string }[]> = {
  shop: [
    { label: 'ซื้อของ', text: 'ซื้อมะม่วง 3 กิโล ราคารวม 112 บาท' },
    { label: 'ตั้งสูตร', text: 'สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม, กล่อง p39 20 กล่อง' },
    { label: 'ทำขนม', text: 'ทำเค้กมะม่วง 20 กล่อง' },
    { label: 'ขาย', text: 'ขายเค้กมะม่วง 15 กล่อง กล่องละ 120' },
    { label: 'ของเหลือ', text: 'เหลือเค้กมะม่วง 5 กล่อง' },
    { label: 'ถามต้นทุน', text: 'ต้นทุนเค้กมะม่วง กำไร 40%' },
  ],
  money: [
    { label: 'จ่ายสั้นๆ', text: 'ลูก 100' },
    { label: 'ค่าอาหาร', text: 'กิน 100' },
    { label: 'ค่าเช่า', text: 'จ่ายค่าเช่าร้าน 5000 บาท' },
    { label: 'เงินเข้า', text: '+ รับจ้างทำเค้ก 800' },
    { label: 'ทรัพย์สิน', text: 'ซื้อทองคำ จำนวน 10000 บาท ที่ราคาบาทละ 65000 บาท' },
  ],
}

const PLACEHOLDER: Record<ChatChannel, string> = {
  shop: 'พิมพ์ที่ซื้อมา ที่ทำ หรือที่ขายได้…',
  money: 'พิมพ์สั้นๆ ได้เลย เช่น ลูก 100',
}

export default function ChatPage({
  channel,
  onNavigate,
}: {
  channel: ChatChannel
  onNavigate: (tab: string, payload?: unknown) => void
}) {
  const { state, dispatch } = useStore()
  const [text, setText] = useState('')
  const [askDelete, setAskDelete] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const undoableIds = useMemo(() => new Set(state.snapshots.map((s) => s.msgId)), [state.snapshots])
  const messages = useMemo(() => state.chat.filter((m) => m.channel === channel), [state.chat, channel])
  const { people, currentPerson } = state.settings

  /**
   * ปุ่มยืนยันสูตรต้องเหลือชุดเดียวที่กดได้ — ของข้อความเก่าที่ยืนยันไปแล้ว
   * ต้องหายไป ไม่งั้นกดผิดอันแล้วงงว่าทำไมไม่มีอะไรเกิดขึ้น
   */
  const liveConfirmId = useMemo(() => {
    if (!state.pendingRecipe) return null
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].actions?.some((a) => a.kind === 'confirmRecipe')) return messages[i].id
    }
    return null
  }, [state.pendingRecipe, messages])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  // ยืดช่องพิมพ์ตามจำนวนบรรทัด แต่ไม่เกิน 128px แล้วค่อยให้เลื่อนเอง
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [text])

  function send(value?: string) {
    const payload = (value ?? text).trim()
    if (!payload) return
    dispatch({ type: 'chat/send', text: payload, channel })
    setText('')
    inputRef.current?.focus()
  }

  function runAction(action: ChatAction) {
    switch (action.kind) {
      case 'undo':
        break
      case 'confirmRecipe':
        dispatch({ type: 'recipe/confirm' })
        break
      case 'cancelRecipe':
        dispatch({ type: 'recipe/cancel' })
        break
      case 'produceThenSell':
        dispatch({
          type: 'chat/produceThenSell',
          recipeId: action.recipeId,
          produceQty: action.produceQty,
          sellQty: action.sellQty,
          unitPrice: action.unitPrice,
        })
        break
      case 'openRecipe':
        onNavigate('recipes', { recipeId: action.recipeId, name: action.name })
        break
      case 'openItem':
        onNavigate('stock', { itemId: action.itemId })
        break
      case 'openSalesDay':
        onNavigate('sales')
        break
    }
  }

  return (
    <div className="flex h-full flex-col">
      {people.length > 1 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-4 py-2">
          <span className="text-[12.5px] text-ink-3">กำลังบันทึกในชื่อ</span>
          <div className="flex gap-1.5">
            {people.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => dispatch({ type: 'person/switch', name: p })}
                className={`rounded-lg px-2.5 py-1 text-[12.5px] font-semibold transition-colors ${
                  p === currentPerson ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {messages.map((m) => (
            <div key={m.id} className="flex flex-col gap-1.5">
              {m.role === 'user' ? (
                <UserBubble
                  message={m}
                  showName={people.length > 1}
                  onAskDelete={() => setAskDelete(m.id)}
                />
              ) : (
                <BotBubble
                  message={m}
                  canUndo={!!m.undoable && undoableIds.has(m.id)}
                  confirmLive={m.id === liveConfirmId}
                  onUndo={() => dispatch({ type: 'chat/undo', msgId: m.id })}
                  onAskDelete={() => setAskDelete(m.id)}
                  onAction={runAction}
                />
              )}
              {askDelete === m.id && (
                <DeleteConfirm
                  isUser={m.role === 'user'}
                  onCancel={() => setAskDelete(null)}
                  onConfirm={() => {
                    dispatch({ type: 'chat/delete', msgId: m.id })
                    setAskDelete(null)
                  }}
                />
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-line bg-surface/95 backdrop-blur px-4 pb-3 pt-2.5">
        <div className="mx-auto max-w-2xl">
          <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-0.5">
            {QUICK[channel].map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => {
                  setText(q.text)
                  inputRef.current?.focus()
                }}
                className="shrink-0 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[12.5px] font-medium text-ink-2 hover:bg-surface-3"
              >
                {q.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => dispatch({ type: 'chat/help', channel })}
              className="shrink-0 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[12.5px] font-medium text-brand hover:bg-surface-3"
            >
              ดูคำสั่งทั้งหมด
            </button>
          </div>

          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={1}
              placeholder={PLACEHOLDER[channel]}
              className="field flex-1 resize-none overflow-y-auto py-3 leading-snug"
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={!text.trim()}
              aria-label="ส่ง"
              className="btn-primary size-[46px] shrink-0 !px-0"
            >
              <Icon name="send" />
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11.5px] text-ink-3">
            พิมพ์หลายบรรทัดได้ · Shift + Enter เพื่อขึ้นบรรทัดใหม่
          </p>
        </div>
      </div>
    </div>
  )
}

function UserBubble({
  message,
  showName,
  onAskDelete,
}: {
  message: ChatMessage
  showName: boolean
  onAskDelete: () => void
}) {
  return (
    <div className="flex flex-col items-end">
      {showName && message.by && <span className="mb-0.5 mr-1 text-[11px] text-ink-3">{message.by}</span>}
      <div className="flex max-w-[92%] items-center gap-1">
        <DeleteButton onClick={onAskDelete} />
        <div className="rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 text-[14.5px] leading-relaxed text-brand-ink whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    </div>
  )
}

/** ปุ่มลบตัวเล็กข้างฟองแชท กดแล้วค่อยถามยืนยันอีกที */
function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="ลบข้อความนี้"
      className="shrink-0 rounded-lg p-1.5 text-ink-3 opacity-60 hover:bg-surface-2 hover:text-bad-ink hover:opacity-100"
    >
      <Icon name="trash" className="size-3.5" />
    </button>
  )
}

function DeleteConfirm({
  isUser,
  onConfirm,
  onCancel,
}: {
  isUser: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[92%] rounded-xl border border-bad/40 bg-bad/8 px-3 py-2.5">
        <p className="text-[13px] leading-relaxed text-ink">
          ลบข้อความนี้ พร้อมถอนข้อมูลที่ข้อความนี้บันทึกไว้ออกจากสต็อกและสรุปทั้งหมด?
        </p>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={onConfirm} className="btn-danger btn-sm">
            <Icon name="trash" className="size-3.5" />
            ลบเลย
          </button>
          <button type="button" onClick={onCancel} className="btn-ghost btn-sm text-ink-2">
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  )
}

function BotBubble({
  message,
  canUndo,
  confirmLive,
  onUndo,
  onAskDelete,
  onAction,
}: {
  message: ChatMessage
  canUndo: boolean
  /** true เมื่อปุ่มยืนยันสูตรของข้อความนี้ยังกดได้อยู่ */
  confirmLive: boolean
  onUndo: () => void
  onAskDelete: () => void
  onAction: (a: ChatAction) => void
}) {
  const tone = TONE_STYLE[message.tone ?? 'info'] ?? TONE_STYLE.info
  const isRecipeAction = (kind: ChatAction['kind']) => kind === 'confirmRecipe' || kind === 'cancelRecipe'
  // ปุ่มยืนยันของสูตรที่จัดการไปแล้ว ให้ซ่อน เหลือแต่ปุ่มอื่นที่ยังมีความหมาย
  const actions = (message.actions ?? []).filter((a) => !isRecipeAction(a.kind) || confirmLive)
  return (
    <div className="flex items-center justify-start gap-1">
      <div className={`max-w-[92%] rounded-2xl rounded-bl-md border px-3.5 py-3 ${tone.bubble}`}>
        <div className="flex items-start gap-2">
          <Icon name={tone.icon} className={`mt-0.5 size-4 shrink-0 ${tone.iconClass}`} />
          <p className="text-[14.5px] font-medium leading-snug text-ink">{message.text}</p>
        </div>

        {message.details && message.details.length > 0 && (
          <dl className="mt-2.5 space-y-1.5 border-t border-line/70 pt-2.5">
            {message.details.map((d, i) => (
              <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <dt className="text-[13px] text-ink-3">{d.label}</dt>
                <dd className="text-[13.5px] font-semibold text-ink tnum text-right">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {(canUndo || actions.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.map((a, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onAction(a)}
                className={a.kind === 'confirmRecipe' ? 'btn-primary btn-sm' : 'btn-outline btn-sm'}
              >
                {a.label}
                {!isRecipeAction(a.kind) && <Icon name="chevron" className="size-3.5" />}
              </button>
            ))}
            {canUndo && (
              <button type="button" onClick={onUndo} className="btn-ghost btn-sm text-ink-2">
                <Icon name="undo" className="size-3.5" />
                ย้อนกลับ
              </button>
            )}
          </div>
        )}

        <time className="mt-2 block text-[11px] text-ink-3">{timeText(message.at)}</time>
      </div>
      <DeleteButton onClick={onAskDelete} />
    </div>
  )
}
