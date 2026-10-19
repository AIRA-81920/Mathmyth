import { useLayoutEffect, useRef } from 'react';

export default function AnimatedDisclosure({ open, children, className = '', id }) {
  const ref = useRef(null);
  useLayoutEffect(() => { if (ref.current) ref.current.inert = !open }, [open]);
  return <div id={id} className={`animated-disclosure${open ? ' is-open' : ''} ${className}`} aria-hidden={!open}>
    <div ref={ref} className="animated-disclosure-inner">{children}</div>
  </div>;
}
