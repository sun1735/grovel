#!/usr/bin/env node
// 빌드 단계에서 외부 자산을 static 루트로 복사
// - lucide UMD: node_modules/lucide/dist/umd/lucide.min.js → /lucide.min.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const copies = [
  {
    src: path.join(root, 'node_modules', 'lucide', 'dist', 'umd', 'lucide.min.js'),
    dest: path.join(root, 'lucide.min.js'),
    label: 'lucide',
  },
];

for (const c of copies) {
  if (!fs.existsSync(c.src)) {
    console.error(`  ✗ ${c.label}: 소스 없음 ${c.src}`);
    process.exitCode = 1;
    continue;
  }
  fs.copyFileSync(c.src, c.dest);
  const size = Math.round(fs.statSync(c.dest).size / 1024);
  console.log(`  ✓ ${c.label} → ${path.basename(c.dest)} (${size}KB)`);
}
