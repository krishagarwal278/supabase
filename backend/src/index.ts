import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fetch, { Headers, Request, Response } from 'node-fetch';

if (!globalThis.fetch) {
  globalThis.fetch = fetch as any;
  (globalThis as any).Headers = Headers;
  (globalThis as any).Request = Request;
  (globalThis as any).Response = Response;
}

// Ensure Headers is available globally even if fetch exists but Headers doesn't (weird edge cases)
if (!globalThis.Headers) {
  (globalThis as any).Headers = Headers;
}

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Key');
  process.exit(1);
}

// Service role client for admin operations
const supabase = createClient(supabaseUrl, supabaseKey);

const TABLE_NAME = 'projects';

// Authentication middleware
const authenticateUser = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  // Create a Supabase client with the user's token
  const supabaseClient = createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });

  // Verify the token and get user
  const { data: { user }, error } = await supabaseClient.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Attach user and supabase client to request
  req.user = user;
  req.supabase = supabaseClient;
  next();
};

// CREATE
app.post('/api/projects', authenticateUser, async (req: any, res) => {
  const { name, description, content_type } = req.body;

  // Validation for required fields
  if (!name || !content_type) {
    return res.status(400).json({ error: 'Name and content_type are required' });
  }

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert([{
      name,
      description,
      content_type,
      status: 'draft' // Default status
    }])
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json({ message: 'Project created successfully', data });
});

// READ (Get all)
app.get('/api/projects', async (req, res) => {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json(data);
});

// READ (Get one by ID)
app.get('/api/projects/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json(data);
});

// UPDATE
app.put('/api/projects/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, status } = req.body;

  const updates: any = {};
  if (name) updates.name = name;
  if (description) updates.description = description;
  if (status) updates.status = status;

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(updates)
    .eq('id', id)
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json({ message: 'Project updated successfully', data });
});

// DELETE
app.delete('/api/projects/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq('id', id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json({ message: 'Project deleted successfully' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
