import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api';

export function useLeaders() {
  const [leaders, setLeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchLeaders = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/leaders`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLeaders(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaders();
    // Auto-refresh every 5 minutes
    const interval = setInterval(fetchLeaders, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchLeaders]);

  return { leaders, loading, error, refresh: fetchLeaders };
}

export function useLeaderDetail(id) {
  const [leader, setLeader] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`${API_BASE}/leaders/${id}`)
      .then(res => res.json())
      .then(data => {
        setLeader(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  return { leader, loading };
}
