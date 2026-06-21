import express from 'express';
import cors from 'cors';
import * as path from 'path';
import { Database, QueryRecord } from './db.js';
import { DistributedCacheManager } from './cache.js';
import { BatchWriter } from './batchWriter.js';
import { performance } from 'perf_hooks';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Core System Components
const db = new Database();
const cacheNodes = ['CacheNode-A', 'CacheNode-B', 'CacheNode-C'];
const cacheManager = new DistributedCacheManager(cacheNodes, 30 * 1000); // 30s TTL
const batchWriter = new BatchWriter(db, cacheManager, 5000, 20); // 5s or 20 items

// Latency Tracking (Rolling window of last 1000 requests)
const latencyHistory: number[] = [];
const MAX_LATENCY_HISTORY = 1000;

function trackLatency(ms: number) {
  latencyHistory.push(ms);
  if (latencyHistory.length > MAX_LATENCY_HISTORY) {
    latencyHistory.shift();
  }
}

function getLatencyMetrics() {
  if (latencyHistory.length === 0) {
    return { avg: 0, p95: 0, count: 0 };
  }
  const sorted = [...latencyHistory].sort((a, b) => a - b);
  const avg = sorted.reduce((sum, val) => sum + val, 0) / sorted.length;
  const p95Index = Math.floor(sorted.length * 0.95);
  const p95 = sorted[p95Index];
  return {
    avg: Math.round(avg * 100) / 100,
    p95: Math.round(p95 * 100) / 100,
    count: latencyHistory.length
  };
}

// Recency Scoring Formula Implementation
// Score = log10(overallCount + 1) + recencyBoost
// recencyBoost = Sum_t ( 1 / (1 + (now - t) / halfLifeMs) )
function calculateRecencyScore(record: QueryRecord, now: number, halfLifeMs = 60 * 1000): number {
  const logPopularity = Math.log10(record.overallCount + 1);
  let recencyBoost = 0;
  
  for (const t of record.recentTimestamps) {
    const age = now - t;
    if (age > 0) {
      recencyBoost += 1 / (1 + (age / halfLifeMs));
    }
  }
  
  return logPopularity + recencyBoost;
}

// Suggestions API
// GET /suggest?q=<prefix>&ranking=<overall|recency>
app.get('/suggest', (req, res) => {
  const startTime = performance.now();
  const prefix = (req.query.q as string || '').toLowerCase().trim();
  const rankingType = (req.query.ranking as string || 'overall').toLowerCase().trim();

  if (!prefix) {
    trackLatency(performance.now() - startTime);
    return res.json({ suggestions: [], cacheHit: false, node: 'N/A' });
  }

  // Define unique cache key based on ranking mechanism to avoid collision
  const cacheKey = `${rankingType}:${prefix}`;

  try {
    // 1. Query Distributed Cache Ring
    const { suggestions: cachedSuggestions, nodeResponsible } = cacheManager.get(cacheKey);

    if (cachedSuggestions !== null) {
      const duration = performance.now() - startTime;
      trackLatency(duration);
      return res.json({
        suggestions: cachedSuggestions.map(s => s.query),
        cacheHit: true,
        node: nodeResponsible
      });
    }

    // 2. Cache Miss: Fall back to primary database
    const matches = db.getPrefixMatches(prefix);
    const now = Date.now();

    // 3. Apply ranking and select top 10
    let sortedMatches: QueryRecord[] = [];
    if (rankingType === 'recency') {
      sortedMatches = matches
        .map(record => ({
          record,
          score: calculateRecencyScore(record, now)
        }))
        .sort((a, b) => b.score - a.score)
        .map(item => item.record);
    } else {
      // Overall Count ranking
      sortedMatches = matches.sort((a, b) => b.overallCount - a.overallCount);
    }

    const top10 = sortedMatches.slice(0, 10);

    // 4. Update the responsible cache node
    cacheManager.set(cacheKey, top10);

    const duration = performance.now() - startTime;
    trackLatency(duration);

    res.json({
      suggestions: top10.map(s => s.query),
      cacheHit: false,
      node: nodeResponsible
    });
  } catch (err: any) {
    console.error('Error fetching suggestions:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Search Submission API
// POST /search
app.post('/search', (req, res) => {
  const query = (req.body.query as string || '').trim();

  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  // Submit to BatchWriter buffer
  batchWriter.addSearch(query);

  res.json({ message: 'Searched' });
});

// Debug Cache Routing API
// GET /cache/debug?prefix=<prefix>
app.get('/cache/debug', (req, res) => {
  const prefix = (req.query.prefix as string || '').toLowerCase().trim();

  if (!prefix) {
    return res.status(400).json({ error: 'Prefix query parameter is required' });
  }

  try {
    const debugInfo = cacheManager.getDebugInfo(prefix);
    res.json({
      prefix,
      responsibleNode: debugInfo.node,
      isCached: debugInfo.isCached,
      activeKeysOnNode: debugInfo.activeKeys
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Analytics & Dashboard API
// GET /analytics
app.get('/analytics', (req, res) => {
  // Fetch Top 10 Trending queries (Overall vs Recency)
  const allRecords = db.getAllRecords();
  const topOverall = [...allRecords]
    .sort((a, b) => b.overallCount - a.overallCount)
    .slice(0, 10)
    .map(r => ({ query: r.query, count: r.overallCount }));

  const now = Date.now();
  const topRecency = [...allRecords]
    .sort((a, b) => calculateRecencyScore(b, now) - calculateRecencyScore(a, now))
    .slice(0, 10)
    .map(r => ({
      query: r.query,
      count: r.overallCount,
      recentSearches: r.recentTimestamps.length,
      score: Math.round(calculateRecencyScore(r, now) * 100) / 100
    }));

  // Hash Ring distribution sample of top overall keys
  const sampleKeys = topOverall.map(item => item.query);
  const ringDistribution = cacheManager.getRingDistribution(sampleKeys);

  res.json({
    latency: getLatencyMetrics(),
    cache: cacheManager.getMetrics(),
    database: {
      reads: db.readCount,
      writes: db.writeCount
    },
    batch: {
      ...batchWriter.getMetrics(),
      buffer: batchWriter.getBufferState()
    },
    ring: {
      distribution: ringDistribution
    },
    trending: {
      overall: topOverall,
      recency: topRecency
    }
  });
});

// Admin Controls: Flush Batch Writer
app.post('/batch/flush', (req, res) => {
  batchWriter.flush();
  res.json({ message: 'Batch write buffer flushed to DB' });
});

// Admin Controls: Clear Distributed Cache
app.post('/cache/clear', (req, res) => {
  cacheManager.clearAll();
  res.json({ message: 'All cache nodes cleared' });
});

// Serve UI dashboard (static files)
const publicDir = path.resolve('src/frontend/public');
app.use(express.static(publicDir));

// Fallback to index.html for UI SPA routes
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start Express App
const server = app.listen(port, () => {
  console.log(`=================================================`);
  console.log(`Search Typeahead System running at http://localhost:${port}`);
  console.log(`Seeded with 105,000 queries. Happy searching!`);
  console.log(`=================================================`);
});

// Clean shutdown handler
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Shutting down batch writer...');
  batchWriter.flush();
  batchWriter.stop();
  server.close(() => {
    console.log('Http server closed.');
  });
});
process.on('SIGINT', () => {
  console.log('SIGINT signal received. Shutting down batch writer...');
  batchWriter.flush();
  batchWriter.stop();
  server.close(() => {
    console.log('Http server closed.');
    process.exit(0);
  });
});
