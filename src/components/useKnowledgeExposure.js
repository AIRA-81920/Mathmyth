import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { loadTrail, onDatabaseChange } from '../core/db/database.js';

export default function useKnowledgeExposure() {
  const initialized = useAppStore(state => state.storageInitialized);
  const learner = useAppStore(state => state.learnerId);
  const [exposure, setExposure] = useState({ ready: false, methods: new Set(), scenarios: new Set() });
  useEffect(() => {
    let alive = true, request = 0;
    setExposure({ ready: false, methods: new Set(), scenarios: new Set() });
    if (!initialized) return;
    async function refresh() {
      const owner = ++request;
      try {
        const trail = await loadTrail();
        if (alive && owner === request) setExposure({ ready: true,
          methods: new Set(trail.encounters.map(e => e.methodId)), scenarios: new Set(trail.encounters.map(e => e.scenarioId)) });
      } catch { /* A read failure must not mark a topic as unseen. */ }
    }
    refresh();
    const unsubscribe = onDatabaseChange(event => {
      if (['completeJob', 'deleteConversation', 'gradePracticeItem', 'revealPracticeItem', 'clearDatabase', 'commitImport'].includes(event.method)) refresh();
    });
    return () => { alive = false; unsubscribe(); };
  }, [initialized, learner]);
  return exposure;
}
