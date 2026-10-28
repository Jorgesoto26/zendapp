// src/config/env.js
import {
  SUPABASE_URL as ENV_SUPABASE_URL,
  SUPABASE_ANON_KEY as ENV_SUPABASE_ANON_KEY,
} from '@env';

export const SUPABASE_URL =
  ENV_SUPABASE_URL || 'https://gwpwntdwogxzmtegaaom.supabase.co';

export const SUPABASE_ANON_KEY =
  ENV_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3cHdudGR3b2d4em10ZWdhYW9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ2NzAyMjAsImV4cCI6MjA2MDI0NjIyMH0.kN83W-jHuNS6GX7kYCaBxx-1k3X964rkhdKAGaza8G4';

