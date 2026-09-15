const fs = require('fs');
const files = ['src/app/index.template.html'];
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const c = fs.readFileSync(file, 'utf8');
  const lines = c.split('\n');
  lines.forEach((l, i) => {
    if (l.includes('href="#"') || l.includes("href='#'") || l.includes('location.hash')) {
      console.log(file, i + 1, l.trim());
    }
  });
}
