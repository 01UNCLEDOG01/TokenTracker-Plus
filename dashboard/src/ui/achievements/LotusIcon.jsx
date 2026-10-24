import React from "react";

/** Engraved lotus for the 小确幸 coin reverse. */
export function LotusIcon({ size = 24, color = "currentColor", strokeWidth = 1.5, className, style }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <path d="M12 4.2c1.8 1.7 2.7 3.5 2.7 5.4 0 2.2-1.2 3.9-2.7 3.9s-2.7-1.7-2.7-3.9c0-1.9.9-3.7 2.7-5.4Z" />
      <path d="M12 13.5c-2.1 0-3.9-1.1-5.2-3.2 2.4-.4 4.2.4 5.2 2.1 1-1.7 2.8-2.5 5.2-2.1-1.3 2.1-3.1 3.2-5.2 3.2Z" />
      <path d="M7.1 10.9C5.5 10.2 4.3 9 3.5 7.3c2.2-.2 3.9.4 5.1 1.7" />
      <path d="M16.9 10.9c1.6-.7 2.8-1.9 3.6-3.6-2.2-.2-3.9.4-5.1 1.7" />
      <path d="M12 13.5c-1.7 1.1-3.6 1.6-5.6 1.6-2 0-3.7-.5-5-1.6 1.7-1.3 3.5-1.9 5.4-1.9 2.1 0 3.8.6 5.2 1.9Z" />
      <path d="M12 13.5c1.7 1.1 3.6 1.6 5.6 1.6 2 0 3.7-.5 5-1.6-1.7-1.3-3.5-1.9-5.4-1.9-2.1 0-3.8.6-5.2 1.9Z" />
    </svg>
  );
}

export default LotusIcon;
