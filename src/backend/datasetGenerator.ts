import * as fs from 'fs';
import * as path from 'path';

interface SeedQuery {
  query: string;
  count: number;
}

export async function generateDataset(): Promise<SeedQuery[]> {
  // Using Peter Norvig's compilation of the 1/3 million most frequent English words 
  // from the Google Web Trillion Word Corpus. (333,333 words)
  const url = 'http://norvig.com/ngrams/count_1w.txt';
  console.log(`Downloading famous word frequency dataset from ${url}...`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch dataset: ${response.statusText}`);
  }
  
  const text = await response.text();
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  
  console.log(`Downloaded ${lines.length} lines. Parsing actual frequencies...`);

  const dataset: SeedQuery[] = [];
  
  // Norvig's dataset is tab-separated: word \t frequency
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length === 2) {
      const query = parts[0].trim().toLowerCase();
      // Scale down the counts a bit so they fit nicely without being billions,
      // but keep relative distribution intact.
      // E.g. "the" is ~23 billion. Dividing by 10,000 makes it 2.3 million.
      const rawCount = parseInt(parts[1], 10);
      const count = Math.max(1, Math.floor(rawCount / 10000));
      
      if (query && !isNaN(count)) {
        dataset.push({ query, count });
      }
    }
  }

  // Adding a few modern multi-word search queries that wouldn't be in the old unigram dataset
  const modernQueries = [
    { query: 'iphone 15', count: 500000 },
    { query: 'iphone charger', count: 450000 },
    { query: 'java tutorial', count: 300000 },
    { query: 'chatgpt', count: 2500000 },
    { query: 'amazon prime', count: 800000 },
    { query: 'google translate', count: 600000 },
    { query: 'weather forecast', count: 550000 },
    { query: 'chatgpt login', count: 400000 }
  ];
  
  dataset.unshift(...modernQueries);

  return dataset;
}

const dataDir = path.resolve('data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const datasetPath = path.join(dataDir, 'seed_dataset.json');
const dataset = await generateDataset();

fs.writeFileSync(datasetPath, JSON.stringify(dataset, null, 2), 'utf-8');
console.log(`Successfully generated and wrote dataset to ${datasetPath} (size: ${dataset.length} queries).`);
