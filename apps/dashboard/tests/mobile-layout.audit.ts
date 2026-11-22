(() => {
  const failures: string[] = [];
  const width = window.innerWidth;
  const visible = (element: Element | null) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  for (const element of document.querySelectorAll('.workspace-topbar button, .workspace-topbar .data-mode-pill')) {
    if (!visible(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.left < 0 || rect.top < 0 || rect.right > width + 1) failures.push(`Header clips: ${element.textContent?.trim()}`);
  }
  if (document.documentElement.scrollWidth > width + 1) failures.push('Document overflows horizontally');
  for (const area of document.querySelectorAll('.content-scroll, .mission-control, .pipeline-workspace, .blackboard-workspace')) {
    if (area.scrollWidth > area.clientWidth + 1) failures.push(`Content overflows: ${area.className}`);
  }
  if (width <= 760) {
    if (document.querySelector('.app-main')!.getBoundingClientRect().width < width - 1) failures.push('Mobile content loses width to desktop sidebar');
    if (document.querySelector('.app-sidebar')!.getBoundingClientRect().height > 120) failures.push('Bottom navigation consumes too much height');
    const active = document.querySelector('.app-sidebar [aria-current="page"]')!.getBoundingClientRect();
    if (active.left < 0 || active.right > width + 1) failures.push('Active navigation item is clipped');
    for (const name of document.querySelectorAll('.system-name strong')) {
      if (name.scrollWidth > name.clientWidth + 1) failures.push(`System label clips: ${name.textContent?.trim()}`);
    }
    for (const button of document.querySelectorAll('.app-sidebar nav button')) {
      if (!visible(button.querySelector('span'))) failures.push(`Navigation label hidden: ${button.getAttribute('aria-label')}`);
    }
    for (const button of document.querySelectorAll('.workspace-topbar button, .app-sidebar nav button, .rehearsal-console > header button')) {
      if (!visible(button)) continue;
      const rect = button.getBoundingClientRect();
      if (rect.width < 44 || rect.height < 44) failures.push(`Small touch target: ${button.getAttribute('aria-label') || button.textContent?.trim()}`);
    }
  }
  return { passed: failures.length === 0, viewport: { width, height: innerHeight }, failures };
})()
