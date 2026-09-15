const http = require('http');

http.get('http://127.0.0.1:9222/json', res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    const list = JSON.parse(d);
    const p = list.find(x => x.url.includes('localhost:3000/index.html'));
    if (!p) return console.log('Page not found');
    const ws = new WebSocket(p.webSocketDebuggerUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `(() => {
            const dBtn = document.getElementById('btnEnterDemo');
            if (dBtn) dBtn.click();
            const el = document.querySelector('.sidebar-bottom');
            const fn = document.querySelector('.sidebar-footnote');
            const btn = document.querySelector('.sidebar-footnote .text-button');
            const rEl = el ? el.getBoundingClientRect() : null;
            const rFn = fn ? fn.getBoundingClientRect() : null;
            const rBtn = btn ? btn.getBoundingClientRect() : null;
            const navD = document.getElementById('navDialog');
            if (navD && !navD.open) navD.showModal();
            const sbM = navD ? navD.querySelector('.sidebar-bottom') : null;
            const fnM = navD ? navD.querySelector('.sidebar-footnote') : null;
            const btnM = fnM ? fnM.querySelector('.text-button') : null;
            const spanM = fnM ? fnM.querySelector('span') : null;

            return {
              desktop: {
                sidebarBottomHeight: rEl ? rEl.height : null,
                footnoteHeight: rFn ? rFn.height : null,
                alignItems: fn ? getComputedStyle(fn).alignItems : null
              },
              mobileNavDialog: {
                bottomHeight: sbM ? sbM.getBoundingClientRect().height : null,
                fnHeight: fnM ? fnM.getBoundingClientRect().height : null,
                btnTop: btnM ? btnM.getBoundingClientRect().top : null,
                spanTop: spanM ? spanM.getBoundingClientRect().top : null,
                btnHeight: btnM ? btnM.getBoundingClientRect().height : null,
                alignItems: fnM ? getComputedStyle(fnM).alignItems : null
              }
            };
          })()`,
          returnByValue: true
        }
      }));
    };
    ws.onmessage = msg => {
      const data = JSON.parse(msg.data);
      console.log(JSON.stringify(data?.result?.result?.value || data, null, 2));
      ws.close();
      process.exit(0);
    };
  });
});
