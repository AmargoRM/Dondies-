// Datos de conexión a Supabase.
// Están en Supabase → Project Settings → API Keys / Data API.
// Estas dos llaves son PÚBLICAS: se pueden poner aquí sin problema.
// NUNCA ponga aquí la "service_role" / "secret" key.
window.DUNDIES_CONFIG = {
  SUPABASE_URL: 'PEGAR_AQUI_PROJECT_URL',        // ej. 'https://abcdxyz.supabase.co'
  SUPABASE_ANON_KEY: 'PEGAR_AQUI_ANON_KEY',      // la "anon public" o "publishable" key
};
