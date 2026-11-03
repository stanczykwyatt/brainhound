// Where an HDF5 file's bytes come from: a local file, or a URL read a piece at a time with HTTP
// range requests, so a slice of a 10 GB recording costs a few hundred kilobytes, not 10 GB.
import { open } from "node:fs/promises";

/** Reads from a file on disk. Opened read-only and closed after each read. */
export class FileSource {
  constructor(path) {
    this.path = path;
    this.name = path;
  }

  async size() {
    const handle = await open(this.path, "r");
    try {
      return (await handle.stat()).size;
    } finally {
      await handle.close();
    }
  }

  async read(offset, length) {
    const handle = await open(this.path, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead < length) throw new RangeError(`The file ends before byte ${offset + length}.`);
      return buffer;
    } finally {
      await handle.close();
    }
  }
}

const BLOCK = 64 * 1024;

/**
 * Reads from a URL with range requests. Small reads, like the file's own bookkeeping, go through a
 * cache of 64 KB blocks, since they cluster; big reads, like compressed chunks, go straight through.
 */
export class HttpSource {
  constructor(url, net, { cacheBlocks = 512 } = {}) {
    this.url = url;
    this.name = url;
    this.net = net;
    this.cacheBlocks = cacheBlocks;
    this.blocks = new Map();
    this.pending = new Map();
    this.requests = 0;
    this.bytes = 0;
  }

  async size() {
    if (this.length === undefined) await this.block(0);
    return this.length;
  }

  async fetchRange(start, end) {
    this.requests++;
    const { body, total } = await this.net.range(this.url, start, end);
    this.bytes += body.length;
    if (total !== undefined) this.length = total;
    return body;
  }

  block(index) {
    const cached = this.blocks.get(index);
    if (cached) {
      // Refresh its place, so the cache drops the least recently used block first.
      this.blocks.delete(index);
      this.blocks.set(index, cached);
      return cached;
    }
    if (this.pending.has(index)) return this.pending.get(index);
    const start = index * BLOCK;
    const end = this.length === undefined ? start + BLOCK - 1 : Math.min(start + BLOCK, this.length) - 1;
    const promise = this.fetchRange(start, end)
      .then((body) => {
        this.blocks.set(index, body);
        while (this.blocks.size > this.cacheBlocks) this.blocks.delete(this.blocks.keys().next().value);
        return body;
      })
      .finally(() => this.pending.delete(index));
    this.pending.set(index, promise);
    return promise;
  }

  async read(offset, length) {
    if (length === 0) return Buffer.alloc(0);
    if (this.length !== undefined && offset + length > this.length) throw new RangeError(`The file ends before byte ${offset + length}.`);
    if (length >= 4 * BLOCK) return this.fetchRange(offset, offset + length - 1);
    const first = Math.floor(offset / BLOCK);
    const last = Math.floor((offset + length - 1) / BLOCK);
    const parts = [];
    for (let i = first; i <= last; i++) parts.push(this.block(i));
    const joined = Buffer.concat(await Promise.all(parts));
    const from = offset - first * BLOCK;
    if (joined.length < from + length) throw new RangeError(`The file ends before byte ${offset + length}.`);
    return joined.subarray(from, from + length);
  }
}
