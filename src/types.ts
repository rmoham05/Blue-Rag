export type AppConfig = {
  ollamaBaseUrl: string;
  llmModel: string;
  embedModel: string;
  dataDir: string;
  chunkChars: number;
  chunkOverlap: number;
  topK: number;
  port: number;
};

export type IndexedFolder = {
  path: string;
  addedAt: string;
};

export type ChunkRecord = {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    filePath: string;
    fileName: string;
    extension: string;
    modifiedMs: number;
    sizeBytes: number;
    sha256: string;
    chunkIndex: number;
    page?: number;
  };
};

export type IndexStatus = {
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  filesSeen: number;
  filesIndexed: number;
  chunksIndexed: number;
  errors: Array<{ file?: string; message: string }>;
};
