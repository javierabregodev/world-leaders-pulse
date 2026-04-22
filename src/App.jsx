import { useState, useEffect, useCallback } from 'react';
import Dashboard from './components/Dashboard';
import LeaderPage from './components/LeaderPage';

function getRouteFromHash() {
  const hash = window.location.hash.replace('#', '');
  const match = hash.match(/^\/leader\/(.+)$/);
  return match ? match[1] : null;
}

export default function App() {
  const [selectedId, setSelectedId] = useState(getRouteFromHash());

  // Listen to browser back/forward
  useEffect(() => {
    const onHashChange = () => setSelectedId(getRouteFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigateToLeader = useCallback((id) => {
    window.location.hash = `/leader/${id}`;
    window.scrollTo(0, 0);
  }, []);

  const navigateToDashboard = useCallback(() => {
    window.location.hash = '';
    window.scrollTo(0, 0);
  }, []);

  if (selectedId) {
    return <LeaderPage leaderId={selectedId} onBack={navigateToDashboard} onSelectLeader={navigateToLeader} />;
  }

  return <Dashboard onSelectLeader={navigateToLeader} />;
}
