const base = 'http://127.0.0.1:3344';
const post = async (path, body = {}) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
};

console.log('health', await (await fetch(`${base}/health`)).json());
console.log('folders', await post('/folders', { path: new URL('../test-docs', import.meta.url).pathname.replace(/^\//, '') }));
console.log('index', await post('/index/run'));
const answer = await post('/chat/ask', { question: 'سیاست امنیتی شرکت درباره سرویس‌های ابری چیست؟' });
console.log(JSON.stringify(answer, null, 2));
