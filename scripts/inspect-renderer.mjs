const target = await (await fetch('http://127.0.0.1:9223/json')).json();
const wsUrl = target[0].webSocketDebuggerUrl;
const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise(resolve => {
  const messageId = ++id;
  pending.set(messageId, resolve);
  ws.send(JSON.stringify({ id: messageId, method, params }));
});

ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded' || message.method === 'Runtime.consoleAPICalled') {
    console.log('EVENT', JSON.stringify(message, null, 2));
  }
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};

await new Promise(resolve => ws.onopen = resolve);
await send('Runtime.enable');
await send('Log.enable');
await new Promise(resolve => setTimeout(resolve, 1000));
const evalResult = await send('Runtime.evaluate', {
  expression: `({
    html: document.body.innerHTML,
    scripts: [...document.scripts].map(s => s.src),
    links: [...document.styleSheets].map(s => s.href),
    rootText: document.getElementById('root')?.innerText,
    hasLocalRag: !!window.localRag,
    location: location.href
  })`,
  returnByValue: true,
  awaitPromise: true
});
console.log('EVAL', JSON.stringify(evalResult, null, 2));
ws.close();
