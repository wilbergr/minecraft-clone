// Crafting recipe table. Shapeless list-crafting: a recipe consumes `input`
// item counts from anywhere in the inventory and yields `output`. The
// crafting panel renders straight from this table, so extending progression
// (new tools, treasure items, furnace tiers) is just more rows.
//
// Progression: wood → planks → sticks → wooden tools, then stone tools from
// mined stone, then a furnace from stone. Iron ore smelts to ingots in the
// furnace (Phase 12 — see SMELT_RECIPES below), then iron tools.

export const RECIPES = [
  { id: 'planks', input: [['wood', 1]], output: ['planks', 4] },
  { id: 'sticks', input: [['planks', 2]], output: ['stick', 4] },
  { id: 'wooden_pickaxe', input: [['planks', 3], ['stick', 2]], output: ['wooden_pickaxe', 1] },
  { id: 'wooden_axe', input: [['planks', 3], ['stick', 2]], output: ['wooden_axe', 1] },
  { id: 'wooden_sword', input: [['planks', 2], ['stick', 1]], output: ['wooden_sword', 1] },
  { id: 'stone_pickaxe', input: [['stone', 3], ['stick', 2]], output: ['stone_pickaxe', 1] },
  { id: 'stone_axe', input: [['stone', 3], ['stick', 2]], output: ['stone_axe', 1] },
  { id: 'stone_sword', input: [['stone', 2], ['stick', 1]], output: ['stone_sword', 1] },
  { id: 'furnace', input: [['stone', 8]], output: ['furnace', 1] },
  // Chest (inventory overhaul): the furnace's 8-around shape in wood.
  { id: 'chest', input: [['planks', 8]], output: ['chest', 1] },
  // Bed (sleep to set your spawn point): wool comes from sheep, MC-style.
  { id: 'bed', input: [['planks', 3], ['wool', 3]], output: ['bed', 1] },
  { id: 'iron_pickaxe', input: [['iron_ingot', 3], ['stick', 2]], output: ['iron_pickaxe', 1] },
  { id: 'iron_axe', input: [['iron_ingot', 3], ['stick', 2]], output: ['iron_axe', 1] },
  { id: 'iron_sword', input: [['iron_ingot', 2], ['stick', 1]], output: ['iron_sword', 1] },
  // Diamond tools (top tier): gems mined from deep diamond ore (iron pick
  // required), mirroring the iron recipe shapes.
  { id: 'diamond_pickaxe', input: [['diamond', 3], ['stick', 2]], output: ['diamond_pickaxe', 1] },
  { id: 'diamond_axe', input: [['diamond', 3], ['stick', 2]], output: ['diamond_axe', 1] },
  { id: 'diamond_sword', input: [['diamond', 2], ['stick', 1]], output: ['diamond_sword', 1] },
  { id: 'diamond_shovel', input: [['diamond', 1], ['stick', 2]], output: ['diamond_shovel', 1] },
  // Ranged combat (Phase 13). No string or flint items exist, so the bow is
  // all wood and arrows are stick + stone — skeletons also drop arrows.
  { id: 'bow', input: [['stick', 3], ['planks', 2]], output: ['bow', 1] },
  { id: 'arrow', input: [['stick', 1], ['stone', 1]], output: ['arrow', 4] },
  // Torches (Phase 11 left this "no recipe yet" — closed with the King's
  // Trial: cave diving for the Deep Shard needs light the honest way).
  { id: 'torch', input: [['stick', 1], ['coal', 1]], output: ['torch', 4] },
  // Flint & steel (the Nether): no flint item exists — iron + coal is the
  // documented divergence (the bow's "no string" precedent above).
  { id: 'flint_and_steel', input: [['iron_ingot', 1], ['coal', 1]], output: ['flint_and_steel', 1] },
  // Quartz block (N4): the mined gem's decorative sink — 4 gems compress
  // into one clean white building block.
  { id: 'quartz_block', input: [['quartz', 4]], output: ['quartz_block', 1] },
  // Armor (Phase 13): leather from cows, iron from smelted ingots. Right
  // click a piece to wear it.
  { id: 'leather_helmet', input: [['leather', 5]], output: ['leather_helmet', 1] },
  { id: 'leather_chestplate', input: [['leather', 8]], output: ['leather_chestplate', 1] },
  { id: 'leather_leggings', input: [['leather', 7]], output: ['leather_leggings', 1] },
  { id: 'leather_boots', input: [['leather', 4]], output: ['leather_boots', 1] },
  { id: 'iron_helmet', input: [['iron_ingot', 5]], output: ['iron_helmet', 1] },
  { id: 'iron_chestplate', input: [['iron_ingot', 8]], output: ['iron_chestplate', 1] },
  { id: 'iron_leggings', input: [['iron_ingot', 7]], output: ['iron_leggings', 1] },
  { id: 'iron_boots', input: [['iron_ingot', 4]], output: ['iron_boots', 1] },
  { id: 'diamond_helmet', input: [['diamond', 5]], output: ['diamond_helmet', 1] },
  { id: 'diamond_chestplate', input: [['diamond', 8]], output: ['diamond_chestplate', 1] },
  { id: 'diamond_leggings', input: [['diamond', 7]], output: ['diamond_leggings', 1] },
  { id: 'diamond_boots', input: [['diamond', 4]], output: ['diamond_boots', 1] },
]

// --- Smelting (Phase 12) ----------------------------------------------------
// The furnace transforms `input item id → { output, seconds }` while it has
// fuel. `seconds` is game time with the pointer locked (or the furnace UI
// open); progress decays when the furnace loses fuel or its input.

export const SMELT_RECIPES = {
  iron_ore: { output: 'iron_ingot', seconds: 10 },
  raw_porkchop: { output: 'cooked_porkchop', seconds: 6 },
  raw_beef: { output: 'cooked_beef', seconds: 6 },
  raw_mutton: { output: 'cooked_mutton', seconds: 6 },
}

// Burn time per fuel item. Wood-family fuels are the baseline; `coal` is
// listed so a coal item (Phase 11) starts working with zero furnace changes.
export const FUEL_SECONDS = {
  wood: 15,
  planks: 15,
  stick: 5,
  coal: 80,
  netherrack: 15, // the Nether's native furnace fuel (N2)
}

export function canCraft(inventory, recipe) {
  return recipe.input.every(([id, count]) => inventory.countOf(id) >= count)
}

// Consume the inputs and add the output. Returns false (touching nothing) if
// ingredients are missing; crafting with a full inventory drops the overflow
// (acceptable until ground items exist — the UI disables the button instead).
export function craft(inventory, recipe) {
  if (!canCraft(inventory, recipe)) return false
  for (const [id, count] of recipe.input) inventory.consume(id, count)
  inventory.add(recipe.output[0], recipe.output[1])
  return true
}
