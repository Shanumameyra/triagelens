import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Badge, Box, Button, Heading, Stack, Strong, Text, useProductContext } from '@forge/react';
import { invoke } from '@forge/bridge';

const BAND_TONE = { Critical: 'red', High: 'orange', Medium: 'yellow', Low: 'green' };

const App = () => {
  const context = useProductContext();
  const [brief, setBrief] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState('');

  const issueKey = context?.extension?.issue?.key;

  useEffect(() => {
    if (!issueKey) return;
    invoke('getTriage', { issueKey })
      .then((res) => (res?.error ? setError(res.error) : setBrief(res)))
      .catch((e) => setError(String(e?.message || e)));
  }, [issueKey]);

  const applyPriority = async () => {
    if (!brief) return;
    setBusy(true);
    const res = await invoke('applyPriority', { issueKey, priority: brief.triage.suggestedPriority });
    setBusy(false);
    setApplied(res?.error ? `Could not apply priority: ${res.error}` : `Priority set to ${brief.triage.suggestedPriority}.`);
  };

  const applyLabels = async () => {
    if (!brief) return;
    setBusy(true);
    const res = await invoke('applyLabels', { issueKey, labels: brief.triage.suggestedLabels });
    setBusy(false);
    setApplied(res?.error ? `Could not apply labels: ${res.error}` : `Labels added: ${brief.triage.suggestedLabels.join(', ')}.`);
  };

  if (error) {
    return (
      <Stack space="space.100">
        <Heading as="h3">TriageLens</Heading>
        <Text>{error}</Text>
      </Stack>
    );
  }
  if (!brief) {
    return (
      <Stack space="space.100">
        <Heading as="h3">TriageLens</Heading>
        <Text>Reading this issue, its comments, goals and team load…</Text>
      </Stack>
    );
  }

  const t = brief.triage;
  return (
    <Stack space="space.200">
      <Heading as="h3">TriageLens — {brief.key}</Heading>
      <Text>{brief.summary}</Text>
      <Box>
        <Text>
          Triage score: <Strong>{t.score}/100</Strong>
        </Text>
        <Badge appearance={BAND_TONE[t.band] || 'default'}>{t.band}</Badge>
      </Box>
      <Heading as="h4">Why this score</Heading>
      {t.breakdown.map((b) => (
        <Text key={b.label}>
          {b.label} — {b.points} pts
        </Text>
      ))}
      {t.reasons.length > 0 && (
        <Box>
          <Heading as="h4">What stands out</Heading>
          {t.reasons.map((r) => (
            <Text key={r}>• {r}</Text>
          ))}
        </Box>
      )}
      <Text>Suggested priority: {t.suggestedPriority}</Text>
      {brief.suggestedAssignee && (
        <Text>
          Least-loaded teammate: {brief.suggestedAssignee.displayName} ({brief.suggestedAssignee.openItems} open items)
        </Text>
      )}
      {brief.goals.length > 0 && (
        <Box>
          <Heading as="h4">Linked goals</Heading>
          {brief.goals.map((g) => (
            <Text key={g.name}>• {g.name}</Text>
          ))}
        </Box>
      )}
      {brief.notes.length > 0 && (
        <Box>
          <Heading as="h4">Notes</Heading>
          {brief.notes.map((n) => (
            <Text key={n}>{n}</Text>
          ))}
        </Box>
      )}
      <Box>
        <Button appearance="primary" onClick={applyPriority} isDisabled={busy}>
          Apply suggested priority ({t.suggestedPriority})
        </Button>
        <Button onClick={applyLabels} isDisabled={busy}>
          Add labels ({t.suggestedLabels.join(', ')})
        </Button>
      </Box>
      {applied && <Text>{applied}</Text>}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
