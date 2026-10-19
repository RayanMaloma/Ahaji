import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createHandler } from './handler.ts';

Deno.serve(createHandler({
  createClient,
  env: () => ({
    url: Deno.env.get('SUPABASE_URL'),
    publishable: JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}').default ||
      Deno.env.get('SUPABASE_ANON_KEY'),
    secret: JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default ||
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  }),
}));
