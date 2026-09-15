const fs = require('fs');
const lines = fs.readFileSync('src/app/index.template.html', 'utf8').split('\n');
lines.forEach((l, idx) => {
  if (l.includes('authScreen') || l.includes('loginGoogleButton') || l.includes('auth-screen')) {
    console.log(`Line ${idx+1}: ${l.slice(0, 150)}`);
  }
});
