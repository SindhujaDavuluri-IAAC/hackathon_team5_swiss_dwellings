-- Every successful analysis is stored together with its exact inputs and outputs.
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  apartment_id TEXT,
  label TEXT,
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  score REAL NOT NULL,
  threshold REAL NOT NULL,
  is_anomaly INTEGER NOT NULL CHECK(is_anomaly IN (0, 1)),
  model_sha256 TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json))
);
CREATE INDEX IF NOT EXISTS predictions_created_at ON predictions(created_at DESC);
