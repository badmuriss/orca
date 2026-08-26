import { describe, expect, it } from 'vitest'
import {
  fitMobileMaestroFrames,
  mobileMaestroInspectorInsets,
  projectMobileMaestroFrame,
  revealMobileMaestroFrame
} from './mobile-maestro-geometry'

describe('mobile Maestro geometry', () => {
  it('reveals a selected card outside the phone inspector', () => {
    const insets = mobileMaestroInspectorInsets(false, true)
    const next = revealMobileMaestroFrame(
      { center: { x: 0, y: 0 }, zoom: 1 },
      { x: 300, y: 220, width: 260, height: 168 },
      { width: 412, height: 915, ...insets }
    )
    const projected = projectMobileMaestroFrame(
      next,
      { x: 300, y: 220, width: 260, height: 168 },
      { width: 412, height: 915 }
    )
    expect(next.center.x).toBeGreaterThan(0)
    expect(next.center.y).toBeGreaterThan(0)
    expect(projected.y + projected.height).toBeLessThanOrEqual(915 - insets.insetBottom - 16)
  })

  it('fits populated tablet cards at a readable zoom', () => {
    const viewport = fitMobileMaestroFrames(
      [
        { x: 0, y: 0, width: 300, height: 190 },
        { x: 328, y: 0, width: 300, height: 190 },
        { x: 656, y: 0, width: 300, height: 190 }
      ],
      { width: 1280, height: 800, insetRight: 280, insetBottom: 0 }
    )
    expect(viewport.zoom).toBeGreaterThanOrEqual(0.55)
  })

  it('contains widely separated populated phone cards inside the useful area', () => {
    const frames = [
      { x: 0, y: 420, width: 320, height: 220 },
      { x: 0, y: 700, width: 320, height: 220 },
      { x: 1500, y: 420, width: 320, height: 220 }
    ]
    const usable = { width: 412, height: 915, insetRight: 0, insetBottom: 0 }
    const viewport = fitMobileMaestroFrames(frames, usable)
    const projected = frames.map((frame) => projectMobileMaestroFrame(viewport, frame, usable))

    expect(Math.min(...projected.map((frame) => frame.x))).toBeGreaterThanOrEqual(20)
    expect(Math.max(...projected.map((frame) => frame.x + frame.width))).toBeLessThanOrEqual(392)
    expect(Math.min(...projected.map((frame) => frame.y))).toBeGreaterThanOrEqual(72)
    expect(Math.max(...projected.map((frame) => frame.y + frame.height))).toBeLessThanOrEqual(895)
  })
})
