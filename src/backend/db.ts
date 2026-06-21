import * as fs from 'fs';
import * as path from 'path';

export interface QueryRecord {
  query: string;
  overallCount: number;
  recentTimestamps: number[]; // Timestamps of recent searches
}

export class Database {
  private dataPath = path.resolve('data/db.json');
  private seedPath = path.resolve('data/seed_dataset.json');
  
  private records: Map<string, QueryRecord> = new Map();
  private sortedRecords: QueryRecord[] = [];
  
  public readCount = 0;
  public writeCount = 0;

  constructor() {
    this.init();
  }

  // Initialize DB by loading existing db.json or seeding from seed_dataset.json
  private init() {
    try {
      if (fs.existsSync(this.dataPath)) {
        console.log(`Loading database from ${this.dataPath}...`);
        const raw = fs.readFileSync(this.dataPath, 'utf-8');
        const data: QueryRecord[] = JSON.parse(raw);
        this.populate(data);
      } else if (fs.existsSync(this.seedPath)) {
        console.log(`db.json not found. Initializing database from seed dataset ${this.seedPath}...`);
        const raw = fs.readFileSync(this.seedPath, 'utf-8');
        const seedData: { query: string; count: number }[] = JSON.parse(raw);
        
        // Convert to QueryRecord format
        const data: QueryRecord[] = seedData.map(item => ({
          query: item.query,
          overallCount: item.count,
          recentTimestamps: []
        }));
        
        this.populate(data);
        this.save(); // Initial save
      } else {
        throw new Error('Neither db.json nor seed_dataset.json was found. Please run seed script first.');
      }
    } catch (err: any) {
      console.error('Failed to initialize database:', err.message);
      // Fallback: start with empty
      this.populate([]);
    }
  }

  private populate(data: QueryRecord[]) {
    this.records.clear();
    for (const item of data) {
      this.records.set(item.query, item);
    }
    this.sortedRecords = Array.from(this.records.values());
  }

  // Save the current state of records to db.json
  public save() {
    try {
      const data = Array.from(this.records.values());
      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2), 'utf-8');
      this.writeCount++;
    } catch (err: any) {
      console.error('Error saving database to file:', err.message);
    }
  }

  // Retrieve records matching a given prefix
  public getPrefixMatches(prefix: string): QueryRecord[] {
    this.readCount++;
    const lowerPrefix = prefix.toLowerCase().trim();
    if (!lowerPrefix) {
      return [];
    }
    
    // Scan matching items.
    // For 100k items, simple linear filter is extremely fast in NodeJS (2-4ms)
    // and highly reliable.
    return this.sortedRecords.filter(record => 
      record.query.startsWith(lowerPrefix)
    );
  }

  // Retrieve a specific query record
  public getRecord(query: string): QueryRecord | undefined {
    this.readCount++;
    return this.records.get(query.toLowerCase().trim());
  }

  // Retrieve all records (for computing overall metrics / trending)
  public getAllRecords(): QueryRecord[] {
    this.readCount++;
    return this.sortedRecords;
  }

  // Apply batch updates to the database
  // updates: map of query -> { countIncrement: number, newTimestamps: number[] }
  public applyBatchUpdates(updates: Map<string, { countIncrement: number; newTimestamps: number[] }>) {
    let updatedCount = 0;
    
    for (const [query, data] of updates.entries()) {
      const lowerQuery = query.toLowerCase().trim();
      const existing = this.records.get(lowerQuery);
      
      if (existing) {
        existing.overallCount += data.countIncrement;
        existing.recentTimestamps.push(...data.newTimestamps);
        // Retain only timestamps from the last 2 hours to avoid unbounded array growth
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        existing.recentTimestamps = existing.recentTimestamps.filter(t => t >= twoHoursAgo);
      } else {
        const newRecord: QueryRecord = {
          query: lowerQuery,
          overallCount: data.countIncrement,
          recentTimestamps: data.newTimestamps
        };
        this.records.set(lowerQuery, newRecord);
      }
      updatedCount++;
    }
    
    if (updatedCount > 0) {
      // Re-populate the sortedRecords array
      this.sortedRecords = Array.from(this.records.values());
      // Save changes to disk
      this.save();
    }
  }
}
