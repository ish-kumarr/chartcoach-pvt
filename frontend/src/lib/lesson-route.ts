export type LessonRoute = {
  courseSlug: string;
  moduleNumber: string;
};

/** Resolve the canonical pilot URL to the backend-owned lesson identity. */
export function resolveLessonRoute(route: LessonRoute): string | null {
  if (route.courseSlug === "price-action-secrets" && route.moduleNumber === "1") {
    return "l1";
  }
  return null;
}

export function canonicalLessonHref(route: LessonRoute, preview = false): string {
  const base = `/learn/${encodeURIComponent(route.courseSlug)}/${encodeURIComponent(route.moduleNumber)}`;
  return preview ? `${base}?preview=1` : base;
}
