import { type QueryKey, useMutation, useQueryClient } from '@tanstack/vue-query';

/**
 * A mutation that changes what a list shows, then refreshes the list (`queryKey`), whether it worked
 * or not: a refusal, like a 404 for something removed meanwhile, usually means the list is out of
 * date. The mutation isn't done until the list is, so nothing shows a list that's behind.
 */
export function useRefreshingMutation<TVariables, TData>(
  queryKey: QueryKey,
  mutationFn: (variables: TVariables) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}
