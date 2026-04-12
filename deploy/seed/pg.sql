-- ── Prismix PostgreSQL Seed Data ─────────────────────────────────────
-- Idempotent: ON CONFLICT DO NOTHING skips existing rows.
-- Executed once on first deploy only.

-- Source: https://www.circle.com/multi-chain-usdc + https://chainlist.org
-- Production networks enabled by default. Testnets disabled (enable via admin UI for dev).
-- rpc_url: fallback public RPC (used when ALCHEMY_API_KEY is not set)
INSERT INTO supported_networks
  (chain_id, network_id, name, short_name, explorer_url, testnet, icon_url, enabled, rpc_url, updated_at, created_at)
VALUES
  -- Base (mainnet) — enabled by default
  (8453,  'eip155:8453',  'Base',         'base',         'https://basescan.org',         FALSE, 'https://icons.llamao.fi/icons/chains/rsz_base.jpg', TRUE,  'https://base-rpc.publicnode.com', NOW(), NOW()),
  -- Polygon PoS (mainnet) — enabled by default
  (137,   'eip155:137',   'Polygon PoS',  'polygon',      'https://polygonscan.com',      FALSE, 'https://icons.llamao.fi/icons/chains/rsz_polygon.jpg', TRUE, 'https://polygon-bor-rpc.publicnode.com', NOW(), NOW()),
  -- Base Sepolia (testnet) — disabled by default, enable for dev
  (84532, 'eip155:84532', 'Base Sepolia', 'base-sepolia', 'https://sepolia.basescan.org', TRUE,  'https://icons.llamao.fi/icons/chains/rsz_base.jpg', FALSE, 'https://sepolia.base.org', NOW(), NOW())
ON CONFLICT (chain_id) DO NOTHING;

-- USDC token addresses (Circle native USDC only, decimals = 6)
INSERT INTO allowed_tokens
  (symbol, network, contract_address, decimals, enabled, updated_at, created_at)
VALUES
  ('USDC', 'eip155:8453',  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, TRUE,  NOW(), NOW()),
  ('USDC', 'eip155:137',   '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6, TRUE,  NOW(), NOW()),
  ('USDC', 'eip155:84532', '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 6, FALSE, NOW(), NOW())
ON CONFLICT (symbol, network) DO NOTHING;

-- ── Facilitator defaults ──────────────────────────────────────────────
INSERT INTO global_settings (key, value, updated_at, created_at)
VALUES (
  'facilitator_config',
  '{"facilitatorUrl":"https://x402.org/facilitator","cdpApiKeyId":"","cdpApiKeySecret":""}',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;

-- ── Auth provider defaults ────────────────────────────────────────────
INSERT INTO global_settings (key, value, updated_at, created_at)
VALUES (
  'auth_providers',
  '{"credentials":{"enabled":true},"google":{"enabled":false,"clientId":"","clientSecret":""},"github":{"enabled":false,"clientId":"","clientSecret":""},"oidc":{"enabled":false,"clientId":"","clientSecret":"","issuer":""},"saml":{"enabled":false,"entityId":"","ssoUrl":"","certificate":""}}',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;

-- ── Notification provider defaults ───────────────────────────────────
INSERT INTO global_settings (key, value, updated_at, created_at)
VALUES (
  'notification_providers',
  '{"email":{"enabled":false,"provider":"smtp","smtpHost":"","smtpPort":587,"smtpUser":"","smtpPass":"","fromAddress":"","fromName":""},"telegram":{"enabled":false,"botToken":""},"webhook":{"enabled":true},"whatsapp":{"enabled":false,"apiToken":"","phoneNumberId":""}}',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;

-- ── System defaults ──────────────────────────────────────────────────
-- Default payment token and network (previously on merchants table)
INSERT INTO global_settings (key, value, updated_at, created_at) VALUES
  ('default_token',   'USDC',          NOW(), NOW()),
  ('default_network', 'eip155:84532',  NOW(), NOW()),
  ('system_name',     'Prismix',      NOW(), NOW()),
  ('user_registration_enabled', 'true', NOW(), NOW()),
  ('user_self_create_key', 'true',      NOW(), NOW()),
  ('user_max_keys', '10',              NOW(), NOW()),
  ('ai_default_markup', '0',           NOW(), NOW())
ON CONFLICT (key) DO NOTHING;

-- ── Admin ────────────────────────────────────────────────────────────
-- First admin auto-registers on login (no env vars needed).
-- Subsequent admins are created by existing admins via the admin panel.

-- ── Gateway rate limits ──────────────────────────────────────────────
INSERT INTO global_settings (key, value, updated_at, created_at)
VALUES (
  'gw_rate_limit',
  '[{"name":"Global per-IP","pathPattern":"*","maxRequests":1000,"windowMs":60000,"dimension":"ip","enabled":true},{"name":"Auth per-IP","pathPattern":"/api/auth/*","maxRequests":1000,"windowMs":60000,"dimension":"ip","enabled":true},{"name":"Admin Auth per-IP","pathPattern":"/api/admin-auth/*","maxRequests":1000,"windowMs":60000,"dimension":"ip","enabled":true},{"name":"Admin API per-token","pathPattern":"/api/admin/*","maxRequests":10000,"windowMs":60000,"dimension":"token","enabled":true},{"name":"User API per-token","pathPattern":"/api/user/*","maxRequests":5000,"windowMs":60000,"dimension":"token","enabled":true}]',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;

-- ── AI Provider catalog ──────────────────────────────────────────────
-- Default provider templates seeded into global_settings as JSON.
-- Admin seeds these providers into the ai_providers table on first setup.
-- Models are NOT seeded — admin configures them via discover-models UI.
INSERT INTO global_settings (key, value, updated_at, created_at)
VALUES (
  'ai_provider_catalog',
  '[{"providerId":"openai","name":"OpenAI","baseUrl":"https://api.openai.com/v1","apiFormat":"openai","authType":"bearer"},{"providerId":"anthropic","name":"Anthropic","baseUrl":"https://api.anthropic.com/v1","apiFormat":"anthropic","authType":"api-key","authConfig":{"headerName":"x-api-key"}},{"providerId":"google","name":"Google AI","baseUrl":"https://generativelanguage.googleapis.com/v1beta","apiFormat":"gemini","authType":"bearer"},{"providerId":"deepseek","name":"DeepSeek","baseUrl":"https://api.deepseek.com","apiFormat":"openai","authType":"bearer"},{"providerId":"groq","name":"Groq","baseUrl":"https://api.groq.com/openai/v1","apiFormat":"openai","authType":"bearer"}]',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
