const fs = require('fs');
const path = require('path');

// 合并 9 个 JS 文件为 bundle.js (保持原加载顺序)
const order = ['rules', 'audio', 'p2p', 'auth', 'ui', 'gomoku', 'go', 'mahjong', 'xiangqi', 'main'];
let bundle = '';
order.forEach(name => {
    const content = fs.readFileSync(path.join('js', name + '.js'), 'utf8');
    bundle += `/* ===== js/${name}.js ===== */\n` + content + '\n';
});

fs.writeFileSync('js/bundle.js', bundle, 'utf8');
console.log('bundle.js 大小:', Buffer.byteLength(bundle), 'bytes');
console.log('合并完成:', order.join(' + '));
