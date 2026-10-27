// Helpers that turn assets/meta.json into the tables the simulation needs.
export function simTables(meta) {
  const anims = {};
  for (const id of Object.keys(meta.units)) {
    anims[id] = {};
    for (const [state, c] of Object.entries(meta.units[id].clips)) anims[id][state] = { n: c.n, hit: c.hit };
  }
  return { anims, hitzone: meta.hitzone };
}
