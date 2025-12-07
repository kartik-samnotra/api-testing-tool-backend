import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// In-memory storage
let memoryHistory = [];
let memoryCollections = [];

console.log('🚀 Server started on Render');
console.log(`📡 API running on port ${PORT}`);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Home route
app.get('/', (req, res) => {
  res.json({ 
    message: 'API Testing Tool Backend', 
    status: 'running',
    endpoints: ['/api/proxy', '/api/history', '/api/collections', '/health']
  });
});

// Proxy endpoint
app.post('/api/proxy', async (req, res) => {
  try {
    const { url, method, headers, body, params } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const startTime = Date.now();
    
    // Build URL with query params
    let finalUrl = url;
    if (params && Object.keys(params).length > 0) {
      const urlParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (key && value) urlParams.append(key, value);
      });
      finalUrl += `?${urlParams.toString()}`;
    }

    const fetchOptions = {
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      redirect: 'follow'
    };

    if (method !== 'GET' && method !== 'HEAD' && body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(finalUrl, fetchOptions);
    const endTime = Date.now();
    
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let responseBody;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }
    } else {
      responseBody = await response.text();
    }

    res.json({
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      time: endTime - startTime,
      size: JSON.stringify(responseBody).length
    });

  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({
      error: error.message,
      time: 0,
      size: 0,
      status: 500
    });
  }
});

// History endpoints - SIMPLIFIED
app.post('/api/history', async (req, res) => {
  try {
    const { url, method, headers, body, params, user_id } = req.body;
    
    const historyItem = {
      id: Date.now().toString(),
      url,
      method,
      headers: headers || {},
      body: body || null,
      params: params || {},
      user_id: user_id || 'anonymous',
      created_at: new Date().toISOString()
    };
    
    memoryHistory.unshift(historyItem);
    // Keep only last 100 items
    memoryHistory = memoryHistory.slice(0, 100);
    
    res.json(historyItem);
  } catch (error) {
    console.error('History save error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const { user_id } = req.query;
    const userId = user_id || 'anonymous';
    
    // Filter by user and return as array
    const userHistory = memoryHistory
      .filter(item => item.user_id === userId)
      .slice(0, 50);
    
    res.json(userHistory);
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Collections endpoints - SIMPLIFIED
app.post('/api/collections', async (req, res) => {
  try {
    const { name, description, user_id } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Collection name is required' });
    }
    
    const collection = {
      id: Date.now().toString(),
      name,
      description: description || '',
      user_id: user_id || 'anonymous',
      created_at: new Date().toISOString()
    };
    
    memoryCollections.unshift(collection);
    res.json(collection);
  } catch (error) {
    console.error('Collection create error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/collections', async (req, res) => {
  try {
    const { user_id } = req.query;
    const userId = user_id || 'anonymous';
    
    // Filter by user and return as array
    const userCollections = memoryCollections
      .filter(item => item.user_id === userId);
    
    res.json(userCollections);
  } catch (error) {
    console.error('Collections fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Collection requests endpoint
app.post('/api/collections/:id/requests', async (req, res) => {
  try {
    const { id } = req.params;
    const { url, method, headers, body, params, name } = req.body;
    
    // In this simplified version, we'll just store in memoryCollections
    // Find the collection
    const collectionIndex = memoryCollections.findIndex(c => c.id === id);
    if (collectionIndex === -1) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    
    const request = {
      id: Date.now().toString(),
      url,
      method,
      headers: headers || {},
      body: body || null,
      params: params || {},
      name: name || `${method} ${url}`,
      created_at: new Date().toISOString()
    };
    
    // Add request to collection
    if (!memoryCollections[collectionIndex].requests) {
      memoryCollections[collectionIndex].requests = [];
    }
    memoryCollections[collectionIndex].requests.unshift(request);
    
    res.json(request);
  } catch (error) {
    console.error('Collection request save error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear data endpoint
app.delete('/api/clear', (req, res) => {
  memoryHistory = [];
  memoryCollections = [];
  res.json({ 
    message: 'All data cleared',
    historyCount: memoryHistory.length,
    collectionsCount: memoryCollections.length
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});