import * as fs from 'fs';
import * as path from 'path';

// Define vocabularies to generate realistic query combinations
const brands = [
  'apple', 'samsung', 'sony', 'nike', 'adidas', 'dell', 'hp', 'lenovo', 'asus', 
  'microsoft', 'google', 'amazon', 'sony', 'bose', 'logitech', 'razer', 'toyota', 
  'tesla', 'honda', 'ford', 'lg', 'panasonic', 'canon', 'nikon', 'puma', 'reebok',
  'under armour', 'rolex', 'gucci', 'prada', 'zara', 'h&m', 'ikea', 'nintendo'
];

const products = [
  'phone', 'laptop', 'monitor', 'keyboard', 'mouse', 'headphones', 'earbuds', 
  'charger', 'watch', 'case', 'bag', 'backpack', 'shoes', 'sneakers', 'shirt', 
  'tshirt', 'jeans', 'jacket', 'hoodie', 'socks', 'hat', 'tv', 'television', 
  'camera', 'lens', 'speaker', 'soundbar', 'tablet', 'ipad', 'router', 'switch', 
  'console', 'controller', 'desk', 'chair', 'lamp', 'water bottle', 'mug', 
  'notebook', 'pen', 'pencil', 'glasses', 'wallet', 'belt', 'perfume', 'shampoo'
];

const modifiers = [
  'pro', 'max', 'ultra', 'mini', 'wireless', 'bluetooth', 'gaming', 'cheap', 
  'best', 'review', 'guide', 'tutorial', 'online', 'sale', 'free', 'deals', 
  '2026', 'new', 'used', 'refurbished', 'waterproof', 'leather', 'cotton', 
  'sports', 'running', 'workout', 'office', 'home', 'travel', 'portable', 
  'lightweight', 'heavy duty', 'smart', 'noise cancelling', 'fast charging'
];

const verbs = [
  'buy', 'how to fix', 'how to clean', 'best way to', 'reviews of', 
  'comparison of', 'specs of', 'price of', 'where is', 'how does'
];

interface SeedQuery {
  query: string;
  count: number;
}

export function generateDataset(countNeeded = 105000): SeedQuery[] {
  console.log(`Generating synthetic dataset of at least ${countNeeded} queries...`);
  const uniqueQueries = new Set<string>();
  const dataset: SeedQuery[] = [];

  // 1. Generate some fixed highly popular search queries manually
  const hotQueries = [
    'iphone', 'iphone 15', 'iphone charger', 'java tutorial', 'python', 
    'chatgpt', 'netflix', 'amazon prime', 'google translate', 'weather forecast',
    'youtube converter', 'facebook login', 'gmail login', 'instagram web', 
    'github', 'reddit', 'canva', 'fifa 26', 'chatgpt login', 'javascript array methods'
  ];

  for (const q of hotQueries) {
    uniqueQueries.add(q);
  }

  // 2. Combine vocabularies to generate 105,000+ unique queries
  // We will run nested loops or random selections until we reach the target
  let attempts = 0;
  while (uniqueQueries.size < countNeeded && attempts < 1000000) {
    attempts++;
    const type = Math.floor(Math.random() * 5);
    let q = '';

    if (type === 0) {
      // Brand + Product (e.g., apple phone)
      const b = brands[Math.floor(Math.random() * brands.length)];
      const p = products[Math.floor(Math.random() * products.length)];
      q = `${b} ${p}`;
    } else if (type === 1) {
      // Modifier + Brand + Product (e.g., cheap apple phone)
      const m = modifiers[Math.floor(Math.random() * modifiers.length)];
      const b = brands[Math.floor(Math.random() * brands.length)];
      const p = products[Math.floor(Math.random() * products.length)];
      q = `${m} ${b} ${p}`;
    } else if (type === 2) {
      // Brand + Product + Modifier (e.g., apple phone charger)
      const b = brands[Math.floor(Math.random() * brands.length)];
      const p = products[Math.floor(Math.random() * products.length)];
      const m = modifiers[Math.floor(Math.random() * modifiers.length)];
      q = `${b} ${p} ${m}`;
    } else if (type === 3) {
      // Verb + Brand + Product (e.g., buy apple phone)
      const v = verbs[Math.floor(Math.random() * verbs.length)];
      const b = brands[Math.floor(Math.random() * brands.length)];
      const p = products[Math.floor(Math.random() * products.length)];
      q = `${v} ${b} ${p}`;
    } else {
      // Verb + Product + Modifier (e.g., how to clean keyboard wireless)
      const v = verbs[Math.floor(Math.random() * verbs.length)];
      const p = products[Math.floor(Math.random() * products.length)];
      const m = modifiers[Math.floor(Math.random() * modifiers.length)];
      q = `${v} ${p} ${m}`;
    }

    if (q) {
      uniqueQueries.add(q.toLowerCase().trim());
    }
  }

  const queriesArray = Array.from(uniqueQueries);
  console.log(`Generated ${queriesArray.length} unique query strings. Assigning count distribution...`);

  // 3. Assign search counts using Zipf's Law distribution: Count_i = C / (i + 1)^alpha
  // To make it look realistic:
  // C = 500,000 for top rank, alpha = 0.8
  const C = 500000;
  const alpha = 0.8;

  // Let's sort the array so we have deterministic assignments
  queriesArray.sort();

  // Shuffle slightly so that alphabetical order doesn't dictate popularity,
  // but keep the hot queries at the absolute top ranks!
  const topQueriesSet = new Set(hotQueries);
  const remainingQueries = queriesArray.filter(q => !topQueriesSet.has(q));

  // Fisher-Yates shuffle remaining queries
  for (let i = remainingQueries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = remainingQueries[i];
    remainingQueries[i] = remainingQueries[j];
    remainingQueries[j] = temp;
  }

  const finalOrder = [...hotQueries, ...remainingQueries];

  for (let i = 0; i < finalOrder.length; i++) {
    const query = finalOrder[i];
    // Zipfian formula
    const count = Math.floor(C / Math.pow(i + 1, alpha)) + 1; // plus 1 to avoid 0 counts
    dataset.push({ query, count });
  }

  // Double check sorting of the dataset to be nice
  return dataset;
}

// Self-run script entry point
const __dirname = path.dirname(new URL(import.meta.url).pathname);
// On Windows, import.meta.url might start with /c:/, so path resolution needs care
let dataDir = path.resolve('data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const datasetPath = path.join(dataDir, 'seed_dataset.json');
const dataset = generateDataset(105000);

fs.writeFileSync(datasetPath, JSON.stringify(dataset, null, 2), 'utf-8');
console.log(`Successfully generated and wrote dataset to ${datasetPath} (size: ${dataset.length} queries).`);
