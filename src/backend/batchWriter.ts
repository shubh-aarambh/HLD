import { Database } from './db.js';
import { DistributedCacheManager } from './cache.js';

interface BufferedUpdate {
  countIncrement: number;
  newTimestamps: number[];
}

export class BatchWriter {
  private db: Database;
  private cacheManager: DistributedCacheManager;
  
  private buffer: Map<string, BufferedUpdate> = new Map();
  private flushTimer: NodeJS.Timeout | null = null;
  
  private flushPeriodMs: number;
  private maxBatchSize: number;

  // Metrics
  public totalSearchesReceived = 0;
  public totalDbSavesPerformed = 0; // Number of times db.save() was called

  constructor(
    db: Database,
    cacheManager: DistributedCacheManager,
    flushPeriodMs = 5000,
    maxBatchSize = 20
  ) {
    this.db = db;
    this.cacheManager = cacheManager;
    this.flushPeriodMs = flushPeriodMs;
    this.maxBatchSize = maxBatchSize;
    this.startTimer();
  }

  // Start the background periodic flush timer
  private startTimer() {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushPeriodMs);
  }

  // Stop the timer (useful for clean shutdown)
  public stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // Add a search query to the write buffer
  public addSearch(query: string) {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return;

    this.totalSearchesReceived++;

    const existing = this.buffer.get(lowerQuery);
    if (existing) {
      existing.countIncrement++;
      existing.newTimestamps.push(Date.now());
    } else {
      this.buffer.set(lowerQuery, {
        countIncrement: 1,
        newTimestamps: [Date.now()]
      });
    }

    // If buffer size (number of unique queries) exceeds threshold, flush immediately
    if (this.buffer.size >= this.maxBatchSize) {
      console.log(`Batch size threshold (${this.maxBatchSize}) reached. Flushing immediately...`);
      this.flush();
    }
  }

  // Flush the buffered writes to the database
  public flush() {
    if (this.buffer.size === 0) {
      return;
    }

    // Save a copy of updates to apply
    const updatesToApply = new Map(this.buffer);
    
    // Clear buffer before DB write to avoid race conditions
    this.buffer.clear();
    
    console.log(`Flushing batch of ${updatesToApply.size} unique queries to DB...`);
    
    // 1. Apply writes to primary database
    this.db.applyBatchUpdates(updatesToApply);
    this.totalDbSavesPerformed++;

    // 2. Invalidate cache prefixes for all updated queries
    // E.g., if "iphone" was searched, we must clear caches for "i", "ip", "iph", etc.
    // because their counts have increased, which might change autocomplete suggestions.
    for (const query of updatesToApply.keys()) {
      this.cacheManager.invalidatePrefixesForQuery(query);
    }
  }

  // Get current state of the buffer
  public getBufferState() {
    const items: { query: string; count: number }[] = [];
    for (const [query, data] of this.buffer.entries()) {
      items.push({ query, count: data.countIncrement });
    }
    return {
      size: this.buffer.size,
      items
    };
  }

  // Get metrics including DB write savings
  public getMetrics() {
    // If we didn't batch, we would write to disk for every search query (or update the db file synchronously).
    // The number of writes saved is: totalSearchesReceived - totalDbSavesPerformed
    const writesSaved = Math.max(0, this.totalSearchesReceived - this.totalDbSavesPerformed);
    const writeReductionRate = this.totalSearchesReceived > 0
      ? (writesSaved / this.totalSearchesReceived)
      : 0;

    return {
      totalSearchesReceived: this.totalSearchesReceived,
      totalDbSavesPerformed: this.totalDbSavesPerformed,
      writesSaved,
      writeReductionRate: Math.round(writeReductionRate * 1000) / 10 // Percentage, e.g. 95.5%
    };
  }
}
