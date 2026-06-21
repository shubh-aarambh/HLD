// Constants
const DEBOUNCE_DELAY = 300;
const TELEMETRY_POLL_INTERVAL = 1000;

// Application State
let activeSuggestionIndex = -1;
let currentSuggestions = [];
let debounceTimer = null;

// UI Elements
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const suggestionsDropdown = document.getElementById('suggestions-dropdown');
const searchResponseContainer = document.getElementById('search-response-container');
const searchResponseText = document.getElementById('search-response-text');

// Debug Elements
const debugNode = document.getElementById('debug-node');
const debugStatus = document.getElementById('debug-status');

// Telemetry Elements
const valP95 = document.getElementById('val-p95');
const valHitRate = document.getElementById('val-hit-rate');
const valWritesSaved = document.getElementById('val-writes-saved');
const valReductionRate = document.getElementById('val-reduction-rate');

const valDbReads = document.getElementById('val-db-reads');
const valDbWrites = document.getElementById('val-db-writes');
const valCacheReqs = document.getElementById('val-cache-reqs');
const valCacheHits = document.getElementById('val-cache-hits');
const valCacheMisses = document.getElementById('val-cache-misses');

const ringBars = document.getElementById('ring-bars');
const valBufSize = document.getElementById('val-buf-size');
const valSearchesSub = document.getElementById('val-searches-sub');
const bufferItemsList = document.getElementById('buffer-items-list');

const trendingListOverall = document.getElementById('trending-list-overall');
const trendingListRecency = document.getElementById('trending-list-recency');

// Action Buttons
const btnFlush = document.getElementById('btn-flush');
const btnClearCache = document.getElementById('btn-clear-cache');
const btnInjectTraffic = document.getElementById('btn-inject-traffic');

// --- Helper Functions ---

// Debouncer
function debounce(func, delay) {
  return function (...args) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => func.apply(this, args), delay);
  };
}

// Fetch selected ranking mechanism
function getSelectedRanking() {
  const isRecency = document.getElementById('rank-recency').checked;
  return isRecency ? 'recency' : 'overall';
}

// Close Dropdown
function closeDropdown() {
  suggestionsDropdown.classList.add('hidden');
  suggestionsDropdown.innerHTML = '';
  currentSuggestions = [];
  activeSuggestionIndex = -1;
}

// Get Suggestions
async function fetchSuggestions(prefix) {
  if (!prefix) {
    closeDropdown();
    return;
  }

  const ranking = getSelectedRanking();
  try {
    const res = await fetch(`/suggest?q=${encodeURIComponent(prefix)}&ranking=${ranking}`);
    const data = await res.json();

    currentSuggestions = data.suggestions || [];
    renderSuggestions(currentSuggestions);
    
    // Update cache debug bar
    debugNode.textContent = data.node || '-';
    if (data.cacheHit) {
      debugStatus.textContent = 'HIT';
      debugStatus.className = 'value text-success';
    } else {
      debugStatus.textContent = 'MISS';
      debugStatus.className = 'value text-danger';
    }

    // Refresh telemetry immediately
    pollTelemetry();

  } catch (err) {
    console.error('Error fetching suggestions:', err);
  }
}

// Render Suggestions List
function renderSuggestions(suggestions) {
  suggestionsDropdown.innerHTML = '';
  activeSuggestionIndex = -1;

  if (suggestions.length === 0) {
    suggestionsDropdown.innerHTML = `<li class="suggestion-empty">No matching suggestions</li>`;
    suggestionsDropdown.classList.remove('hidden');
    return;
  }

  suggestions.forEach((query, index) => {
    const li = document.createElement('li');
    li.className = 'suggestion-item';
    li.setAttribute('data-index', index);
    
    // Check if this item is in the seed/trending list (we can mock search count info or leave it clean)
    li.innerHTML = `
      <span class="suggestion-query">${query}</span>
    `;

    li.addEventListener('mousedown', () => {
      searchInput.value = query;
      submitSearch(query);
      closeDropdown();
    });

    suggestionsDropdown.appendChild(li);
  });

  suggestionsDropdown.classList.remove('hidden');
}

