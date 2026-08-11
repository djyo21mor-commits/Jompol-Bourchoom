import { useState } from 'react'
import { StoreProvider, useStore } from './lib/store'
import { Icon } from './components/ui'
import ChatPage from './pages/ChatPage'
import StockPage from './pages/StockPage'
import RecipePage from './pages/RecipePage'
import SalesPage from './pages/SalesPage'
import MoneyPage from './pages/MoneyPage'
import DashboardPage from './pages/DashboardPage'
import SettingsPage from './pages/SettingsPage'

type TabKey = 'chat' | 'stock' | 'recipes' | 'sales' | 'money' | 'dashboard' | 'settings'

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'chat', label: 'แชท', icon: 'chat' },
  { key: 'stock', label: 'สต็อก', icon: 'box' },
  { key: 'recipes', label: 'เมนู', icon: 'book' },
  { key: 'sales', label: 'ขาย', icon: 'cart' },
  { key: 'money', label: 'บัญชี', icon: 'wallet' },
  { key: 'dashboard', label: 'สรุป', icon: 'chart' },
]

interface Focus {
  itemId?: string
  recipeId?: string
  name?: string
  /** เปลี่ยนทุกครั้งที่สั่งเปิด เพื่อให้หน้าปลายทางรู้ว่ามีคำสั่งใหม่ */
  nonce: number
}

function Shell() {
  const { state } = useStore()
  const [tab, setTab] = useState<TabKey>('chat')
  const [focus, setFocus] = useState<Focus>({ nonce: 0 })

  function navigate(next: string, payload?: unknown) {
    const p = (payload ?? {}) as { itemId?: string; recipeId?: string; name?: string }
    setFocus({ ...p, nonce: Date.now() })
    setTab(next as TabKey)
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-plane">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-ink">
          <Icon name="calc" className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-bold leading-tight text-ink">{state.settings.shopName}</h1>
          <p className="truncate text-[12px] text-ink-3">ระบบต้นทุนและสต็อกร้านขนม</p>
        </div>
        <button
          type="button"
          onClick={() => setTab('settings')}
          aria-label="ตั้งค่า"
          aria-current={tab === 'settings' ? 'page' : undefined}
          className={`rounded-xl p-2 transition-colors ${
            tab === 'settings' ? 'bg-brand-soft text-brand' : 'text-ink-3 hover:bg-surface-2'
          }`}
        >
          <Icon name="gear" />
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'chat' && <ChatPage onNavigate={navigate} />}
        {tab === 'stock' && <StockPage key={focus.nonce} focusItemId={focus.itemId} />}
        {tab === 'recipes' && (
          <RecipePage key={focus.nonce} focus={focus.recipeId || focus.name ? focus : undefined} />
        )}
        {tab === 'sales' && <SalesPage />}
        {tab === 'money' && <MoneyPage />}
        {tab === 'dashboard' && <DashboardPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>

      <nav
        aria-label="เมนูหลัก"
        className="shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto flex max-w-2xl">
          {TABS.map((t) => {
            const active = tab === t.key
            return (
              <li key={t.key} className="flex-1">
                <button
                  type="button"
                  onClick={() => setTab(t.key)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex w-full flex-col items-center gap-0.5 py-2 transition-colors ${
                    active ? 'text-brand' : 'text-ink-3 hover:text-ink-2'
                  }`}
                >
                  <Icon name={t.icon} className="size-[22px]" />
                  <span className="text-[11px] font-medium">{t.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
