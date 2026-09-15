const fs = require('fs');
const html = fs.readFileSync('dist/index.html', 'utf8');

console.log('Has workspace-arrow in HTML:', html.includes('workspace-arrow'));
console.log('Raw unicode arrowhead present:', html.includes('⌄'));
const m = html.match(/class="workspace-switch"[\s\S]*?<\/button>/);
if (m) console.log('Rendered button:\n', m[0]);
