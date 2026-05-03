import Header from '@/components/Header'
import LayerTree from '@/components/LayerTree'
import Preview from '@/components/Preview'
import Inspector from '@/components/Inspector'
import Timeline from '@/components/Timeline'
import Playback from '@/components/Playback'
import '@/styles/components.css'
import '@/styles/utils.css'
import '@/styles/app.css'

export default function App() {
  return (
    <div class="app">
      <Header />
      <LayerTree />
      <Preview />
      <Inspector />
      <div class="app__timeline-area">
        <Playback />
        <Timeline />
      </div>
    </div>
  )
}
