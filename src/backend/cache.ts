import { ConsistentHashRing } from './consistentHash.js';
import { QueryRecord } from './db.js';

interface CacheEntry {
  suggestions: QueryRecord[];
  expiry: number; // Epoch timestamp
}

export class CacheNode {
  public name: string;
  private store: Map<string, CacheEntry> = new Map();
  
  public hits = 0;
  public misses = 0;
  public totalRequests = 0;

  constructor(name: string) {
    this.name = name;
  }

  // Get cached suggestions if they exist and are not expired
  public get(key: string): QueryRecord[] | null {
    this.totalRequests++;
    const entry = this.store.get(key);
    
    if (!entry) {
      this.misses++;
      return null;
    }
    
    if (Date.now() > entry.expiry) {
      // Expired cache item
      this.store.delete(key);
      this.misses++;
      return null;
    }
    
    this.hits++;
    return entry.suggestions;
  }

  // Store suggestions in cache with a relative TTL in milliseconds
  public set(key: string, suggestions: QueryRecord[], ttlMs: number) {
    const expiry = Date.now() + ttlMs;
    this.store.set(key, { suggestions, expiry });
  }

  // Invalidate specific cache key
  public delete(key: string) {
    this.store.delete(key);
  }

  // Clear all items in this cache node
  public clear() {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
    this.totalRequests = 0;
  }

  // Get size of cache
  public getSize(): number {
    // Purge expired keys before counting to represent actual active cache size
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiry) {
        this.store.delete(key);
      }
    }
    return this.store.size;
  }

  // Get all active keys (for debugging)
  public getActiveKeys(): string[] {
    const now = Date.now();
    const keys: string[] = [];
    for (const [key, entry] of this.store.entries()) {
      if (now <= entry.expiry) {
        keys.push(key);
      }
    }
    return keys;
  }
}

export class DistributedCacheManager {
  private nodes: Map<string, CacheNode> = new Map();
  private ring: ConsistentHashRing;
  private defaultTtlMs: number;

  constructor(nodeNames: string[], defaultTtlMs = 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
    this.ring = new ConsistentHashRing(nodeNames);
    for (const name of nodeNames) {
      this.nodes.set(name, new CacheNode(name));
    }
  }

  // Fetch suggestions from the appropriate cache node
  public get(prefix: string): { suggestions: QueryRecord[] | null; nodeResponsible: string } {
    const lowerPrefix = prefix.toLowerCase().trim();
    const nodeName = this.ring.getNode(lowerPrefix);
    const node = this.nodes.get(nodeName);
    
    if (!node) {
      throw new Error(`Cache node ${nodeName} not found in manager.`);
    }

    const suggestions = node.get(lowerPrefix);
    return { suggestions, nodeResponsible: nodeName };
  }

  // Put suggestions in the appropriate cache node
  public set(prefix: string, suggestions: QueryRecord[], ttlMs = this.defaultTtlMs) {
    const lowerPrefix = prefix.toLowerCase().trim();
    const nodeName = this.ring.getNode(lowerPrefix);
    const node = this.nodes.get(nodeName);
    
    if (node) {
      node.set(lowerPrefix, suggestions, ttlMs);
    }
  }

  // Invalidate caches across the ring
  public invalidate(prefix: string) {
    const lowerPrefix = prefix.toLowerCase().trim();
    const nodeName = this.ring.getNode(lowerPrefix);
    const node = this.nodes.get(nodeName);
    if (node) {
      node.delete(lowerPrefix);
    }
  }

  // Invalidate any cache entries that are affected by a changed query count.
  // In a real system, changing "iphone" count invalidates prefix caches of
  // "i", "ip", "iph", "ipho", "iphon", "iphone".
  public invalidatePrefixesForQuery(query: string) {
    const lowerQuery = query.toLowerCase().trim();
    // Invalidate prefix caches from length 1 to length of the query
    for (let i = 1; i <= lowerQuery.length; i++) {
      const prefix = lowerQuery.substring(0, i);
      this.invalidate(prefix);
    }
  }

  // Get debug/routing info for a prefix
  public getDebugInfo(prefix: string): { node: string; isCached: boolean; activeKeys: string[] } {
    const lowerPrefix = prefix.toLowerCase().trim();
    const nodeName = this.ring.getNode(lowerPrefix);
    const node = this.nodes.get(nodeName);
    
    const entry = node ? node.get(lowerPrefix) : null;
    // Restore hits/misses increments caused by the debug check
    if (node) {
      node.totalRequests--;
      if (entry) {
        node.hits--;
      } else {
        node.misses--;
      }
    }

    return {
      node: nodeName,
      isCached: entry !== null,
      activeKeys: node ? node.getActiveKeys() : []
    };
  }

  // Clear all cache nodes
  public clearAll() {
    for (const node of this.nodes.values()) {
      node.clear();
    }
  }

  // Aggregated analytics across all nodes
  public getMetrics() {
    let totalHits = 0;
    let totalMisses = 0;
    let totalRequests = 0;
    const nodeDetails: Record<string, { hits: number; misses: number; size: number; hitRate: number }> = {};

    for (const [name, node] of this.nodes.entries()) {
      totalHits += node.hits;
      totalMisses += node.misses;
      totalRequests += node.totalRequests;
      
      const hitRate = node.totalRequests > 0 ? (node.hits / node.totalRequests) : 0;
      nodeDetails[name] = {
        hits: node.hits,
        misses: node.misses,
        size: node.getSize(),
        hitRate: Math.round(hitRate * 100) / 100
      };
    }

    const hitRate = totalRequests > 0 ? (totalHits / totalRequests) : 0;

    return {
      totalHits,
      totalMisses,
      totalRequests,
      hitRate: Math.round(hitRate * 100) / 100,
      nodes: nodeDetails
    };
  }

  // Get consistent hash ring keys distribution
  public getRingDistribution(sampleKeys: string[]) {
    return this.ring.getRingDistribution(sampleKeys);
  }
}
