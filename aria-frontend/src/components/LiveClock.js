import { memo, useEffect, useState } from 'react';

export default memo(function LiveClock() {
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  );

  useEffect(() => {
    const tick = () => {
      setClock(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return <span className="topbar-clock">{clock}</span>;
});
