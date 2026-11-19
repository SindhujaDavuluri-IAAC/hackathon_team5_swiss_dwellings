/**
 * Reference Vite / React 2-Tab Component for Team 5 Swiss Dwellings Studio.
 * Palette: Yale Blue (#133C55), Cornflower Ocean (#386FA4), Fresh Sky (#59A5D8),
 * White Smoke (#F5F5F5), Autumn Leaf (#F56200).
 * Supports up to 50 curated apartments, organic bubble room topology SVG with
 * solar halos & acoustic ripples, and intuitive Unusualness Percentile ratings.
 */
import React, { useState, useEffect } from "react";
import { FEATURES, LABELS, EXAMPLES, GROUPS } from "../public/data.js";

function scoreToPercentile(score, threshold = 0.179884) {
  const r = Math.max(0, Number(score) / Math.max(1e-6, Number(threshold)));
  if (r <= 0.25) return Math.max(4, Math.round(r * 140));
  if (r <= 0.6) return Math.round(35 + ((r - 0.25) / 0.35) * 37);
  if (r <= 1.0) return Math.round(72 + ((r - 0.6) / 0.4) * 23);
  return Math.min(99.9, Number((95 + 4.9 * (1 - Math.exp(-(r - 1.0) * 1.15))).toFixed(1)));
}

export default function SwissDwellingsStudio() {
  const [displayLimit, setDisplayLimit] = useState(12);
  const [filterMode, setFilterMode] = useState("all");
  const [selectedKey, setSelectedKey] = useState("noisy_apartment_1");
  const [features, setFeatures] = useState(EXAMPLES.noisy_apartment_1.features);
  const [goals, setGoals] = useState({
    improve_acoustics: true,
    improve_sunlight: true,
    improve_view: true,
  });
  const [topK, setTopK] = useState(5);
  const [activeTab, setActiveTab] = useState("agent"); // "agent" | "architect" | "split"
  const [focusedTwinIdx, setFocusedTwinIdx] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const entries = Object.entries(EXAMPLES)
    .filter(([, ex]) => (filterMode === "all" ? true : ex.tag_type === filterMode))
    .slice(0, displayLimit);

  const handleSelectExample = (key) => {
    setSelectedKey(key);
    if (EXAMPLES[key]) {
      setFeatures({ ...EXAMPLES[key].features });
      setResult(null);
    }
  };

  const handleEvaluate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const ex = EXAMPLES[selectedKey] || { label: "Custom Architectural Simulation" };
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apartment_id: ex.apartment_id,
          label: ex.label,
          features,
          top_k: topK,
          ...goals,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Prediction failed");
      setFocusedTwinIdx(0);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const pct = result ? scoreToPercentile(result.score, result.threshold) : null;

  return (
    <div className="shell">
      <header className="hero">
        <div>
          <span className="eyebrow">SPATIAL BUBBLE TOPOLOGY • ENVIRONMENTAL AUTOENCODER</span>
          <h1>A Quieter Place. A Brighter Possibility.</h1>
        </div>
      </header>

      <section className="listing-strip-section">
        <div className="strip-header">
          <h2>Browse Apartments For Sale (Up to 50 Options)</h2>
          <label className="count-control">
            <span>Show apartments:</span>
            <input
              type="range"
              min="4"
              max="50"
              step="2"
              value={displayLimit}
              onChange={(e) => setDisplayLimit(Number(e.target.value))}
            />
            <output>{entries.length} / 50</output>
          </label>
        </div>
        <div className="listing-carousel">
          {entries.map(([key, ex]) => (
            <button
              key={key}
              type="button"
              className={`listing-card ${selectedKey === key ? "selected" : ""}`}
              onClick={() => handleSelectExample(key)}
            >
              <strong>{ex.label}</strong>
              <small>
                {ex.features.apt_total_area.toFixed(0)} m² • {ex.preview_pct}th Pct
              </small>
            </button>
          ))}
        </div>
      </section>

      <div className="workspace">
        <form className="panel" onSubmit={handleEvaluate}>
          <h2>Selected Apartment & Spatial Bubble Diagram</h2>
          <button className="primary full" type="submit" disabled={loading}>
            {loading ? "Evaluating Profile..." : "Evaluate Normality & Find Better Spatial Twins"}
          </button>
          {error && <p className="notice error">{error}</p>}
        </form>

        <div className="result-column">
          <div className="persona-bar">
            <button
              type="button"
              className={`persona-tab ${activeTab === "agent" ? "active" : ""}`}
              onClick={() => setActiveTab("agent")}
            >
              <strong>Story 1: Real Estate Agent View</strong>
              <small>Unusualness Percentile & 95th-Percentile Threshold</small>
            </button>
            <button
              type="button"
              className={`persona-tab ${activeTab === "architect" ? "active" : ""}`}
              onClick={() => setActiveTab("architect")}
            >
              <strong>Story 2: Architect View</strong>
              <small>Pick from 3–5 Layout-Matched Better Twins</small>
            </button>
          </div>

          {result && (activeTab === "agent" || activeTab === "split") && (
            <div className="panel">
              <h2>
                {result.is_anomaly
                  ? `Unusual Profile (${pct}th Percentile — Above 95th Pct Cutoff)`
                  : `Normal Profile (${pct}th Percentile — Market Ready)`}
              </h2>
            </div>
          )}

          {result && (activeTab === "architect" || activeTab === "split") && (
            <div className="panel">
              <h2>Pick Any of the {result.twins.length} Better Spatial Twins</h2>
              <div className="twin-selector-bar">
                {result.twins.map((t, idx) => (
                  <button
                    key={t.apartment_id}
                    type="button"
                    className={`twin-pick-btn ${idx === focusedTwinIdx ? "active" : ""}`}
                    onClick={() => setFocusedTwinIdx(idx)}
                  >
                    Twin #0{idx + 1} • Site {t.site_id}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
