const fs = require('fs');
const c = fs.readFileSync('src/app/index.template.html', 'utf8');
const lines = c.split('\n');
lines.forEach((l, i) => {
  if (l.includes('location.hash') || l.includes('href="#') || l.includes('history.pushState') || l.includes('history.replaceState') || l.includes('popstate') || l.includes('hashchange')) {
    console.log(i + 1, l.slice(0, 120));
  }
});
