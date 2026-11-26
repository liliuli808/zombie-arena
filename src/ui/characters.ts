import { renderFrame, rig, WALK_POSES, type Look, type PoseKey, type Shading } from './rig';

const OUT = '#0c0c0c';

/** 所有角色共用的人形骨架，只是不同物种调整了比例。 */
const makeRig = (o: Partial<import('./rig').Rig> = {}) => ({
  hip: [24, 28] as [number, number],
  neck: [24, 17] as [number, number],
  head: [24, 9] as [number, number],
  headR: 5,
  torsoTop: 17,
  torsoBottom: 28,
  shoulderW: 10,
  hipW: 8,
  upperArm: 7,
  foreArm: 6,
  thigh: 8,
  shin: 7,
  armW: 4,
  legW: 5,
  ...o,
});

const SKIN_HUMAN: Shading = { light: '#f0d4a8', mid: '#e6a96e', dark: '#d67b4e' };
const SKIN_ZOMBIE: Shading = { light: '#bcd888', mid: '#94b85a', dark: '#4a5f2e' };
const SKIN_ROT: Shading = { light: '#94b85a', mid: '#6b8a3d', dark: '#2e3d1c' };

const BOOTS: Shading = { light: '#6b441e', mid: '#3a2410', dark: '#0c0c0c' };
const JEANS: Shading = { light: '#3a3a46', mid: '#1c1c24', dark: '#0c0c0c' };
const IRON: Shading = { light: '#9090a0', mid: '#606070', dark: '#3a3a46' };

