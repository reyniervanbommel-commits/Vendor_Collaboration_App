import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../../utils/api';

const SUGGEST_DELAY = 200;
const PREVIEW_DELAY = 300;
const MIN_QUERY_LENGTH = 2;

/** Suggesties voor een @mention terwijl de gebruiker typt (debounced; oude antwoorden genegeerd). */
export function useMentionSuggestions({ tableKey, query }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const sequenceRef = useRef(0);
  const trimmed = String(query || '').trim();

  useEffect(() => {
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    if (trimmed.length < MIN_QUERY_LENGTH || !tableKey) {
      setSuggestions([]);
      setLoading(false);
      return undefined;
    }
    // Oude suggesties direct weg: anders kiest Enter tijdens het laden een verouderde waarde.
    setSuggestions([]);
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await apiRequest(
          `/data/${encodeURIComponent(tableKey)}/remarks/mentions?q=${encodeURIComponent(trimmed)}`
        );
        if (sequenceRef.current !== sequence) return;
        setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      } catch {
        if (sequenceRef.current === sequence) setSuggestions([]);
      } finally {
        if (sequenceRef.current === sequence) setLoading(false);
      }
    }, SUGGEST_DELAY);
    return () => window.clearTimeout(timer);
  }, [tableKey, trimmed]);

  return { suggestions, loading };
}

/** Op hoeveel PO's (en vendors) komt een opmerking met deze mentions terecht? */
export function useMentionPreview({ tableKey, row, mentions }) {
  const [state, setState] = useState({ orderCount: null, vendorCount: null, error: '', loading: false });
  const sequenceRef = useRef(0);
  const key = JSON.stringify(mentions || []);

  useEffect(() => {
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    const list = JSON.parse(key);
    if (!list.length || !tableKey || !row?.partitionKey || !row?.recordKey) {
      setState({ orderCount: null, vendorCount: null, error: '', loading: false });
      return undefined;
    }
    setState((current) => ({ ...current, loading: true }));
    const timer = window.setTimeout(async () => {
      try {
        const data = await apiRequest(`/data/${encodeURIComponent(tableKey)}/remarks/mentions/preview`, {
          method: 'POST',
          body: { partitionKey: row.partitionKey, recordKey: row.recordKey, mentions: list },
        });
        if (sequenceRef.current !== sequence) return;
        setState({
          orderCount: Number(data?.orderCount) || 0,
          vendorCount: Number(data?.vendorCount) || 0,
          error: '',
          loading: false,
        });
      } catch (error) {
        if (sequenceRef.current !== sequence) return;
        setState({ orderCount: null, vendorCount: null, error: error?.message || 'Failed to check mentions', loading: false });
      }
    }, PREVIEW_DELAY);
    return () => window.clearTimeout(timer);
  }, [key, row?.partitionKey, row?.recordKey, tableKey]);

  return state;
}
