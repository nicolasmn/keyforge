import { Show, onMount, onCleanup } from 'solid-js'
import { createMediaQuery } from '@/utils/mediaQuery'
import { installGlobalShortcuts } from '@/utils/playbackShortcuts'
import Preview from '@/components/Preview'
import Inspector from '@/components/Inspector'
import Timeline from '@/components/Timeline'
import DocBar from '@/components/DocBar'
import { ContextMenuHost } from '@/components/ContextMenu'
import MobileTabs, { activeTab } from '@/components/MobileTabs'
import SplitLayout from '@/components/SplitLayout'
import EmptyState from '@/components/EmptyState'
import '@/styles/components.css'
import '@/styles/utils.css'
import '@/styles/app.css'
import '@/styles/motion.css'
import '@/styles/mobile.css'
import '@/styles/inspector.css'
import '@/styles/gizmo.css'
import '@/styles/empty-state.css'

/** Preview canvas plus the empty-state overlay shown when the doc has no layers. */
function PreviewArea() {
  return (
    <div class="app__preview-stack">
      <Preview />
      <EmptyState />
    </div>
  )
}

export default function App() {
  const isMobile = createMediaQuery('(max-width: 768px)')

  // Global keyboard shortcuts (audit F22): Space toggles play/pause.
  onMount(() => {
    const disposeShortcuts = installGlobalShortcuts()
    onCleanup(disposeShortcuts)
  })

  return (
    <div class="app">
      <ContextMenuHost />
      {/* Document bar — name + import/export; playback controls live in the
          timeline now. Hidden on mobile (space). */}
      <Show when={!isMobile()}>
        <header class="app__doc-header">
          <DocBar />
        </header>
      </Show>
      {/* Desktop — resizable panels via Split.js */}
      <Show when={!isMobile()}>
        <SplitLayout
          preview={<PreviewArea />}
          inspector={<Inspector />}
          timelineArea={
            <div class="app__timeline-area">
              <Timeline />
            </div>
          }
        />
      </Show>

      {/* Mobile */}
      <Show when={isMobile()}>
        <div class="app__mobile-body">
          <Show when={activeTab() === 'preview'}>
            <div class="app__mobile-panel">
              <PreviewArea />
              {/* Timeline embeds the transport strip itself (plan: playback-in-timeline). */}
              <div class="app__mobile-timeline">
                <Timeline />
              </div>
            </div>
          </Show>
          <Show when={activeTab() === 'inspector'}>
            <div class="app__mobile-panel">
              <Inspector />
            </div>
          </Show>
        </div>
        <MobileTabs />
      </Show>
    </div>
  )
}
