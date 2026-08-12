// Convert preflop_equity.json -> preflop_equity.js (embed as JS module)
// Compact: { "AA": [eq1,eq2,...eq8], ... } array indexed by opp count 1-8
const fs = require('fs');
const json = JSON.parse(fs.readFileSync('preflop_equity.json', 'utf8'));
const out = {};
for (const [key, obj] of Object.entries(json)) {
  out[key] = [1,2,3,4,5,6,7,8].map(n => obj[n]);
}
const js = `// 预计算翻前胜率表（对随机对手）
// 由 gen_preflop_equity.js 生成。key -> [eq1,eq2,...eq8]
module.exports = ${JSON.stringify(out)};\n`;
fs.writeFileSync('preflop_equity.js', js);
console.log('Embedded preflop_equity.js, keys:', Object.keys(out).length);
console.log('AA:', out['AA']);
