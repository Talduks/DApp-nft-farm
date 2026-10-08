const fs = require("fs");
const path = require("path");

/** Reads deployments/<network>.json written by scripts/deploy.cjs. */
function loadDeployment(networkName) {
    const file = path.join(__dirname, "..", "..", "deployments", `${networkName}.json`);
    if (!fs.existsSync(file)) {
        throw new Error(`No deployment for ${networkName}: run the deploy script first or set the *_ADDRESS variables (${file} not found)`);
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

module.exports = { loadDeployment, chunk };