// Submit Search API
async function submitSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) return;

  try {
    const res = await fetch('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: trimmed })
    });
    const data = await res.json();

    // Render response feedback
    searchResponseText.textContent = JSON.stringify(data);
    searchResponseContainer.classList.remove('hidden');

    // Fade out response after 3 seconds
    setTimeout(() => {
      searchResponseContainer.classList.add('hidden');
    }, 3000);

    // Refresh telemetry
    pollTelemetry();

  } catch (err) {
    console.error('Error submitting search:', err);
  }
}

// --- Key Events ---

searchInput.addEventListener('input', debounce((e) => {
  const val = e.target.value;
  fetchSuggestions(val);
}, DEBOUNCE_DELAY));

// Handle arrow keys and enter
searchInput.addEventListener('keydown', (e) => {
  const items = suggestionsDropdown.getElementsByClassName('suggestion-item');
  if (items.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    // Move index down
    activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
    updateActiveSuggestion(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    // Move index up
    activeSuggestionIndex = (activeSuggestionIndex - 1 + items.length) % items.length;
    updateActiveSuggestion(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (activeSuggestionIndex > -1 && currentSuggestions[activeSuggestionIndex]) {
      const selected = currentSuggestions[activeSuggestionIndex];
      searchInput.value = selected;
      submitSearch(selected);
    } else {
      submitSearch(searchInput.value);
    }
    closeDropdown();
  } else if (e.key === 'Escape') {
    closeDropdown();
  }
});

function updateActiveSuggestion(items) {
  // Clear existing active classes
  Array.from(items).forEach(item => item.classList.remove('active'));
  
  if (activeSuggestionIndex > -1) {
    const activeItem = items[activeSuggestionIndex];
    activeItem.classList.add('active');
    // Scroll item into view inside dropdown if needed
    activeItem.scrollIntoView({ block: 'nearest' });
    // Update input box to reflect highlighted item
    const val = currentSuggestions[activeSuggestionIndex];
    searchInput.value = val;
  }
}

// Close dropdown on blur (with slight delay to let click happen)
searchInput.addEventListener('blur', () => {
  setTimeout(() => {
    closeDropdown();
  }, 200);
});

searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim()) {
    fetchSuggestions(searchInput.value);
  }
});

// Search Button submit
searchBtn.addEventListener('click', () => {
  submitSearch(searchInput.value);
  closeDropdown();
});

// Watch ranking toggle clicks to instantly update suggestions
document.getElementById('rank-overall').addEventListener('change', () => {
  if (searchInput.value) fetchSuggestions(searchInput.value);
});
document.getElementById('rank-recency').addEventListener('change', () => {
  if (searchInput.value) fetchSuggestions(searchInput.value);
});

// --- Telemetry Polling & Visualization ---

