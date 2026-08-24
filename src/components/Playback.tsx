import { createSignal, For, Show } from 'solid-js'
import {
  playing,
  setPlaying,
  setPlayhead,
  loop,
  setLoop,
  playhead,
  doc,
  setDuration,
  snapIncrement,
  setSnapIncrement,
  playbackRate,
  setPlaybackRate,
  theme,
  canUndo,
  canRedo,
  undo as undoHistory,
  redo as redoHistory,
} from '@/store'
import { savePrefs } from '@/utils/persistence'
import type { SnapIncrement } from '@/utils/snap'

interface PlaybackProps {
  /** 'compact' trims padding/gap for the strip above the timeline ruler. */
  variant?: 'default' | 'compact'
}

/** Platform-accurate shortcut hint for tooltips (mac uses ⌘, others Ctrl). */
const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

const SNAP_OPTIONS: readonly { value: SnapIncrement; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 1, label: '1ms' },
  { value: 10, label: '10ms' },
  { value: 100, label: '0.1s' },
  { value: 500, label: '0.5s' },
  { value: 1000, label: '1s' },
]

const RATE_OPTIONS = [0.25, 0.5, 1, 2] as const

export default function Playback(props: PlaybackProps = {}) {
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
    // role="group" (not "toolbar"): the toolbar role implies roving-tabindex
    // arrow-key conventions we don't implement — a labelled group is honest.
    <div
      class="playback"
      classList={{ 'playback--compact': props.variant === 'compact' }}
      role="group"
      aria-label="Playback controls"
    >
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
      <button
        class="btn btn--ghost"
        disabled={!canUndo()}
        onClick={() => undoHistory()}
        aria-label="Undo"
        aria-keyshortcuts={IS_APPLE ? 'Meta+Z' : 'Control+Z'}
        title={IS_APPLE ? 'Undo (⌘Z)' : 'Undo (Ctrl+Z)'}
      >
        ↶
      </button>
      <button
        class="btn btn--ghost"
        disabled={!canRedo()}
        onClick={() => redoHistory()}
        aria-label="Redo"
        aria-keyshortcuts={IS_APPLE ? 'Meta+Shift+Z' : 'Control+Shift+Z'}
        title={IS_APPLE ? 'Redo (⇧⌘Z)' : 'Redo (Ctrl+Shift+Z)'}
      >
        ↷
      </button>
      <label
        class="playback__snap"
        title="Snap — scrub, wheel and keyframe drags jump to this increment"
      >
        Snap
        <select
          value={String(snapIncrement())}
          onChange={(e) => {
            const raw = (e.currentTarget as HTMLSelectElement).value
            const v = SNAP_OPTIONS.find((o) => String(o.value) === raw)?.value ?? 'off'
            setSnapIncrement(v)
            // Full-blob write: theme rides along so a snap change never
            // clobbers the persisted theme (prefs blob is version-1 whole).
            savePrefs({ version: 1, snapIncrement: v, theme: theme() })
          }}
        >
          <For each={SNAP_OPTIONS}>{(o) => <option value={String(o.value)}>{o.label}</option>}</For>
        </select>
      </label>
      <label class="playback__rate" title="Playback speed — Shift+, / Shift+. to cycle">
        <select
          value={String(playbackRate())}
          onChange={(e) => {
            const v = Number((e.currentTarget as HTMLSelectElement).value)
            setPlaybackRate(RATE_OPTIONS.find((r) => r === v) ?? 1)
            savePrefs({
              version: 1,
              snapIncrement: snapIncrement(),
              theme: theme(),
              playbackRate: v,
            })
          }}
        >
          <For each={RATE_OPTIONS}>{(r) => <option value={String(r)}>{r}×</option>}</For>
        </select>
      </label>
      <button
        class="btn btn--ghost"
        classList={{ 'playback__loop--on': loop() }}
        onClick={() => setLoop(!loop())}
        aria-pressed={loop()}
        aria-label="Loop playback"
        title="Loop playback (wraps inside the work area when set)"
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
