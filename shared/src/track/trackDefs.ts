/**
 * Track layouts. Tracks are street circuits laid over a city grid.
 * Points are corners of the circuit in city-grid units (x = east, y = south),
 * each with a fillet radius in metres. The loop is closed automatically.
 */
export type TrackTheme = 'day' | 'sunset' | 'night';

export interface TrackPoint {
  x: number;
  y: number;
  /** corner fillet radius in metres */
  r: number;
}

export interface TrackDef {
  id: string;
  name: string;
  theme: TrackTheme;
  /** metres per city-grid unit (block pitch) */
  grid: number;
  /** barrier-to-barrier road width in metres */
  roadWidth: number;
  points: TrackPoint[];
  /** distance along the centreline where the start/finish line sits (m) */
  startOffset: number;
  /** city blocks generated around the circuit, in grid units (inclusive) */
  city: { minX: number; maxX: number; minY: number; maxY: number };
  /** blocks (grid cell = top-left corner) forced to be parks */
  parks: [number, number][];
  seed: number;
}

export const TRACKS: Record<string, TrackDef> = {
  midtown: {
    id: 'midtown',
    name: 'Midtown Circuit',
    theme: 'day',
    grid: 120,
    roadWidth: 16,
    points: [
      { x: 0, y: 0, r: 22 },
      { x: 5, y: 0, r: 70 },
      { x: 6, y: 1, r: 70 },
      { x: 6, y: 3, r: 24 },
      { x: 3, y: 3, r: 20 },
      { x: 3, y: 2, r: 18 },
      { x: 0, y: 2, r: 22 },
    ],
    startOffset: 150,
    city: { minX: -3, maxX: 8, minY: -3, maxY: 5 },
    parks: [
      [5, 0],
      [1, 2],
    ],
    seed: 20260924,
  },
};
