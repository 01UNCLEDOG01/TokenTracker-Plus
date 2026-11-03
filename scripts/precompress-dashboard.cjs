const fs = require("node:fs/promises");
const path = require("node:path");
const { gzip } = require("node:zlib");
const { promisify } = require("node:util");
const compress = promisify(gzip);

async function precompressDashboard(dist) {
  const assets = path.join(dist, "assets");
  let count = 0;
  for (const entry of await fs.readdir(assets, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(js|css)$/.test(entry.name)) continue;
    const target = path.join(assets, entry.name);
    const body = await fs.readFile(target);
    if (body.length < 1024) continue;
    await fs.writeFile(`${target}.gz`, await compress(body, { level: 9 }));
    count++;
  }
  console.log(`Precompressed ${count} dashboard assets.`);
}

if (require.main === module) {
  precompressDashboard(path.resolve(__dirname, "../dashboard/dist")).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { precompressDashboard };
