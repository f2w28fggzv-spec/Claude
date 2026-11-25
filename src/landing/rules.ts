// The chapter rules: each section of the page loads one more plate onto the
// bar, and the interest list has all four (the logo). Below the first screen
// the plates wait off the end of the bar and slide on as a rule comes into
// view (a transform, so nothing else moves). With reduced motion they're
// simply there.
export function startRules(doc: Document): void {
  let still = false;
  try {
    still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // no matchMedia: animate
  }
  if (still || typeof IntersectionObserver !== 'function') return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove('pending');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -12% 0px' },
  );
  for (const el of doc.querySelectorAll<HTMLElement>('[data-rule]')) {
    // Rules already on screen stay as they are.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) continue;
    el.classList.add('pending');
    io.observe(el);
  }
}
