# Bundled Models

Put client-shipped GGUF models in this folder before running `npm run dist`.

```text
models/
  embeddings/
    bge-m3.gguf
  llm/
    qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf
    qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf
```

The app auto-detects:

- `models/embeddings/*.gguf` as the local embedding model.
- `models/llm/*.gguf` as the default local answer model.

For split GGUF models, keep every shard in the same folder. The app loads the
`00001-of-xxxxx.gguf` shard as the entrypoint.
