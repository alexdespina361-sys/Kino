// Made by scripts/cat/model/build.mts with cat.mesh: do not edit.
/** The centre of the head in the rest (the point it turns about), and the ears: the ear at z < 0, then the one at z > 0. */
export const HEAD_REST = [0.49, 0.72, 0] as const;
export const EARS = [{ base: [0.464, 0.8, -0.082], a: [-0.1067, 0.8893, -0.4447], b: [0, 0.4472, 0.8944], c: [0.9943, 0.0955, -0.0477] }, { base: [0.464, 0.8, 0.082], a: [-0.1067, 0.8893, 0.4447], b: [0, -0.4472, 0.8944], c: [0.9943, 0.0955, 0.0477] }] as const;
/** How far an ear reaches from its base to its tip, how wide it is at the base, and how wide at the tip. */
export const EAR_SHAPE = [0.135, 0.057, 0.011] as const;
export const JAW_HINGE = [0.48, 0.66, 0] as const;
