import { createSignal, Show } from 'solid-js'
import {
  playing,
  setPlaying,
  setPlayhead,
  loop,
  setLoop,
  playhead,
  doc,
  setDuration,
} from '@/store'

export default function Playback() {
  const [editingDuration, setEditingDuration] = createSignal(false)
  const [durationInvalid, setDurationInvalid] = createSignal(false)

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

  function commitDuration(e: Event) {
    const raw = (e.currentTarget as HTMLInputElement).value.trim()
    const seconds = Number.parseFloat(raw)
    if (!Number.isNaN(seconds) && seconds > 0 && seconds <= 60) {
      setDuration(Math.round(seconds * 1000))
      setDurationInvalid(false)
      setEditingDuration(false)
      // keep the playhead inside the new duration
      if (playhead() > Math.round(seconds * 1000)) setPlayhead(Math.round(seconds * 1000))
    } else {
      setDurationInvalid(true)
    }
  }

  return (
    <div class="playback">
      <button class="btn btn--ghost" onClick={stop} title="Stop">
        ⏹
      </button>
      <button
        class="btn btn--primary"
        onClick={toggle}
        aria-label={playing() ? 'Pause' : 'Play'}
        aria-keyshortcuts="Space"
        title={playing() ? 'Pause' : 'Play'}
      >
        {playing() ? '⏸' : '▶'}
      </button>
      <button
        class="btn btn--ghost"
        classList={{ 'btn--active': loop() }}
        onClick={() => setLoop((v) => !v)}
        title="Loop"
        aria-pressed={loop()}
        style={
          loop()
            ? {
                background: 'color-mix(in oklch, var(--color-accent) 14%, transparent)',
                color: 'var(--color-accent)',
              }
            : undefined
        }
      >
        ⟲
      </button>
      <span class="playback__time">
        {(playhead() / 1000).toFixed(2)}s /{' '}
        <Show
          when={editingDuration()}
          fallback={
            <span
              class="playback__duration"
              tabindex={0}
              role="button"
              aria-label={`Total duration ${(doc.duration / 1000).toFixed(2)} seconds. Press Enter to edit.`}
              onClick={() => setEditingDuration(true)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter') setEditingDuration(true)
              }}
              title="Click to change duration"
            >
              {(doc.duration / 1000).toFixed(2)}s
            </span>
          }
        >
          <input
            class="input playback__duration-input"
            classList={{ 'playback__duration-input--invalid': durationInvalid() }}
            value={(doc.duration / 1000).toFixed(2)}
            type="number"
            min="0.1"
            max="60"
            step="0.1"
            aria-label="Total duration in seconds"
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === 'Enter') commitDuration(e)
              if (e.key === 'Escape') {
                setDurationInvalid(false)
                setEditingDuration(false)
              }
            }}
            onBlur={commitDuration}
            autofocus
          />
          <span
            class="playback__duration-hint"
            role="status"
            aria-live="polite"
            style={{
              'font-size': 'var(--font-size-xs)',
              color: durationInvalid() ? 'var(--color-danger)' : 'var(--color-text-faint)',
              'white-space': 'nowrap',
            }}
          >
            {durationInvalid() ? 'Invalid — must be 0.1–60s' : '0.1–60s'}
          </span>
        </Show>
      </span>
    </div>
  )
}
