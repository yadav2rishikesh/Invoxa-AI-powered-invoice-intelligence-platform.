import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ?? "https://tzyftwiookdvqxzllbbd.supabase.co";
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6eWZ0d2lvb2tkdnF4emxsYmJkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NTc4MjIsImV4cCI6MjA5NDIzMzgyMn0.W_zGvDnQ2pFlBfY6kTsEuuN7AgOWXkyDh0F-e9RI2YU";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
