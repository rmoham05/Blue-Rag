import { FormEvent, useEffect, useMemo, useState } from 'react';
import blueRagIcon from './assets/blue-rag-icon.png';

const API = 'http://127.0.0.1:3344';

type Folder = { path: string; addedAt: string };
type Source = { id: number; score: number; file: string; fileName: string; chunkIndex: number; snippet: string };
type ChatMessage = { role: 'user' | 'assistant'; text: string; sources?: Source[] };
type Health = { ok: boolean; config: { llmModel: string; embedModel: string; dataDir: string }; ollama: { models?: Array<{ name: string; size: number }> ; error?: string } };
type IndexStatus = { running: boolean; filesSeen: number; filesIndexed: number; chunksIndexed: number; errors: Array<{ file?: string; message: string }>; startedAt?: string; finishedAt?: string };
type ModelOption = { name: string; family: string };
type ModelSettings = { current: { llmModel: string; embedModel: string }; models: ModelOption[] };
type LocalModelFile = { filePath: string; fileName: string; sizeBytes: number; modifiedAt: string; isSplit?: boolean; shardCount?: number; shardFiles?: string[]; displayName?: string };
type LocalModelLibrary = { folderPath?: string; files: LocalModelFile[] };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(options?.headers ?? {})
    }
  });
  if (!res.ok) {
    const raw = await res.text();
    let message = raw;
    try {
      const parsed = JSON.parse(raw) as { message?: string; error?: string };
      message = parsed.message ?? parsed.error ?? raw;
    } catch {
      message = raw;
    }
    throw new Error(`${res.status}: ${message}`);
  }
  return res.json();
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [modelSettings, setModelSettings] = useState<ModelSettings | null>(null);
  const [localModelLibrary, setLocalModelLibrary] = useState<LocalModelLibrary | null>(null);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyStartedAt, setBusyStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [workLabel, setWorkLabel] = useState('');
  const [notice, setNotice] = useState<string>('');

  const ollamaReady = useMemo(() => Boolean(health?.ollama?.models?.length), [health]);
  const localLlmReady = useMemo(() => Boolean(health?.config?.llmModel?.startsWith('llamacpp:')), [health]);
  const localEmbeddingReady = useMemo(() => Boolean(health?.config?.embedModel?.startsWith('llamacpp:')), [health]);
  const runtimeReady = useMemo(() => Boolean((ollamaReady || localLlmReady) && (ollamaReady || localEmbeddingReady)), [ollamaReady, localLlmReady, localEmbeddingReady]);
  const runtimeLabel = useMemo(() => {
    if (!runtimeReady) return 'Missing';
    if (localLlmReady && localEmbeddingReady) return 'Local GGUF';
    if (ollamaReady && (localLlmReady || localEmbeddingReady)) return 'Hybrid';
    return 'Ollama';
  }, [runtimeReady, localLlmReady, localEmbeddingReady, ollamaReady]);
  const answerModelOptions = useMemo(() => {
    const models = modelSettings?.models ?? [];
    const current = modelSettings?.current.llmModel;
    if (!current || models.some(model => model.name === current)) return models;
    return [{ name: current, family: current.startsWith('llamacpp:') ? 'llama.cpp' : 'current' }, ...models];
  }, [modelSettings]);
  const embeddingModelOptions = useMemo(() => {
    const models = modelSettings?.models ?? [];
    const current = modelSettings?.current.embedModel;
    if (!current || models.some(model => model.name === current)) return models;
    return [{ name: current, family: 'current' }, ...models];
  }, [modelSettings]);

  async function refresh() {
    const [h, f, s, m, l] = await Promise.all([
      request<Health>('/health'),
      request<Folder[]>('/folders'),
      request<IndexStatus>('/index/status'),
      request<ModelSettings>('/models'),
      request<LocalModelLibrary>('/local-models')
    ]);
    setHealth(h);
    setFolders(f);
    setIndexStatus(s);
    setModelSettings(m);
    setLocalModelLibrary(l);
  }

  useEffect(() => {
    refresh().catch(error => setNotice(error.message));
    const timer = setInterval(() => {
      request<IndexStatus>('/index/status').then(setIndexStatus).catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!busyStartedAt) {
      setElapsedSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - busyStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [busyStartedAt]);

  async function addFolder() {
    setNotice('');
    const selected = await window.localRag?.selectFolder();
    if (!selected) return;
    await request<Folder[]>('/folders', { method: 'POST', body: JSON.stringify({ path: selected }) });
    await refresh();
  }

  async function removeFolder(path: string) {
    await request<Folder[]>('/folders/remove', { method: 'POST', body: JSON.stringify({ path }) });
    setNotice('Folder removed and its indexed chunks were cleared.');
    await refresh();
  }

  async function updateModel(kind: 'llmModel' | 'embedModel', value: string) {
    const next = await request<{ llmModel: string; embedModel: string }>('/models', {
      method: 'POST',
      body: JSON.stringify({ [kind]: value })
    });
    setModelSettings(current => current ? { ...current, current: next } : current);
    setNotice(kind === 'embedModel'
      ? 'Embedding model changed. Click Index / re-index so the document index uses the new embedding model.'
      : 'Answer model changed. New questions will use the selected model.');
  }

  async function selectLocalModelFolder() {
    setNotice('');
    const selected = await window.localRag?.selectModelFolder();
    if (!selected) return;
    const library = await request<LocalModelLibrary>('/local-models/folder', {
      method: 'POST',
      body: JSON.stringify({ path: selected })
    });
    setLocalModelLibrary(library);
    setNotice(`Found ${library.files.length} GGUF model file(s).`);
  }

  async function chooseAndImportGgufFile() {
    setNotice('');
    const files = await window.localRag?.selectGgufFiles();
    const first = files?.[0];
    if (!first) return;
    try {
      const file = await request<LocalModelFile>('/local-models/file', {
        method: 'POST',
        body: JSON.stringify({ filePath: first })
      });
      await importLocalModel(file);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function importLocalModel(file: LocalModelFile) {
    setBusy(true);
    setBusyStartedAt(Date.now());
    setWorkLabel(file.isSplit ? 'Loading split GGUF with llama.cpp' : 'Importing local GGUF model into Ollama');
    try {
      if (file.isSplit) {
        const result = await request<{ modelPath: string; backend?: string; device?: string; gpuLayers?: string }>('/local-models/load-direct', {
          method: 'POST',
          body: JSON.stringify({ filePath: file.filePath })
        });
        const acceleration = result.backend && result.backend !== 'cpu'
          ? ` using ${result.backend}${result.device ? ` on ${result.device}` : ''}`
          : ' using CPU';
        setNotice(`Loaded split GGUF with llama.cpp${acceleration}: ${result.modelPath}`);
      } else {
        const result = await request<{ modelName: string }>('/local-models/import', {
          method: 'POST',
          body: JSON.stringify({ filePath: file.filePath })
        });
        setNotice(`Imported and selected model: ${result.modelName}`);
      }
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setBusyStartedAt(null);
      setWorkLabel('');
    }
  }

  async function loadSelectedModel() {
    setBusy(true);
    setBusyStartedAt(Date.now());
    setWorkLabel('Loading selected answer model');
    try {
      const modelName = modelSettings?.current.llmModel;
      await request('/models/load', { method: 'POST', body: JSON.stringify({ modelName }) });
      setNotice(`Loaded model: ${modelName}`);
    } finally {
      setBusy(false);
      setBusyStartedAt(null);
      setWorkLabel('');
    }
  }

  async function ejectSelectedModel() {
    const modelName = modelSettings?.current.llmModel;
    await request('/models/eject', { method: 'POST', body: JSON.stringify({ modelName }) });
    setNotice(`Ejected model: ${modelName}`);
  }

  const formatSize = (bytes: number) => `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;

  async function runIndex() {
    setBusy(true);
    setBusyStartedAt(Date.now());
    setWorkLabel('Indexing documents locally');
    setNotice('Indexing documents locally...');
    try {
      const status = await request<IndexStatus>('/index/run', { method: 'POST', body: '{}' });
      setIndexStatus(status);
      const summary = `Indexed ${status.filesIndexed} file(s), ${status.chunksIndexed} chunk(s).`;
      setNotice(status.errors.length ? `${summary} ${status.errors.length} file(s) could not be indexed.` : summary);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setBusyStartedAt(null);
      setWorkLabel('');
    }
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    const q = question.trim();
    if (!q) return;
    setQuestion('');
    setMessages(current => [...current, { role: 'user', text: q }]);
    setBusy(true);
    setBusyStartedAt(Date.now());
    setWorkLabel('Retrieving sources and generating locally');
    try {
      const result = await request<{ answer: string; sources: Source[] }>('/chat/ask', {
        method: 'POST',
        body: JSON.stringify({ question: q, top_k: 4 })
      });
      setMessages(current => [...current, { role: 'assistant', text: result.answer, sources: result.sources }]);
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', text: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setBusy(false);
      setBusyStartedAt(null);
      setWorkLabel('');
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="logo" src={blueRagIcon} alt="" />
          <div>
            <h1>Blue RAG</h1>
            <p>Offline multilingual knowledge assistant</p>
          </div>
        </div>

        <section className="card">
          <h2>Status</h2>
          <div className="status-row"><span>Runtime</span><b className={runtimeReady ? 'ok' : 'bad'}>{runtimeLabel}</b></div>
          <div className="status-row"><span>LLM</span><b>{health?.config?.llmModel ?? '...'}</b></div>
          <div className="status-row"><span>Embeddings</span><b>{health?.config?.embedModel ?? '...'}</b></div>
          <div className="status-row"><span>Mode</span><b>100% local</b></div>
        </section>

        <section className="card">
          <h2>Folders</h2>
          <button className="primary" onClick={addFolder}>Add folder</button>
          <button onClick={runIndex} disabled={busy || !folders.length}>Index / re-index</button>
          <div className="folders">
            {folders.length === 0 && <p className="muted">No folders added yet.</p>}
            {folders.map(folder => (
              <div className="folder" key={folder.path}>
                <span>{folder.path}</span>
                <button onClick={() => removeFolder(folder.path)}>Remove</button>
              </div>
            ))}
          </div>
        </section>

        <section className="card compact">
          <h2>Index</h2>
          <div className="status-row"><span>Files seen</span><b>{indexStatus?.filesSeen ?? 0}</b></div>
          <div className="status-row"><span>Files indexed</span><b>{indexStatus?.filesIndexed ?? 0}</b></div>
          <div className="status-row"><span>Chunks</span><b>{indexStatus?.chunksIndexed ?? 0}</b></div>
          <div className="status-row"><span>Files skipped</span><b>{indexStatus?.errors?.length ?? 0}</b></div>
          {indexStatus?.errors?.length ? <p className="muted">Some files could not be indexed.</p> : <p className="ok">No skipped files</p>}
        </section>

        <section className="card compact">
          <h2>Models</h2>
          <label className="model-label">Answer model</label>
          <select value={modelSettings?.current.llmModel ?? ''} onChange={event => updateModel('llmModel', event.target.value)}>
            {answerModelOptions.map(model => <option key={model.name} value={model.name}>{model.name}</option>)}
          </select>
          <label className="model-label">Embedding model</label>
          <select value={modelSettings?.current.embedModel ?? ''} onChange={event => updateModel('embedModel', event.target.value)}>
            {embeddingModelOptions.map(model => <option key={model.name} value={model.name}>{model.name}</option>)}
          </select>
          <div className="model-actions">
            <button onClick={loadSelectedModel} disabled={busy || !modelSettings?.current.llmModel}>Load</button>
            <button onClick={ejectSelectedModel} disabled={busy || !modelSettings?.current.llmModel}>Eject</button>
          </div>
          <p className="muted">Use bundled GGUF models for client installs, or Ollama models during development.</p>
        </section>

        <section className="card compact">
          <h2>Local model files</h2>
          <button onClick={chooseAndImportGgufFile}>Choose GGUF file</button>
          <button onClick={selectLocalModelFolder}>Locate GGUF folder</button>
          <p className="muted">Folder picker shows folders only. Use “Choose GGUF file” if you want to see/select the model file directly.</p>
          {localModelLibrary?.folderPath && <div className="folder"><span>{localModelLibrary.folderPath}</span></div>}
          <div className="local-models">
            {(localModelLibrary?.files ?? []).slice(0, 8).map(file => (
              <div className="local-model" key={file.filePath}>
                <span>{file.displayName ?? file.fileName}</span>
                <small>{formatSize(file.sizeBytes)}{file.isSplit ? ` · split GGUF (${file.shardFiles?.length ?? '?'} parts)` : ''}</small>
                <button onClick={() => importLocalModel(file)} disabled={busy}>{file.isSplit ? 'Load with llama.cpp' : 'Import/select'}</button>
              </div>
            ))}
            {localModelLibrary && !localModelLibrary.files.length && <p className="muted">No .gguf files found in this folder.</p>}
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h2>Ask your local documents</h2>
            <p>Optimized for Persian/Farsi and multilingual private files. Nothing is sent to the cloud.</p>
          </div>
          <button onClick={() => refresh().catch(error => setNotice(error.message))}>Refresh</button>
        </header>

        {notice && <div className="notice">{notice}</div>}
        {busy && <div className="working-banner">{workLabel || 'Working'}… {elapsedSeconds}s elapsed. First local answer can take a minute while the model loads.</div>}

        <div className="chat">
          {messages.length === 0 && (
            <div className="empty">
              <h3>Ready for local document Q&A</h3>
              <p>Try: سیاست امنیتی شرکت درباره سرویس‌های ابری چیست؟</p>
            </div>
          )}
          {messages.map((message, index) => (
            <article className={`message ${message.role}`} key={index}>
              <div className="bubble" dir="auto">{message.text}</div>
              {message.sources?.length ? (
                <div className="sources">
                  {message.sources.map(source => (
                    <button key={`${source.file}-${source.chunkIndex}`} onClick={() => window.localRag?.openPath(source.file)}>
                      [{source.id}] {source.fileName} · {(source.score * 100).toFixed(1)}%
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>

        <form className="composer" onSubmit={ask}>
          <input
            value={question}
            onChange={event => setQuestion(event.target.value)}
            placeholder="Ask in Persian, English, or another supported language..."
            disabled={busy}
          />
          <button className="primary" disabled={busy || !question.trim()}>{busy ? `${elapsedSeconds}s...` : 'Ask'}</button>
        </form>
      </section>
    </main>
  );
}