async function pollTelemetry() {
  try {
    const res = await fetch('/analytics');
    const data = await res.json();

    // 1. Live Indicator strip
    valP95.textContent = data.latency.p95 > 0 ? `${data.latency.p95} ms` : '< 1 ms';
    valHitRate.textContent = `${Math.round(data.cache.hitRate * 100)}%`;
    valWritesSaved.textContent = data.batch.writesSaved.toLocaleString();
    valReductionRate.textContent = `${data.batch.writeReductionRate}%`;

    // 2. Storage & Cache
    valDbReads.textContent = data.database.reads.toLocaleString();
    valDbWrites.textContent = data.database.writes.toLocaleString();
    valCacheReqs.textContent = data.cache.totalRequests.toLocaleString();
    valCacheHits.textContent = data.cache.totalHits.toLocaleString();
    valCacheMisses.textContent = data.cache.totalMisses.toLocaleString();

    // 3. Ring Key Distribution
    ringBars.innerHTML = '';
    const ringDist = data.ring.distribution || {};
    
    // We expect 3 cache nodes
    const allCacheNodes = ['CacheNode-A', 'CacheNode-B', 'CacheNode-C'];
    
    // Find max key count for sizing percentage width
    const counts = Object.values(ringDist);
    const maxCount = counts.length > 0 ? Math.max(...counts, 1) : 1;

    allCacheNodes.forEach(node => {
      const count = ringDist[node] || 0;
      const pct = (count / maxCount) * 100;

      const row = document.createElement('div');
      row.className = 'ring-node-row';
      row.innerHTML = `
        <span class="ring-node-name">${node}</span>
        <div class="ring-bar-wrapper">
          <div class="ring-bar-fill" style="width: ${pct}%"></div>
        </div>
        <span class="ring-node-count">${count}</span>
      `;
      ringBars.appendChild(row);
    });

    // 4. Batch Queue Buffer
    valBufSize.textContent = `${data.batch.buffer.size} / 20`;
    valSearchesSub.textContent = data.batch.totalSearchesReceived.toLocaleString();

    bufferItemsList.innerHTML = '';
    if (data.batch.buffer.size === 0) {
      bufferItemsList.innerHTML = `<li class="empty-msg">Buffer is empty. Submit searches to fill.</li>`;
    } else {
      data.batch.buffer.items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'buffer-item';
        li.innerHTML = `
          <span class="buffer-item-name">${item.query}</span>
          <span class="buffer-item-count">+${item.count}</span>
        `;
        bufferItemsList.appendChild(li);
      });
    }

    // 5. Trending overall
    trendingListOverall.innerHTML = '';
    if (data.trending.overall.length === 0) {
      trendingListOverall.innerHTML = `<li class="loading-item">No trending searches yet.</li>`;
    } else {
      data.trending.overall.forEach((item) => {
        const li = document.createElement('li');
        li.innerHTML = `
          <div class="trending-item-wrapper">
            <span class="trending-name">${item.query}</span>
            <span class="trending-meta">${item.count.toLocaleString()} searches</span>
          </div>
        `;
        trendingListOverall.appendChild(li);
      });
    }

    // 6. Trending recency
    trendingListRecency.innerHTML = '';
    if (data.trending.recency.length === 0) {
      trendingListRecency.innerHTML = `<li class="loading-item">No recency searches yet.</li>`;
    } else {
      data.trending.recency.forEach((item) => {
        const li = document.createElement('li');
        li.innerHTML = `
          <div class="trending-item-wrapper">
            <span class="trending-name">${item.query}</span>
            <span class="trending-meta" title="Cumulative searches: ${item.count}">
              score: ${item.score} (${item.recentSearches} recent)
            </span>
          </div>
        `;
        trendingListRecency.appendChild(li);
      });
    }

  } catch (err) {
    console.error('Error fetching telemetry:', err);
  }
}

// Start telemetry polling loop
setInterval(pollTelemetry, TELEMETRY_POLL_INTERVAL);
// Initial load
pollTelemetry();

// --- Admin Panels Action Listeners ---

btnFlush.addEventListener('click', async () => {
  try {
    const res = await fetch('/batch/flush', { method: 'POST' });
    const data = await res.json();
    console.log(data.message);
    pollTelemetry();
  } catch (err) {
    console.error('Error triggering flush:', err);
  }
});

btnClearCache.addEventListener('click', async () => {
  try {
    const res = await fetch('/cache/clear', { method: 'POST' });
    const data = await res.json();
    console.log(data.message);
    pollTelemetry();
  } catch (err) {
    console.error('Error clearing cache:', err);
  }
});

// Simulated traffic injector: fires 100 searches in parallel
btnInjectTraffic.addEventListener('click', async () => {
  btnInjectTraffic.disabled = true;
  btnInjectTraffic.textContent = 'Injecting Traffic...';

  // Seed queries for traffic injection to create overlapping duplicates
  // This helps demonstrate batch writing merging and caching!
  const mockQueries = [
    'iphone', 'iphone charger', 'iphone', 'java tutorial', 'python',
    'iphone', 'chatgpt', 'netflix', 'iphone charger', 'python',
    'chatgpt login', 'chatgpt', 'github', 'reddit', 'canva',
    'python', 'javascript array methods', 'github', 'fifa 26', 'weather forecast',
    'netflix', 'netflix', 'amazon prime', 'amazon prime', 'netflix',
    'how to clean keyboard wireless', 'nike shoes pro', 'cheap apple laptop',
    'best gaming mouse ultra', 'google translate', 'gmail login', 'weather forecast'
  ];

  const promises = [];
  // Submit 100 queries
  for (let i = 0; i < 100; i++) {
    const q = mockQueries[Math.floor(Math.random() * mockQueries.length)];
    promises.push(
      fetch('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      })
    );
  }

  try {
    await Promise.all(promises);
    console.log('Injected 100 search requests successfully.');
  } catch (err) {
    console.error('Error injecting traffic:', err);
  } finally {
    setTimeout(() => {
      btnInjectTraffic.disabled = false;
      btnInjectTraffic.textContent = '🚀 Inject Simulated Search Traffic (100 Writes)';
      pollTelemetry();
    }, 1000);
  }
});
