import { useState, useEffect, useRef } from 'react';
import {
  detectNaturalLanguage,
  getMockResponse,
  type AskPulseResponse,
} from '../engine/mockData/askPulseMocks';

interface UseAskPulseResult {
  isNaturalLanguage: boolean;
  response: AskPulseResponse | null;
  isLoading: boolean;
}

export function useAskPulse(query: string): UseAskPulseResult {
  const [response, setResponse] = useState<AskPulseResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isNaturalLanguage = detectNaturalLanguage(query);

  useEffect(() => {
    // Clear previous timer
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!isNaturalLanguage || !query.trim()) {
      setResponse(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setResponse(null);

    // 400ms debounce
    timerRef.current = setTimeout(() => {
      // 600ms simulated loading
      timerRef.current = setTimeout(() => {
        setResponse(getMockResponse(query));
        setIsLoading(false);
      }, 600);
    }, 400);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, isNaturalLanguage]);

  return { isNaturalLanguage, response, isLoading };
}
