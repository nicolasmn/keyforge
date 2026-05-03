import { Show } from 'solid-js'
import { createMediaQuery } from '@/utils/mediaQuery'
import Header from '@/components/Header'
import LayerTree from '@/components/LayerTree'
import Preview from '@/components/Preview'
import Inspector from '@/components/Inspector'
import Timeline from '@/components/Timeline'
import Playback from '@/components/Playback'
import MobileTabs, { activeTab } from '@/components/MobileTabs'
import SplitLayout from '@/components/SplitLayout'
import '@/styles/components.css'
import '@/styles/utils.css'
import '@/styles/app.css'
import '@/styles/mobile.css'
import '@/styles/token-view.css'

export default function App() {
  const isMobile = createMediaQuery('(max-width: 768px)')

  return (
    <>
      <Header />

      {/* Desktop — resizable panels via Split.js */}
      <Show when={!isMobile()}>
        <SplitLayout
          layerTree={<LayerTree />}
          preview={<Preview />}
          inspector={<Inspector />}
          timelineArea={
            <div class="app__timeline-area">
              <Playback />
              <Timeline />
            </div>
          }
        />
      </Show>

      {/* Mobile */}
      <Show when={isMobile()}>
        <div class="app__mobile-body">
          <Show when={activeTab() === 'layers'}>
            <div class="app__mobile-panel">
              <LayerTree />
            </div>
          </Show>
          <Show when={activeTab() === 'preview'}>
            <div class="app__mobile-panel">
              <Preview />
              <div class="app__mobile-timeline">
                <Playback />
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
    </>
  )
}
