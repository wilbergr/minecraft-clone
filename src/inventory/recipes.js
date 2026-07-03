// Crafting recipe table. Shapeless list-crafting: a recipe consumes `input`
// item counts from anywhere in the inventory and yields `output`. The
// crafting panel renders straight from this table, so extending progression
// (new tools, treasure items, furnace tiers) is just more rows.
//
// Progression: wood → planks → sticks → wooden tools, then stone tools from
// mined stone, then iron tools from iron ore. Iron ore → ingot is a direct
// craft for now — a furnace/smelting step can replace that row later.

export const RECIPES = [
  { id: 'planks', input: [['wood', 1]], output: ['planks', 4] },
  { id: 'sticks', input: [['planks', 2]], output: ['stick', 4] },
  { id: 'wooden_pickaxe', input: [['planks', 3], ['stick', 2]], output: ['wooden_pickaxe', 1] },
  { id: 'wooden_axe', input: [['planks', 3], ['stick', 2]], output: ['wooden_axe', 1] },
  { id: 'wooden_sword', input: [['planks', 2], ['stick', 1]], output: ['wooden_sword', 1] },
  { id: 'stone_pickaxe', input: [['stone', 3], ['stick', 2]], output: ['stone_pickaxe', 1] },
  { id: 'stone_axe', input: [['stone', 3], ['stick', 2]], output: ['stone_axe', 1] },
  { id: 'stone_sword', input: [['stone', 2], ['stick', 1]], output: ['stone_sword', 1] },
  { id: 'iron_ingot', input: [['iron_ore', 1]], output: ['iron_ingot', 1] },
  { id: 'iron_pickaxe', input: [['iron_ingot', 3], ['stick', 2]], output: ['iron_pickaxe', 1] },
  { id: 'iron_axe', input: [['iron_ingot', 3], ['stick', 2]], output: ['iron_axe', 1] },
  { id: 'iron_sword', input: [['iron_ingot', 2], ['stick', 1]], output: ['iron_sword', 1] },
]

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
