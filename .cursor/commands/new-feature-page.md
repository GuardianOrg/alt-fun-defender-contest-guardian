# New Feature Page

## Objective
Create a new page/view in the webapp with proper routing, data fetching, and styling.

## Steps
1. Add the route constant in `apps/web/src/app/routes.ts`
2. Create the page component in `apps/web/src/components/<feature>/`
3. Create the CSS Module alongside it: `<PageName>.module.css`
4. Add the route to the router in `apps/web/src/app/App.tsx`
5. Create any needed hooks in `apps/web/src/hooks/` for data fetching
6. Wire up data fetching with TanStack Query (Ponder GraphQL or Hono API)
7. Add navigation links from existing pages if needed

## Requirements
- Use CSS Modules for styling
- Use TanStack Query for data fetching
- Add loading and error states
- Follow existing component patterns in the codebase
