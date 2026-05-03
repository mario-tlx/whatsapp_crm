/**
 * Decide how to handle an outbound reply based on agent_config.mode and keyword lists.
 * mode: 'off' | 'autonomous' | 'approval' | 'hybrid'
 */
export function decideReplyAction(config, incomingText) {
  if (!config || config.mode === 'off') {
    return { action: 'none', reason: 'agent_off' };
  }

  const text = (incomingText || '').toLowerCase();
  const autoList = splitKeywords(config.autonomous_keywords);
  const approvalList = splitKeywords(config.approval_keywords);

  const hitsAuto = autoList.some((k) => k && text.includes(k));
  const hitsApproval = approvalList.some((k) => k && text.includes(k));

  if (config.mode === 'autonomous') {
    if (hitsApproval) {
      return { action: 'queue_approval', reason: 'approval_keyword_in_autonomous_mode' };
    }
    return { action: 'send_auto', reason: 'autonomous_mode' };
  }

  if (config.mode === 'approval') {
    return { action: 'queue_approval', reason: 'approval_mode' };
  }

  if (config.mode === 'hybrid') {
    if (hitsApproval) {
      return { action: 'queue_approval', reason: 'hybrid_approval_keyword' };
    }
    if (hitsAuto) {
      return { action: 'send_auto', reason: 'hybrid_autonomous_keyword' };
    }
    return { action: 'queue_approval', reason: 'hybrid_default_approval' };
  }

  return { action: 'queue_approval', reason: 'unknown_mode' };
}

function splitKeywords(csv) {
  if (!csv || typeof csv !== 'string') return [];
  return csv
    .split(/[|,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
