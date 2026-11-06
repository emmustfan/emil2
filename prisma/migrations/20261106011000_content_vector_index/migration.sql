CREATE INDEX content_chunk_embedding_idx ON "ContentChunk" USING hnsw (embedding vector_cosine_ops);
