export async function* sseData(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      signal?.throwIfAborted();
      const result = await reader.read();
      buffer = (
        buffer + decoder.decode(result.value, { stream: !result.done })
      ).replace(/\r\n/g, "\n");
      if (buffer.length > 2_000_000)
        throw new Error("Provider event too large");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) yield data;
      }
      if (result.done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