const PARTY: Record<string, { look: Look; rig?: Partial<import('./rig').Rig> }> = {
  player: {
    look: {
      outline: OUT, skin: SKIN_HUMAN, cloth: { light: '#2d7aa8', mid: '#1c4a6e', dark: '#0e2438' },
      pants: JEANS, shoes: BOOTS, accent: { light: '#e04a3a', mid: '#b64545', dark: '#7a2e2e' },
    },
  },
  walker: {
    look: {
      outline: OUT, skin: SKIN_ZOMBIE, cloth: { light: '#9090a0', mid: '#606070', dark: '#3a3a46' },
      pants: { light: '#3a3a46', mid: '#1c1c24', dark: '#0c0c0c' }, shoes: BOOTS,
      accent: { light: '#3a3a46', mid: '#1c1c24', dark: '#0c0c0c' },
    },
    rig: { shoulderW: 9, hipW: 7, headR: 5, armW: 3 },
  },
  runner: {
    look: {
      outline: OUT, skin: SKIN_ZOMBIE, cloth: { light: '#e04a3a', mid: '#8a1420', dark: '#7a2e2e' },
      pants: { light: '#6b441e', mid: '#3a2410', dark: '#0c0c0c' }, shoes: BOOTS,
      accent: { light: '#c41e2a', mid: '#8a1420', dark: '#2e3d1c' },
    },
    rig: { shoulderW: 8, hipW: 7, armW: 3, legW: 4, headR: 5 },
  },
  fatty: {
    look: {
      outline: OUT, skin: SKIN_ZOMBIE, cloth: { light: '#bcbccd', mid: '#9090a0', dark: '#606070' },
      pants: { light: '#3a3a46', mid: '#1c1c24', dark: '#0c0c0c' }, shoes: BOOTS,
      accent: { light: '#94b85a', mid: '#6b8a3d', dark: '#4a5f2e' },
    },
    rig: { shoulderW: 18, hipW: 16, torsoTop: 15, torsoBottom: 29, armW: 6, legW: 7, headR: 5, hip: [24, 29] },
  },
  shield: {
    look: {
      outline: OUT, skin: SKIN_ZOMBIE, cloth: { light: '#4a5f2e', mid: '#2e3d1c', dark: '#0c0c0c' },
      pants: { light: '#3a3a46', mid: '#1c1c24', dark: '#0c0c0c' }, shoes: BOOTS,
      accent: { light: '#9090a0', mid: '#606070', dark: '#3a3a46' },
    },
    rig: { shoulderW: 11, hipW: 8, armW: 4 },
  },
  spitter: {
    look: {
      outline: OUT, skin: SKIN_ROT, cloth: { light: '#94b85a', mid: '#6b8a3d', dark: '#4a5f2e' },
      pants: { light: '#4a5f2e', mid: '#2e3d1c', dark: '#0c0c0c' }, shoes: BOOTS,
      accent: { light: '#fff7b0', mid: '#ffe066', dark: '#bfa01d' },
      extras: { X: '#ffe066' },
    },
    rig: { shoulderW: 13, hipW: 11, armW: 4, legW: 5 },
  },
  summoner: {
    look: {
      outline: OUT, skin: SKIN_ROT, cloth: { light: '#8a5abf', mid: '#5a3a8a', dark: '#2a1848' },
      pants: { light: '#5a3a8a', mid: '#3d2666', dark: '#2a1848' }, shoes: BOOTS,
      accent: { light: '#e6c93d', mid: '#bfa01d', dark: '#7a641a' },
      extras: { X: '#ffe066' },
    },
    rig: { shoulderW: 11, hipW: 10, headR: 5 },
  },
  armored: {
    look: {
      outline: OUT, skin: SKIN_ZOMBIE, cloth: { light: '#606070', mid: '#3a3a46', dark: '#1c1c24' },
      pants: { light: '#3a3a46', mid: '#1c1c24', dark: '#0c0c0c' }, shoes: IRON,
      accent: { light: '#5ab0d8', mid: '#2d7aa8', dark: '#1c4a6e' },
      extras: { X: '#8fdcff' },
    },
    rig: { shoulderW: 13, hipW: 9, armW: 5, legW: 6, headR: 5 },
  },
  butcher: {
    look: {
      outline: OUT, skin: SKIN_ROT, cloth: { light: '#bcbccd', mid: '#9090a0', dark: '#606070' },
      pants: { light: '#3a3a46', mid: '#1c1c24', dark: '#0c0c0c' }, shoes: BOOTS,
      accent: { light: '#c41e2a', mid: '#8a1420', dark: '#7a2e2e' },
    },
    rig: {
      hip: [24, 30], neck: [24, 15], head: [24, 8], torsoTop: 15, torsoBottom: 30,
      shoulderW: 18, hipW: 12, armW: 6, legW: 7, upperArm: 8, foreArm: 7, thigh: 9, shin: 8,
    },
  },
  mother: {
    look: {
      outline: OUT, skin: { light: '#bcd888', mid: '#94b85a', dark: '#4a5f2e' },
      cloth: { light: '#94b85a', mid: '#6b8a3d', dark: '#2e3d1c' },
      pants: { light: '#4a5f2e', mid: '#2e3d1c', dark: '#0c0c0c' }, shoes: BOOTS,
      accent: { light: '#fff7b0', mid: '#ffe066', dark: '#4a5f2e' },
      extras: { X: '#ffe066' },
    },
    rig: {
      hip: [24, 31], neck: [24, 16], head: [24, 9], headR: 6,
      torsoTop: 16, torsoBottom: 31, shoulderW: 20, hipW: 18,
      armW: 6, legW: 8, upperArm: 9, foreArm: 8, thigh: 9, shin: 8,
    },
  },
  drone: {
    look: {
      outline: OUT, skin: SKIN_ZOMBIE, cloth: IRON,
      pants: { light: '#3a3a46', mid: '#1c1c24', dark: '#0c0c0c' }, shoes: IRON,
      accent: { light: '#8fdcff', mid: '#5ab0d8', dark: '#1c4a6e' },
      extras: { X: '#c8ecff' },
    },
    rig: { hip: [24, 26], torsoBottom: 26, shoulderW: 9, hipW: 7, armW: 3, legW: 4 },
  },
};

export const CHARACTERS: Record<string, { rig: import('./rig').Rig; look: Look }> = Object.fromEntries(
  Object.entries(PARTY).map(([id, spec]) => [id, { rig: makeRig(spec.rig ?? {}), look: spec.look }]),
);

const ORDER: PoseKey[] = ['idleA', 'idleB', 'walk0', 'walk1', 'walk2', 'walk3'];

export function buildCharacter(id: string, poses: PoseKey[] = ORDER) {
  const spec = CHARACTERS[id];
  if (!spec) throw new Error(`unknown character: ${id}`);
  const frames = poses.map((p) => renderFrame(spec.rig, spec.look, WALK_POSES[p]));
  return rig(spec.look, frames);
}

export { WALK_POSES, ORDER as POSE_ORDER };
