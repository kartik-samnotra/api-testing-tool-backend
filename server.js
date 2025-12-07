import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Supabase setup - only if credentials exist
let supabase;
if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
  console.log('✅ Supabase connected');
} else {
  console.log('⚠️  Supabase not configured, using in-memory storage');
}

// Fallback in-memory storage
let memoryHistory = [];
let memoryCollections = [];
let memoryCollectionRequests = [];

console.log('🚀 Server started');
console.log(`📡 API running at http://localhost:${PORT}`);

// Test route
app.get('/', (req, res) => {
  res.json({ 
    message: 'API Testing Tool Backend', 
    status: 'running',
    storage: supabase ? 'Supabase' : 'In-memory',
    version: '1.0.0'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    storage: supabase ? 'connected' : 'memory'
  });
});

// Proxy endpoint
app.post('/api/proxy', async (req, res) => {
  try {
    const { url, method, headers, body, params } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
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
      redirect: 'follow',
      timeout: 30000 // 30 second timeout
    };

    if (method !== 'GET' && method !== 'HEAD' && body) {
      fetchOptions.body = JSON.stringify(body);
    }

    console.log(`🌐 ${method} ${finalUrl}`);
    
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

    const responseData = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      time: endTime - startTime,
      size: JSON.stringify(responseBody).length
    };

    res.json(responseData);

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

// History endpoints
app.post('/api/history', async (req, res) => {
  try {
    const { url, method, headers, body, params, user_id } = req.body;
    
    if (supabase) {
      // Use Supabase
      const { data, error } = await supabase
        .from('request_history')
        .insert([{
          url, 
          method, 
          headers, 
          body, 
          params, 
          user_id: user_id || 'anonymous'
        }])
        .select();

      if (error) throw error;
      res.json(data[0]);
    } else {
      // Use memory
      const historyItem = {
        id: Date.now().toString(),
        url,
        method,
        headers,
        body,
        params,
        user_id: user_id || 'anonymous',
        created_at: new Date().toISOString()
      };
      
      memoryHistory.unshift(historyItem);
      memoryHistory = memoryHistory.slice(0, 100); // Keep last 100
      
      res.json(historyItem);
    }
  } catch (error) {
    console.error('History save error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const { user_id } = req.query;
    const userId = user_id || 'anonymous';
    const limit = parseInt(req.query.limit) || 50;
    
    if (supabase) {
      // Use Supabase
      const { data, error } = await supabase
        .from('request_history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      res.json(data || []);
    } else {
      // Use memory
      const userHistory = memoryHistory
        .filter(item => item.user_id === userId)
        .slice(0, limit);
      res.json(userHistory);
    }
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/history/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;
    
    if (supabase) {
      const { error } = await supabase
        .from('request_history')
        .delete()
        .eq('id', id)
        .eq('user_id', user_id || 'anonymous');

      if (error) throw error;
      res.json({ message: 'History item deleted' });
    } else {
      memoryHistory = memoryHistory.filter(item => 
        !(item.id === id && item.user_id === (user_id || 'anonymous'))
      );
      res.json({ message: 'History item deleted' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Collections endpoints
app.post('/api/collections', async (req, res) => {
  try {
    const { name, description, user_id } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Collection name is required' });
    }
    
    if (supabase) {
      const { data, error } = await supabase
        .from('collections')
        .insert([{ 
          name, 
          description, 
          user_id: user_id || 'anonymous' 
        }])
        .select();

      if (error) throw error;
      res.json(data[0]);
    } else {
      const collection = {
        id: Date.now().toString(),
        name,
        description,
        user_id: user_id || 'anonymous',
        created_at: new Date().toISOString()
      };
      
      memoryCollections.unshift(collection);
      res.json(collection);
    }
  } catch (error) {
    console.error('Collection create error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/collections', async (req, res) => {
  try {
    const { user_id } = req.query;
    const userId = user_id || 'anonymous';
    
    if (supabase) {
      const { data, error } = await supabase
        .from('collections')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      res.json(data || []);
    } else {
      const userCollections = memoryCollections
        .filter(item => item.user_id === userId);
      res.json(userCollections);
    }
  } catch (error) {
    console.error('Collections fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/collections/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;
    
    if (supabase) {
      const { error } = await supabase
        .from('collections')
        .delete()
        .eq('id', id)
        .eq('user_id', user_id || 'anonymous');

      if (error) throw error;
      res.json({ message: 'Collection deleted' });
    } else {
      memoryCollections = memoryCollections.filter(item => 
        !(item.id === id && item.user_id === (user_id || 'anonymous'))
      );
      // Also delete collection requests
      memoryCollectionRequests = memoryCollectionRequests.filter(
        req => req.collection_id !== id
      );
      res.json({ message: 'Collection deleted' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/collections/:id/requests', async (req, res) => {
  try {
    const { id } = req.params;
    const { url, method, headers, body, params, name } = req.body;
    
    if (supabase) {
      const { data, error } = await supabase
        .from('collection_requests')
        .insert([{ 
          collection_id: id, 
          url, 
          method, 
          headers, 
          body, 
          params, 
          name: name || `${method} ${new URL(url).pathname}`
        }])
        .select();

      if (error) throw error;
      res.json(data[0]);
    } else {
      const request = {
        id: Date.now().toString(),
        collection_id: id,
        url,
        method,
        headers,
        body,
        params,
        name: name || `${method} ${new URL(url).pathname}`,
        created_at: new Date().toISOString()
      };
      
      memoryCollectionRequests.unshift(request);
      res.json(request);
    }
  } catch (error) {
    console.error('Collection request save error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/collections/:id/requests', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (supabase) {
      const { data, error } = await supabase
        .from('collection_requests')
        .select('*')
        .eq('collection_id', id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      res.json(data || []);
    } else {
      const requests = memoryCollectionRequests
        .filter(item => item.collection_id === id);
      res.json(requests);
    }
  } catch (error) {
    console.error('Collection requests fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Auth endpoints (simplified for now)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    if (supabase) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name }
        }
      });

      if (error) throw error;
      res.json({ user: data.user, message: 'Registration successful' });
    } else {
      // Mock response for in-memory mode
      res.json({ 
        user: { 
          id: 'mock_user_' + Date.now(),
          email,
          name
        }, 
        message: 'Mock registration successful (no actual account created)' 
      });
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    if (supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;
      res.json({ 
        user: data.user, 
        session: data.session,
        message: 'Login successful' 
      });
    } else {
      // Mock response for in-memory mode
      res.json({ 
        user: { 
          id: 'mock_user_' + Date.now(),
          email,
          name: email.split('@')[0]
        }, 
        message: 'Mock login successful (no actual authentication)' 
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    }
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear all data (for testing)
app.delete('/api/clear', (req, res) => {
  try {
    const { user_id } = req.query;
    
    if (user_id) {
      // Clear only user's data
      memoryHistory = memoryHistory.filter(item => item.user_id !== user_id);
      memoryCollections = memoryCollections.filter(item => item.user_id !== user_id);
      memoryCollectionRequests = memoryCollectionRequests.filter(item => {
        const collection = memoryCollections.find(c => c.id === item.collection_id);
        return !collection || collection.user_id !== user_id;
      });
    } else {
      // Clear all data
      memoryHistory = [];
      memoryCollections = [];
      memoryCollectionRequests = [];
    }
    
    res.json({ 
      message: user_id ? 'User data cleared' : 'All data cleared',
      historyCount: memoryHistory.length,
      collectionsCount: memoryCollections.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stats endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const { user_id } = req.query;
    
    let stats = {
      historyCount: 0,
      collectionsCount: 0,
      requestsCount: 0,
      storageType: supabase ? 'supabase' : 'memory'
    };
    
    if (supabase && user_id) {
      // Get counts from Supabase
      const [historyRes, collectionsRes, requestsRes] = await Promise.all([
        supabase
          .from('request_history')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user_id),
        supabase
          .from('collections')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user_id),
        supabase
          .from('collection_requests')
          .select('id', { count: 'exact', head: true })
      ]);
      
      stats.historyCount = historyRes.count || 0;
      stats.collectionsCount = collectionsRes.count || 0;
      stats.requestsCount = requestsRes.count || 0;
    } else if (user_id) {
      // Get counts from memory
      stats.historyCount = memoryHistory.filter(h => h.user_id === user_id).length;
      stats.collectionsCount = memoryCollections.filter(c => c.user_id === user_id).length;
      stats.requestsCount = memoryCollectionRequests.length;
    } else {
      // Overall counts
      stats.historyCount = memoryHistory.length;
      stats.collectionsCount = memoryCollections.length;
      stats.requestsCount = memoryCollectionRequests.length;
    }
    
    res.json(stats);
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
  console.log(`📊 Storage: ${supabase ? 'Supabase' : 'In-memory'}`);
  console.log(`⚡ Environment: ${process.env.NODE_ENV || 'development'}`);
});