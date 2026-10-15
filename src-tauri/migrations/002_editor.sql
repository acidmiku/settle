-- Keep migration 1 and its historical records intact for existing installs.
-- Generated content remains accessible through exports only.
DELETE FROM settings WHERE key IN ('api_base_url', 'api_key', 'model_name', 'categorization_mode', 'theme');
INSERT OR IGNORE INTO settings(key, value) VALUES ('design', 'scratch');
INSERT OR IGNORE INTO settings(key, value) VALUES ('save_key_mode', 'shift_enter');
