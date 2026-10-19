/** Decorative Greek-key style divider lifted from the Stitch home screen. */
export function GreekDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`flex w-full items-center justify-center opacity-60 ${className}`}>
      <svg
        aria-hidden="true"
        className="h-3 w-full text-secondary"
        fill="none"
        preserveAspectRatio="none"
        viewBox="0 0 800 12"
      >
        <path
          d="M0,6 L350,6 M350,2 L370,2 L370,10 L360,10 L360,4 L365,4 M430,2 L450,2 L450,10 L440,10 L440,4 L445,4 M450,6 L800,6"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
        />
        <polygon fill="currentColor" points="395,6 400,1 405,6 400,11" />
      </svg>
    </div>
  );
}
