import { theme, toggleTheme } from '@/store'

/**
 * Theme toggle — app-global chrome, not transport scope (transport controls
 * govern the ruler; theme governs everything), so it mounts in the DocBar
 * (desktop header) and again in the MobileTabs bar rather than the Playback
 * strip. Emoji glyph follows the app's icon-button convention (Playback).
 *
 * aria-pressed toggle-button pattern: the label states what pressing DOES.
 */
export default function ThemeToggle() {
  return (
    <button
      class="btn btn--ghost theme-toggle"
      onClick={toggleTheme}
      aria-label={theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={theme() === 'light'}
      title={theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {theme() === 'dark' ? '☀︎' : '☾'}
    </button>
  )
}
