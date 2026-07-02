// Block type registry. Extensible data table — later phases add fields here
// (hardness/tool tier for gated breaking, drops for inventory, etc.) without
// touching the meshing or interaction code.

export const BLOCK_AIR = 0

export const BLOCKS = {
  [BLOCK_AIR]: { id: BLOCK_AIR, name: 'Air', solid: false },
  1: {
    id: 1,
    name: 'Grass',
    solid: true,
    // Per-face colors: grassy top, mossy-earth sides, dirt underside.
    color: { top: 0x5d9c3f, side: 0x79893f, bottom: 0x8a5f3c },
  },
  2: {
    id: 2,
    name: 'Dirt',
    solid: true,
    color: { top: 0x8a5f3c, side: 0x8a5f3c, bottom: 0x7a5233 },
  },
  3: {
    id: 3,
    name: 'Stone',
    solid: true,
    color: { top: 0x9a9a9a, side: 0x8d8d8d, bottom: 0x7f7f7f },
  },
  4: {
    id: 4,
    name: 'Sand',
    solid: true,
    color: { top: 0xdccf94, side: 0xd2c489, bottom: 0xc2b47c },
  },
}

// Blocks the player can currently place (hotkeys 1..N). Phase 3's inventory
// replaces this hardcoded list as the source of placeable blocks.
export const PLACEABLE_BLOCK_IDS = [1, 2, 3, 4]

export function isSolid(id) {
  const block = BLOCKS[id]
  return block ? block.solid : false
}
