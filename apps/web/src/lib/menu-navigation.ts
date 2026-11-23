import { useRoute } from 'vue-router';

/**
 * For a dropdown menu whose items go to other pages. When an item goes to another page, the menu
 * would send focus back to its button as it closes, away from the new page's heading, which
 * `AppLayout` focuses. Call `selected(route)` from the item's `select`, and `closeAutoFocus` from
 * the content's `close-auto-focus`.
 */
export function useMenuNavigation() {
  const route = useRoute();
  let leaving = false;
  return {
    selected: (to: { path: string }) => {
      leaving = to.path !== route.path;
    },
    closeAutoFocus: (event: Event) => {
      if (leaving) event.preventDefault();
      leaving = false;
    },
  };
}
