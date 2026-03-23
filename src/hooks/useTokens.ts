import { useQuery } from '@tanstack/react-query';
import { tokenService } from '@/services/tokenService';
import type { TokenFilter } from '@/services/types';

export function useTokens(filter?: TokenFilter) {
  return useQuery({
    queryKey: ['tokens', filter],
    queryFn: () => tokenService.getTokens(filter),
  });
}

export function useLongTokens(filter?: TokenFilter) {
  return useQuery({
    queryKey: ['tokens', 'long', filter],
    queryFn: () => tokenService.getLongTokens(filter),
    refetchInterval: 10_000,
  });
}

export function useShortTokens(filter?: TokenFilter) {
  return useQuery({
    queryKey: ['tokens', 'short', filter],
    queryFn: () => tokenService.getShortTokens(filter),
    refetchInterval: 10_000,
  });
}
