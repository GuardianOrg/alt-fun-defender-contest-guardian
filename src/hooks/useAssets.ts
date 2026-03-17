import { useQuery } from '@tanstack/react-query';
import { assetService } from '@/services/assetService';

export function useAssets() {
  return useQuery({
    queryKey: ['assets'],
    queryFn: () => assetService.getAssets(),
  });
}

export function usePlatformStats() {
  return useQuery({
    queryKey: ['platformStats'],
    queryFn: () => assetService.getPlatformStats(),
  });
}

export function usePairFilters() {
  return useQuery({
    queryKey: ['pairFilters'],
    queryFn: () => assetService.getPairFilters(),
  });
}
