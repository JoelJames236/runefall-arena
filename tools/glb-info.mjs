// Print a GLB's skin and mesh summary: node tools/glb-info.mjs <file.glb> [...]
import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  try {
    const b = readFileSync(f), n = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + n).toString());
    const tris = (j.meshes || []).reduce((s, m) => s + m.primitives.reduce((t, p) => t + (p.indices !== undefined ? j.accessors[p.indices].count / 3 : 0), 0), 0);
    console.log(f.split(/[\\/]/).pop(), 'skins', (j.skins || []).length, 'joints', j.skins?.[0]?.joints.length ?? 0, 'tris', tris, 'kB', (b.length / 1024) | 0);
  } catch (e) { console.log(f, 'error', e.message); }
}
