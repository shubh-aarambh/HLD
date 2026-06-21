import * as crypto from 'crypto';

export class ConsistentHashRing {
  private virtualNodes: Map<number, string> = new Map(); // Hash -> Physical Node Name
  private sortedHashes: number[] = [];
  private replicaCount: number;

  constructor(nodes: string[] = [], replicaCount = 50) {
    this.replicaCount = replicaCount;
    for (const node of nodes) {
      this.addNode(node);
    }
  }

  // Hash function helper using MD5 to generate a 32-bit unsigned integer
  private hash(key: string): number {
    const hex = crypto.createHash('md5').update(key).digest('hex');
    // Parse the first 8 hex chars (32 bits) as an integer
    return parseInt(hex.substring(0, 8), 16);
  }

  // Add a physical node with its virtual replicas to the ring
  public addNode(node: string) {
    for (let i = 0; i < this.replicaCount; i++) {
      const virtualNodeKey = `${node}-replica-${i}`;
      const hashVal = this.hash(virtualNodeKey);
      this.virtualNodes.set(hashVal, node);
    }
    this.updateSortedHashes();
  }

  // Remove a physical node and its virtual replicas from the ring
  public removeNode(node: string) {
    for (let i = 0; i < this.replicaCount; i++) {
      const virtualNodeKey = `${node}-replica-${i}`;
      const hashVal = this.hash(virtualNodeKey);
      this.virtualNodes.delete(hashVal);
    }
    this.updateSortedHashes();
  }

  // Re-build sorted list of virtual node hashes
  private updateSortedHashes() {
    this.sortedHashes = Array.from(this.virtualNodes.keys()).sort((a, b) => a - b);
  }

  // Locate the node responsible for a prefix key
  public getNode(key: string): string {
    if (this.sortedHashes.length === 0) {
      throw new Error('Consistent Hash Ring is empty. Add nodes first.');
    }

    const hashVal = this.hash(key);
    
    // Binary search to find the first virtual node hash >= key's hash
    let low = 0;
    let high = this.sortedHashes.length - 1;
    let index = 0;

    if (hashVal > this.sortedHashes[high]) {
      // Wrap around to the start of the ring
      index = 0;
    } else {
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (this.sortedHashes[mid] >= hashVal) {
          index = mid;
          high = mid - 1; // Look for closer match to the left
        } else {
          low = mid + 1;
        }
      }
    }

    const matchedHash = this.sortedHashes[index];
    const physicalNode = this.virtualNodes.get(matchedHash);
    if (!physicalNode) {
      throw new Error(`Hash match failure for hash ${matchedHash}`);
    }
    return physicalNode;
  }

  // Returns distribution analytics (how many keys fall into each node)
  public getRingDistribution(sampleKeys: string[]): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const key of sampleKeys) {
      try {
        const node = this.getNode(key);
        stats[node] = (stats[node] || 0) + 1;
      } catch {
        // Ring is empty
      }
    }
    return stats;
  }

  // Get raw view of the ring mapping (first 5 nodes for debugging/visualization)
  public getRingState() {
    return this.sortedHashes.slice(0, 10).map(hash => ({
      hash,
      node: this.virtualNodes.get(hash)
    }));
  }
}
