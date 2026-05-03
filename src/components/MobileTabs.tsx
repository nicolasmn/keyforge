import { createSignal } from 'solid-js'
import type { JSX } from 'solid-js'

export type TabId = 'layers' | 'preview' | 'inspector'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'layers', label: 'Layers', icon: '▣' },
  { id: 'preview', label: 'Preview', icon: '▶' },
  { id: 'inspector', label: 'Inspector', icon: '⋮' },
]

export const [activeTab, setActiveTab] = createSignal<TabId>('preview')

export default function MobileTabs(): JSX.Element {
  return (
    <nav class="mobile-tabs">
      {TABS.map((tab) => (
        <button
          class="mobile-tabs__btn"
          classList={{ 'mobile-tabs__btn--active': activeTab() === tab.id }}
          onClick={() => setActiveTab(tab.id)}
        >
          <span class="mobile-tabs__icon">{tab.icon}</span>
          <span class="mobile-tabs__label">{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}
