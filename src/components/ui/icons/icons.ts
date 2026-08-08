/**
 * Icon registry.
 *
 * Every icon is a 24x24 stroke path drawn on the same grid, so they share a
 * single stroke width and optical weight. Color and size come from the
 * consuming component via `class` — deliberately not baked in here.
 */
export interface IconDef {
  /** One or more `d` attributes rendered as <path> elements. */
  paths: string[];
  /** Extra non-path children (circles, lines) as raw SVG. */
  extra?: string;
  /** Set for solid-filled icons like the rating star. */
  fill?: boolean;
}

export const Icons: Record<string, IconDef> = {
  checkCircle: {
    paths: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'm9 11 3 3L22 4'],
  },
  shieldCheck: {
    paths: [
      'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
      'm9 12 2 2 4-4',
    ],
  },
  container: {
    paths: [
      'M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z',
      'M7 4v16',
      'M12 4v16',
      'M17 4v16',
    ],
  },
  truck: {
    paths: [
      'M14 18V6a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h2',
      'M14 9h4l3 3v5a1 1 0 0 1-1 1h-1',
    ],
    extra:
      '<circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M9 18h6"/>',
  },
  tag: {
    paths: [
      'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z',
    ],
    extra: '<circle cx="7.5" cy="7.5" r="1.5"/>',
  },
  bolt: {
    paths: ['M13 2 3 14h8l-1 8 10-12h-8z'],
  },
  ruler: {
    paths: [
      'M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z',
      'm7.5 10.5 2 2',
      'm10.5 7.5 2 2',
      'm13.5 4.5 2 2',
      'm4.5 13.5 2 2',
    ],
  },
  box: {
    paths: [
      'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
      'm3.3 7 8.7 5 8.7-5',
      'M12 22V12',
    ],
  },
  refresh: {
    paths: [
      'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8',
      'M21 3v5h-5',
      'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16',
      'M8 16H3v5',
    ],
  },
  cart: {
    paths: ['M2 3h2.5l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L20 7H6'],
    extra: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/>',
  },
  chat: {
    paths: [
      'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
      'M8 9h8',
      'M8 13h5',
    ],
  },
  send: {
    paths: ['M22 2 11 13', 'M22 2 15 22l-4-9-9-4z'],
  },
  search: {
    paths: ['m21 21-4.35-4.35'],
    extra: '<circle cx="11" cy="11" r="7"/>',
  },
  zoomIn: {
    paths: ['m21 21-4.35-4.35', 'M11 8v6', 'M8 11h6'],
    extra: '<circle cx="11" cy="11" r="7"/>',
  },
  plus: { paths: ['M12 5v14', 'M5 12h14'] },
  minus: { paths: ['M5 12h14'] },
  close: { paths: ['M18 6 6 18', 'm6 6 12 12'] },
  trash: {
    paths: [
      'M3 6h18',
      'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2',
      'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
    ],
  },
  chevronDown: { paths: ['m6 9 6 6 6-6'] },
  chevronRight: { paths: ['m9 18 6-6-6-6'] },
  arrowRight: { paths: ['M5 12h14', 'm12 5 7 7-7 7'] },
  menu: { paths: ['M3 6h18', 'M3 12h18', 'M3 18h18'] },
  star: {
    paths: [
      'm12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z',
    ],
    fill: true,
  },
  phone: {
    paths: [
      'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.09 4.18 2 2 0 0 1 4.08 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92',
    ],
  },
  mail: {
    paths: [
      'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2',
      'm22 7-10 6L2 7',
    ],
  },
  mapPin: {
    paths: ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z'],
    extra: '<circle cx="12" cy="10" r="3"/>',
  },
  clock: {
    paths: ['M12 6v6l4 2'],
    extra: '<circle cx="12" cy="12" r="10"/>',
  },
  vest: {
    paths: [
      'M8 3 5 5v16h5V3z',
      'M16 3l3 2v16h-5V3z',
      'M8 3h8l-4 5z',
      'M5 11h5',
      'M14 11h5',
    ],
  },
  zipTie: {
    paths: [
      'M4 6h5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
      'M11 9h9a2 2 0 0 1 0 4c-4 0-7 2-7 5v3',
      'M14 9v4',
      'M17 9v4',
    ],
  },
  microphone: {
    paths: [
      'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z',
      'M19 10v1a7 7 0 0 1-14 0v-1',
      'M12 18v4',
      'M8 22h8',
    ],
  },
  // Filled square: the universal "stop recording", and unmistakable against
  // the mic outline it replaces mid-recording.
  stop: {
    paths: [
      'M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
    ],
    fill: true,
  },
};
