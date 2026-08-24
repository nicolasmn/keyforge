import type { AnimationDocument, Layer } from '@/types'
import { nanoid } from '@/utils/nanoid'

/**
 * The pre-built starter Box layer behind "Add your first layer" (audit F21).
 *
 * A factory — every call returns a brand-new Layer with fresh nanoid() ids,
 * so repeated adds never collide. Ships with two ready-to-scrub tracks
 * (opacity fade-in + transform rise) so the timeline shows real content
 * the moment onboarding completes.
 */
export function createStarterBoxLayer(): Layer {
  return {
    id: nanoid(),
    name: 'Box',
    visible: true,
    element: {
      tag: 'div',
      text: '',
      initialCss:
        'width:80px;height:80px;background-color:hsl(264 80% 68%);border-radius:8px;margin:0 12px;',
    },
    tracks: [
      {
        id: nanoid(),
        property: 'opacity',
        keyframes: [
          { id: nanoid(), time: 0, value: '0', easing: 'ease-out' },
          { id: nanoid(), time: 800, value: '1', easing: 'ease-out' },
        ],
      },
      {
        id: nanoid(),
        property: 'transform',
        keyframes: [
          {
            id: nanoid(),
            time: 0,
            value: 'translateY(40px)',
            easing: 'cubic-bezier(0.34,1.56,0.64,1)',
          },
          { id: nanoid(), time: 1000, value: 'translateY(0px)', easing: 'linear' },
        ],
      },
    ],
  }
}

/**
 * Sample animation shown from the empty state ("Load sample animation").
 *
 * A factory — every call returns a brand-new AnimationDocument with fresh
 * nanoid() ids, so loading it multiple times never collides with previous
 * ids or with the selection state pointing at an old layer.
 *
 * Design notes:
 * - 2 layers × 3 tracks total, keyframes at different times with different
 *   values, so the timeline looks interesting immediately.
 * - Duration 2000 ms (matches the default document).
 * - Every animated track produces VISIBLE motion on its element (audit
 *   F20): the Dot translates across the stage (its old rotate(0→360deg)
 *   track spun a radially-symmetric circle — zero visible change), and a
 *   third beat (Box scale bounce) showcases another technique flavor.
 * - Layer styling uses the accent palette (--color-track-1 purple /
 *   --color-track-2 blue).
 */
export function createSampleDoc(): AnimationDocument {
  return {
    id: nanoid(),
    name: 'Sample animation',
    duration: 2000,
    layers: [
      {
        id: nanoid(),
        name: 'Box',
        visible: true,
        element: {
          tag: 'div',
          text: '',
          initialCss:
            'width:80px;height:80px;background-color:hsl(264 80% 68%);border-radius:8px;margin:0 12px;',
        },
        tracks: [
          {
            id: nanoid(),
            property: 'opacity',
            keyframes: [
              { id: nanoid(), time: 0, value: '0', easing: 'ease-out' },
              { id: nanoid(), time: 800, value: '1', easing: 'ease-out' },
              { id: nanoid(), time: 1600, value: '0', easing: 'ease-out' },
            ],
          },
          {
            id: nanoid(),
            property: 'transform',
            keyframes: [
              {
                id: nanoid(),
                time: 0,
                value: 'translateY(40px)',
                easing: 'cubic-bezier(0.34,1.56,0.64,1)',
              },
              { id: nanoid(), time: 1000, value: 'translateY(0px)', easing: 'linear' },
            ],
          },
          {
            // Third beat: a scale bounce after the box lands — shows the
            // individual `scale` property as its own technique flavor.
            id: nanoid(),
            property: 'scale',
            keyframes: [
              { id: nanoid(), time: 1000, value: '1', easing: 'ease-in-out' },
              { id: nanoid(), time: 1400, value: '1.3', easing: 'ease-in-out' },
              { id: nanoid(), time: 1800, value: '1', easing: 'ease-in-out' },
            ],
          },
        ],
      },
      {
        id: nanoid(),
        name: 'Dot',
        visible: true,
        element: {
          tag: 'div',
          text: '',
          initialCss:
            'width:56px;height:56px;background-color:hsl(200 80% 60%);border-radius:9999px;margin:0 12px;',
        },
        tracks: [
          {
            // Visible motion beats rotation on a radially-symmetric
            // circle (audit F20): sweeps right, then back — ends where it
            // started so looped playback stays seamless.
            id: nanoid(),
            property: 'transform',
            keyframes: [
              { id: nanoid(), time: 0, value: 'translateX(-60px)', easing: 'ease-in-out' },
              { id: nanoid(), time: 1000, value: 'translateX(60px)', easing: 'ease-in-out' },
              { id: nanoid(), time: 2000, value: 'translateX(-60px)', easing: 'linear' },
            ],
          },
          {
            id: nanoid(),
            property: 'background-color',
            keyframes: [
              { id: nanoid(), time: 0, value: 'hsl(200 80% 60%)', easing: 'ease-in-out' },
              { id: nanoid(), time: 1000, value: 'hsl(160 70% 55%)', easing: 'ease-in-out' },
              { id: nanoid(), time: 2000, value: 'hsl(264 80% 68%)', easing: 'linear' },
            ],
          },
        ],
      },
    ],
  }
}
