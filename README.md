# Supabase Backend

This repository contains the database schema, migrations, and configuration for the backend of the Content Creator AI platform.  
It defines your data structure, relationships, and access control for all core entities used by the frontend app.

## 📌 Overview

The backend is powered by **Supabase**, which provides:
- A managed **PostgreSQL database**
- **Authentication** (users & sessions)
- Optional **Edge Functions** for serverless logic

This repo tracks:
- Database schema snapshots (`schema.sql`)
- Versioned **migrations** for database changes
- Supabase configuration (`config.toml`)

---
## 🛠️ Tech Stack

- **Frontend**: 
  - React 18
  - Vite
  - Tailwind CSS
  - Shadcn UI
  - React Query
  - Lucide React (Icons)

- **Backend**:
  - Node.js
  - Express.js
  - Supabase JS Client

- **Database**:
  - Supabase (PostgreSQL)

## 📦 Prerequisites

- Node.js (v20+ recommended)
- npm or yarn
- A Supabase account

## 🔧 Installation & Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd supabase
```

### 2. Install Dependencies

**Frontend:**
```bash
npm install
```

**Backend:**
```bash
cd backend
npm install
cd ..
```
### 3. Install Supabase CLI

Install the official CLI to work with migrations and database sync:

```bash
npm install -g supabase
```

Authenticate:

```bash
supabase login
```

### 4. Environment Configuration

Create a `.env` file in the root directory:

```env
VITE_SUPABASE_PROJECT_ID="your_project_id"
SUPABASE_KEY="your_anon_key"
VITE_SUPABASE_URL="https://your-project.supabase.co"
PEXELS_API_KEY="your_pexels_key"
OPENAI_API_KEY="your_openai_key"
```

Create a `.env` file in the `backend` directory:

```env
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_KEY="your_service_role_key_or_anon_key"
SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"
PORT=4000
```

### 5. Database Setup

Run the following SQL in your Supabase SQL Editor to create the necessary tables:

```sql
-- Create projects table
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'completed', 'failed')),
  content_type TEXT NOT NULL CHECK (content_type IN ('reel', 'short', 'vfx_movie', 'presentation')),
  target_duration INTEGER NOT NULL DEFAULT 60,
  model TEXT NOT NULL DEFAULT 'gpt-4o',
  voiceover_enabled BOOLEAN NOT NULL DEFAULT false,
  captions_enabled BOOLEAN NOT NULL DEFAULT true,
  thumbnail_url TEXT,
  video_url TEXT,
  script TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Access" ON public.projects FOR ALL USING (true);
```

*(Refer to project documentation for full schema regarding `chat_history` and `project_files`)*

### 6. Sync Database Schema

To pull the current remote database schema into this repo:

```bash
supabase db pull --db-url "postgres://<user>:<password>@<host>:5432/postgres"
```

## 🏃‍♂️ Running the Application

**Start the Frontend:**
```bash
npm run dev
```

**Start the Backend:**
Open a new terminal configuration:
```bash
cd backend
npm run dev
```

The frontend will act as the user interface, interacting with the backend API running on port 4000.

## 📝 API Endpoints

- `GET /api/projects`: Fetch all projects
- `GET /api/projects/:id`: Fetch a specific project
- `POST /api/projects`: Create a new project
- `PUT /api/projects/:id`: Update a project
- `DELETE /api/projects/:id`: Delete a project

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request
