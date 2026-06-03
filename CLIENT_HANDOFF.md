# Client Handoff

## Recommended package

Send the client:

```text
Blue-RAG-Setup-0.2.5.exe
```

This build can include the local `bge-m3` embedding model, so the client does
not need to run `ollama pull bge-m3` in PowerShell.

The current packaged build includes:

```text
models/embeddings/bge-m3.gguf
```

It does not include an answer model unless you add one under `models/llm/`
before building.

## Answer model

The client still needs an answer model. You have two clean options:

1. Bundle it before building:

```text
models/llm/
  qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf
  qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf
```

Then run:

```powershell
npm.cmd run dist
```

2. Send the GGUF model folder separately and ask the client to choose it inside
the app using `Locate GGUF folder` or `Choose GGUF file`.

## Best client experience

For a no-command-line client install, bundle both:

```text
models/embeddings/bge-m3.gguf
models/llm/<answer-model>.gguf
```

Then send only:

```text
release/Blue-RAG-Setup-0.2.5.exe
```
