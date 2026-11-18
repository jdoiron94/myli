import { nextTick, type Ref, watch } from 'vue';

/**
 * After going to another page of results, moves focus to `target` (the count above them) once that
 * page shows, rather than leaving it on a link at the bottom of what was the last page. Focusing
 * scrolls there too. Call `paged()` when a page link is followed.
 *
 * It watches the page shown, not the request, so a page already loaded before is handled too.
 */
export function useFocusAfterPaging(
  shownPage: () => number | undefined,
  target: Readonly<Ref<HTMLElement | null>>,
) {
  let paging = false;
  watch(shownPage, async () => {
    if (!paging) return;
    paging = false;
    await nextTick();
    target.value?.focus();
  });
  return {
    paged: () => {
      paging = true;
    },
  };
}
