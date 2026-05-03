import { Show, For, createSignal } from 'solid-js'
import {
  selectedLayerId,
  selectedKeyframeId,
  setSelectedKeyframeId,
  getSelectedLayer,
  getSelectedTrackAndKeyframe,
  addTrack,
  addKeyframe,
  updateKeyframe,
  removeKeyframe,
  playhead,
} from '@/store'
import type { AnimatableProperty, EasingName } from '@/types'
import CodeView from './CodeView'

const PROPERTIES: AnimatableProperty[] = [
  'opacity',
  'transform',
  'background-color',
  'color',
  'border-radius',
  'width',
  'height',
  'scale',
  'translate',
  'rotate',
]

const EASINGS: EasingName[] = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'cubic-bezier(0.34,1.56,0.64,1)',
]

type Tab = 'properties' | 'css'

export default function Inspector() {
  const [activeTab, setActiveTab] = createSignal<Tab>('properties')
  const layer = () => getSelectedLayer()
  const selected = () => getSelectedTrackAndKeyframe()

  function handleAddTrack(e: Event) {
    const sel = e.currentTarget as HTMLSelectElement
    const prop = sel.value as AnimatableProperty
    if (!prop || !selectedLayerId()) return
    addTrack(selectedLayerId()!, prop)
    sel.value = ''
  }

  function handleAddKeyframe(trackId: string) {
    const layerId = selectedLayerId()
    if (!layerId) return
    addKeyframe(layerId, trackId, {
      time: playhead(),
      value: '',
      easing: 'ease-out',
    })
  }

  return (
    <aside class="panel inspector">
      {/* Tab bar */}
      <div class="inspector__tab-bar">
        <button
          class="inspector__tab"
          classList={{ 'inspector__tab--active': activeTab() === 'properties' }}
          onClick={() => setActiveTab('properties')}
        >
          Properties
        </button>
        <button
          class="inspector__tab"
          classList={{ 'inspector__tab--active': activeTab() === 'css' }}
          onClick={() => setActiveTab('css')}
        >
          CSS
        </button>
      </div>

      {/* Properties tab */}
      <Show when={activeTab() === 'properties'}>
        <Show when={layer()} fallback={<p class="inspector__empty">No layer selected</p>}>
          {(l) => (
            <div class="inspector__body">
              {/* Property tracks */}
              <For each={l().tracks}>
                {(track) => (
                  <div class="inspector__track">
                    <div class="inspector__track-header">
                      <span class="inspector__prop-name">{track.property}</span>
                      <button
                        class="btn btn--ghost"
                        onClick={() => handleAddKeyframe(track.id)}
                        title="Add keyframe at playhead"
                      >
                        + KF
                      </button>
                    </div>
                    <For each={track.keyframes}>
                      {(kf) => (
                        <div
                          class="inspector__keyframe"
                          classList={{
                            'inspector__keyframe--selected': selectedKeyframeId() === kf.id,
                          }}
                          onClick={() => setSelectedKeyframeId(kf.id)}
                        >
                          <span class="inspector__kf-time">{kf.time}ms</span>
                          <input
                            class="input inspector__kf-value"
                            value={kf.value}
                            onBlur={(e) =>
                              updateKeyframe(l().id, track.id, kf.id, {
                                value: e.currentTarget.value,
                              })
                            }
                          />
                          <select
                            class="input inspector__kf-easing"
                            value={kf.easing}
                            onChange={(e) =>
                              updateKeyframe(l().id, track.id, kf.id, {
                                easing: e.currentTarget.value as EasingName,
                              })
                            }
                          >
                            <For each={EASINGS}>{(e) => <option value={e}>{e}</option>}</For>
                          </select>
                          <button
                            class="btn btn--ghost"
                            onClick={() => removeKeyframe(l().id, track.id, kf.id)}
                            title="Remove"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </For>

              {/* Add property track */}
              <div class="inspector__add-track">
                <select class="input" onChange={handleAddTrack}>
                  <option value="">+ Add property track</option>
                  <For each={PROPERTIES}>{(p) => <option value={p}>{p}</option>}</For>
                </select>
              </div>

              {/* Selected keyframe detail editor */}
              <Show when={selected()}>
                {(sel) => (
                  <div class="inspector__kf-detail">
                    <div class="panel__header">Selected Keyframe</div>
                    <label class="inspector__label">
                      Time (ms)
                      <input
                        class="input"
                        type="number"
                        value={sel().keyframe.time}
                        onBlur={(e) =>
                          updateKeyframe(selectedLayerId()!, sel().track.id, sel().keyframe.id, {
                            time: Number(e.currentTarget.value),
                          })
                        }
                      />
                    </label>
                    <label class="inspector__label">
                      Value
                      <input
                        class="input"
                        value={sel().keyframe.value}
                        onBlur={(e) =>
                          updateKeyframe(selectedLayerId()!, sel().track.id, sel().keyframe.id, {
                            value: e.currentTarget.value,
                          })
                        }
                      />
                    </label>
                  </div>
                )}
              </Show>
            </div>
          )}
        </Show>
      </Show>

      {/* CSS tab */}
      <Show when={activeTab() === 'css'}>
        <CodeView />
      </Show>
    </aside>
  )
}
