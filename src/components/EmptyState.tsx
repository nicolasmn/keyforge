import { For, Show } from 'solid-js'
import {
  doc,
  onboarded,
  addStarterLayer,
  listProjects,
  activeProjectId,
  openProject,
  createProjectWithDoc,
  setSelectedLayerId,
  setSelectedKeyframeId,
  setPlayhead,
  setPlaying,
} from '@/store'
import { createSampleDoc } from '@/utils/sampleDoc'
import { SAMPLE_PROJECT_NAME } from '@/utils/projects'

/**
 * EmptyState — guided first-run overlay shown in the workspace (preview)
 * area while the document has no layers and the user hasn't onboarded.
 *
 * The card is the *one-time* onboarding moment (audit F21): once the
 * user engages (adds a layer / loads a sample / imports), the persisted
 * `keyforge:onboarded` flag keeps it from re-nagging returning users who
 * later deliberately empty their document. After that, an empty timeline
 * shows the quieter canvas hint instead (audit F19).
 *
 * Offers two paths out of the empty state:
 *   - "Add your first layer" → pre-built starter Box layer (addStarterLayer)
 *   - "Load sample animation" → replaces the document with a demo doc
 */
export default function EmptyState() {
  function loadSample() {
    // The sample is a real project now (plan §5): open the seeded one when it
    // exists; re-register it (fresh ids) only if the user deleted it earlier.
    const seeded = listProjects().find((p) => p.name === SAMPLE_PROJECT_NAME)
    if (!seeded || !openProject(seeded.id)) {
      createProjectWithDoc(SAMPLE_PROJECT_NAME, createSampleDoc)
    }
    // Selection/playhead may point at entities that no longer exist — reset them
    setSelectedLayerId(doc.layers[0]?.id ?? null)
    setSelectedKeyframeId(null)
    setPlayhead(0)
    // Start playback right away so the sample visibly animates immediately
    setPlaying(true)
  }

  /** Other projects the user can jump straight into from onboarding. */
  const otherProjects = () =>
    listProjects().filter((p) => p.id !== activeProjectId() && p.name !== SAMPLE_PROJECT_NAME)

  return (
    <Show when={doc.layers.length === 0 && !onboarded()}>
      <div class="empty-state" role="status">
        <div class="empty-state__card">
          <div class="empty-state__art" aria-hidden="true">
            <span class="empty-state__diamond empty-state__diamond--faint" />
            <span class="empty-state__diamond empty-state__diamond--mid" />
            <span class="empty-state__diamond" />
          </div>

          <h2 class="empty-state__title">Nothing here yet</h2>
          <p class="empty-state__subtitle">
            Keyforge turns CSS keyframes into something you can see and edit.
          </p>

          <div class="empty-state__actions">
            <button class="btn btn--primary empty-state__cta" onClick={addStarterLayer}>
              Add your first layer
            </button>
            <button class="btn btn--ghost" onClick={loadSample}>
              Load sample animation
            </button>
          </div>

          <Show when={otherProjects().length > 0}>
            <div class="empty-state__projects">
              <p class="empty-state__projects-label">Your projects</p>
              <div class="empty-state__project-list" role="list">
                <For each={otherProjects()}>
                  {(p) => (
                    <button
                      class="btn btn--ghost empty-state__project"
                      role="listitem"
                      onClick={() => {
                        void openProject(p.id)
                      }}
                    >
                      {p.name}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
