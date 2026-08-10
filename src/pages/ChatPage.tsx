import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatAction, ChatMessage } from '../types'
import { useStore } from '../lib/store'
import { Icon } from '../components/ui'
import { timeText } from '../lib/format'

const TONE_STYLE: Record<string, { bubble: string; icon: string; iconClass: string }> = {
  ok: { bubble: 'border-good/35 bg-good/8', icon: 'check', iconClass: 'text-good-ink' },
  warn: { bubble: 'border-warn/45 bg-warn/10', icon: 'warn', iconClass: 'text-warn-ink' },
  error: { bubble: 'border-bad/35 bg-bad/8', icon: 'warn', iconClass: 'text-bad-ink' },
  info: { bubble: 'border-line bg-surface', icon: 'info', iconClass: 'text-ink-3' },
}

const QUICK: { label: string; text: string }[] = [
  { label: 'ซื้อของ', text: 'ซื้อมะม่วง 3 กิโล ราคารวม 112 บาท' },
  { label: 'ตั้งสูตร', text: 'สูตรเค้กมะม่วง ได้ 20 กล่อง ใช้ มะม่วง 1500 กรัม, กล่อง p39 20 กล่อง' },
  { label: 'ทำขนม', text: 'ทำเค้กมะม่วง 20 กล่อง' },
  { label: 'ขาย', text: 'ขายเค้กมะม่วง 15 กล่อง กล่องละ 120' },
  { label: 'ของเหลือ', text: 'เหลือเค้กมะม่วง 5 กล่อง' },
  { label: 'ถามต้นทุน', text: 'ต้นทุนเค้กมะม่วง กำไร 40%' },
]

export default function ChatPage({ onNavigate }: { onNavigate: (tab: string, payload?: unknown) => void }) {
  const { state, dispatch } = useStore()
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const undoableIds = useMemo(() => new Set(state.snapshots.map((s) => s.msgId)), [state.snapshots])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [state.chat.length])

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
    dispatch({ type: 'chat/send', text: payload })
    setText('')
    inputRef.current?.focus()
  }

  function runAction(action: ChatAction) {
    switch (action.kind) {
      case 'undo':
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
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {state.chat.map((m) =>
            m.role === 'user' ? (
              <UserBubble key={m.id} message={m} />
            ) : (
              <BotBubble
                key={m.id}
                message={m}
                canUndo={!!m.undoable && undoableIds.has(m.id)}
                onUndo={() => dispatch({ type: 'chat/undo', msgId: m.id })}
                onAction={runAction}
              />
            ),
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-line bg-surface/95 backdrop-blur px-4 pb-3 pt-2.5">
        <div className="mx-auto max-w-2xl">
          <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-0.5">
            {QUICK.map((q) => (
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
              onClick={() => dispatch({ type: 'chat/help' })}
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
              placeholder="พิมพ์ที่ซื้อมา ที่ทำ หรือที่ขายได้…"
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

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 text-[14.5px] leading-relaxed text-brand-ink whitespace-pre-wrap">
        {message.text}
      </div>
    </div>
  )
}

function BotBubble({
  message,
  canUndo,
  onUndo,
  onAction,
}: {
  message: ChatMessage
  canUndo: boolean
  onUndo: () => void
  onAction: (a: ChatAction) => void
}) {
  const tone = TONE_STYLE[message.tone ?? 'info'] ?? TONE_STYLE.info
  return (
    <div className="flex justify-start">
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

        {(canUndo || message.actions?.length) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.actions?.map((a, i) => (
              <button key={i} type="button" onClick={() => onAction(a)} className="btn-outline btn-sm">
                {a.label}
                <Icon name="chevron" className="size-3.5" />
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
    </div>
  )
}
