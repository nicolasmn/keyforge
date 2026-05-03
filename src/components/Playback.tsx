import { playing, setPlaying, setPlayhead, loop, setLoop, playhead, doc } from '@/store'

export default function Playback() {
  function toggle() {
    if (playing()) {
      setPlaying(false)
    } else {
      if (playhead() >= doc.duration) setPlayhead(0)
      setPlaying(true)
    }
  }

  function stop() {
    setPlaying(false)
    setPlayhead(0)
  }

  return (
    <div class="playback">
      <button class="btn btn--ghost" onClick={stop} title="Stop">
        ⏹
      </button>
      <button class="btn btn--primary" onClick={toggle}>
        {playing() ? '⏸' : '▶'}
      </button>
      <button
        class="btn btn--ghost"
        classList={{ 'btn--active': loop() }}
        onClick={() => setLoop((v) => !v)}
        title="Loop"
      >
        ⟲
      </button>
      <span class="playback__time">
        {(playhead() / 1000).toFixed(2)}s / {(doc.duration / 1000).toFixed(2)}s
      </span>
    </div>
  )
}
