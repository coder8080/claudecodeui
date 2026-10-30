import { cn } from '@/shared/utils';

type SvodMarkProps = {
  /** Sizing classes; set the height and let the width follow the mark's aspect ratio. */
  className?: string;
};

/**
 * Used by the sidebar, settings and auth modules to show the Svod brand mark.
 * The light-theme mark has navy ribbon legs that vanish on a dark background,
 * so dark mode swaps in the "on dark" variant from the brand sheet.
 */
export function SvodMark({ className = 'h-6' }: SvodMarkProps) {
  return (
    <>
      <img src="/logo.png" alt="Svod" className={cn('w-auto dark:hidden', className)} />
      <img src="/logo-dark.png" alt="Svod" className={cn('hidden w-auto dark:block', className)} />
    </>
  );
}
