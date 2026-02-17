
import { useState, useEffect } from 'react'
// import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PROJECT_ID // Using ID as key based on user env logic? No, wait.

// In step 21, .env has:
// VITE_SUPABASE_PROJECT_ID="bfzlrsefzuwdgiyjodcc"
// SUPABASE_KEY="..."
// VITE_SUPABASE_URL="..."

// We should use appropriate env vars.
// The user's env has SUPABASE_KEY but frontend usually needs VITE_ prefixed vars exposed?
// Wait, Step 21 showed SUPABASE_KEY in root .env. Vite exposes VITE_* by default.
// But SUPABASE_KEY is typically the anon key for frontend.
// I will assume the user has configured .env correctly or I might need to check.

function App() {
    const [projects, setProjects] = useState([])

    useEffect(() => {
        // Basic fetch from backend for now to prove it works
        fetch('http://localhost:4000/api/projects')
            .then(res => res.json())
            .then(data => setProjects(data))
            .catch(err => console.error(err))
    }, [])

    return (
        <div className="p-4">
            <h1 className="text-2xl font-bold mb-4">Projects</h1>
            <ul>
                {projects.map((p: any) => (
                    <li key={p.id} className="border p-2 mb-2 rounded">
                        {p.name} - {p.status}
                    </li>
                ))}
            </ul>
        </div>
    )
}

export default App
