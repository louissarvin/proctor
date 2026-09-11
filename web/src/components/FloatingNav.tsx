import { useEffect, useRef } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { gsap } from 'gsap';
import { cnm } from '@/utils/style';

const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/operator', label: 'Operator console' },
  { to: '/console', label: 'Evidence console' },
] as const;

/** Witness phone screens are single-decision, distraction-free flows. No nav. */
const SUPPRESSED_PREFIXES = ['/w/', '/handoff/'];

export default function FloatingNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const barRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      const isScrolled = window.scrollY > 24;
      if (isScrolled === scrolled.current) return;
      scrolled.current = isScrolled;
      const el = barRef.current;
      if (!el) return;
      gsap.to(el, {
        scale: isScrolled ? 0.97 : 1,
        backgroundColor: isScrolled ? 'rgba(10, 10, 10, 0.72)' : 'rgba(10, 10, 10, 0.35)',
        boxShadow: isScrolled ? '0 8px 30px -12px rgba(0, 0, 0, 0.6)' : '0 0 0 rgba(0, 0, 0, 0)',
        duration: 0.4,
        ease: 'power2.out',
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (SUPPRESSED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

  return (
    <nav className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div
        ref={barRef}
        className="flex items-center gap-1 rounded-full border border-white/10 bg-neutral-950/35 px-2 py-1.5 backdrop-blur-xl transition-[background-color] sm:gap-2 sm:px-3"
      >
        {/* The pill's own height is capped by this row's vertical padding
            (py-1.5 above), not by the logo -- so the logo can be sized up
            without the whole bar inflating with it. */}
        <Link to="/" className="flex items-center rounded-full">
          <img src="/assets/logo.svg" alt="" className="h-8 w-auto" height={32} />
        </Link>

        <div className="mx-1 h-4 w-px bg-white/10 sm:mx-2" />

        {NAV_LINKS.slice(1).map((link) => (
          <NavItem key={link.to} to={link.to} label={link.label} active={pathname === link.to} />
        ))}
      </div>
    </nav>
  );
}

function NavItem({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={cnm(
        'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-white/10 text-white' : 'text-neutral-400 hover:text-white',
      )}
    >
      {label}
    </Link>
  );
}
