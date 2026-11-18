export const DESK_EM_PX = 19.2;

export const PITCH_EM = { poster: 10.7, category: 20.6, wide: 16.6, episode: 45 } as const;

export const pageWidth = (width: number, height: number, desk: boolean): number => {
  const unit = Math.max(Math.min(width / 100, height * 0.017778, desk ? DESK_EM_PX : Infinity), 9);
  return width / unit;
};

export const columnsFor = (width: number, drawn: number, pitch: number): number => (width > 100.5 ? drawn + Math.floor((width - 100) / pitch) : drawn);
