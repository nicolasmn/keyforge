# Changelog

All notable changes to this project will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

### Added

- Base project setup: SolidJS + Vite + TypeScript
- Modern CSS baseline with `@layer` architecture and design tokens
- GitHub Actions CI (typecheck, lint, format, build)
- On-demand Prettier auto-format workflow

### Fixed

- Multiple transforms on one layer no longer overwrite each other. Two
  animations of the same property cannot compose (css-animations-1: the
  animation later in the animation-name list overrides the others), so
  duplicate transform-type tracks now merge into ONE composed transform
  channel at generation time — function stacks concatenate in track order,
  with sampled stops preserving each track's own times and easings.
  Duplicate property tracks are also prevented at the editor level
  (addTrack dedupes; already-tracked properties are disabled in the picker).
- Individual-property tracks (`rotate`/`translate`/`scale`) emit valid
  individual-property syntax: legacy function-style keyframe values
  (`rotate(90deg)`, `translate(10px, 20px)`) are rewritten to bare angles
  and space-separated pairs (`90deg`, `10px 20px`), and the per-property
  first-keyframe defaults no longer use invalid function syntax.
- File export (including reduced-motion variant) now emits one @keyframes
  rule per track like preview generation, so exported files keep
  independent timelines pure instead of injecting false hold stops.
