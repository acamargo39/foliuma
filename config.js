// Foliuma — configuração do Supabase
// Pegue estes valores em: Supabase → Project Settings → API (ou Data API)
//
// A chave "anon public" PODE ficar pública no GitHub: quem protege os dados
// são as regras de segurança do schema.sql. NUNCA coloque aqui a chave
// "service_role".
window.CADERNO_CONFIG = {
  SUPABASE_URL: 'https://jdpvvneowbwmcgbqfzat.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkcHZ2bmVvd2J3bWNnYnFmemF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NjI3OTIsImV4cCI6MjEwODQzODc5Mn0.KHJn7Fjmn4Q6FrtClidUsd_hPL6jtJjFaKfxcS28Akk',
  // true = só entra quem tiver conta (login e senha obrigatórios). false = permite usar sem conta.
  REQUIRE_LOGIN: true
};
