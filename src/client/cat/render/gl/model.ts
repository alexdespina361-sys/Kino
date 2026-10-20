// Made by scripts/cat/model/build.mts with cat.mesh: do not edit.
/** The centre of the head in the rest (the point it turns about), and the ears: the ear at z < 0, then the one at z > 0. */
export const HEAD_REST = [0.5, 0.76, 0] as const;
export const EARS = [{ base: [0.478, 0.842, -0.07], a: [-0.0918, 0.9181, -0.3856], b: [0, 0.3872, 0.922], c: [0.9958, 0.0846, -0.0356] }, { base: [0.478, 0.842, 0.07], a: [-0.0918, 0.9181, 0.3856], b: [0, -0.3872, 0.922], c: [0.9958, 0.0846, 0.0356] }] as const;
export const JAW_HINGE = [0.49, 0.7, 0] as const;
