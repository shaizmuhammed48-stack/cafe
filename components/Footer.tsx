export function Footer() {
  return (
    <footer className="mt-space-xl w-full bg-surface-container-lowest px-margin-mobile pt-space-xl pb-32 md:px-margin-desktop">
      <div className="mx-auto flex max-w-[1280px] flex-col items-center justify-between gap-space-md text-center md:flex-row md:text-left">
        <div className="flex flex-col">
          <span className="font-headline-sm text-headline-sm tracking-wide text-primary">
            MAD CO CAFE
          </span>
          <span className="mt-1 font-body-sm text-body-sm text-outline">
            © {new Date().getFullYear()} Mad Co Cafe Atelier. Classical roasting &amp; fine
            culinary arts.
          </span>
        </div>
        <div className="flex items-center gap-space-lg font-label-md text-label-md uppercase tracking-wider text-outline">
          <span className="transition-colors hover:text-primary">Single Origin Archive</span>
          <span className="transition-colors hover:text-primary">Bespoke Roasting</span>
          <span className="transition-colors hover:text-primary">Concierge</span>
        </div>
      </div>
    </footer>
  );
}
