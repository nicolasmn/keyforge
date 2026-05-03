import { Show } from 'solid-js'
import Header from '@/components/Header'
import LayerTree from '@/components/LayerTree'
import Preview from '@/components/Preview'
import Inspector from '@/components/Inspector'
import Timeline from '@/components/Timeline'
import Playback from '@/components/Playback'
import MobileTabs, { activeTab } from '@/components/MobileTabs'
import '@/styles/components.css'
import '@/styles/utils.css'
import '@/styles/app.css'
import '@/styles/mobile.css'

const isMobile = () => window.matchMedia('(max-width: 768px)').matches

export default function App() {
  return (
    <div class="app">
      <Header />

      {/* Desktop layout */}
      <Show when={!isMobile()}>
        <LayerTree />
        <Preview />
        <Inspector />
        <div class="app__timeline-area">
          <Playback />
          <Timeline />
        </div>
      </Show>

      {/* Mobile layout */}
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
    </div>
  )
}
